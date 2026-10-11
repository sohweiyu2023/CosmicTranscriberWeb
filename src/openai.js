import { MAX_AUDIO_BYTES, MAX_UPSTREAM_RESPONSE_BYTES, MODELS, OPENAI_TRANSCRIPT_URL, UPSTREAM_TIMEOUT_MS } from "./config.js";
import { ApiError } from "./errors.js";
import { formatSpec } from "./audio-formats.js";
import { decodeUtf8, randomId, safeLogValue, utf8 } from "./utils.js";

// Only statuses that unambiguously represent an HTTP-level rejection are
// treated as definitely unbilled. Timeout-like or unusual post-dispatch
// statuses stay conservative because OpenAI may already have processed audio.
const EXPLICIT_REJECTION_STATUSES = new Set([400, 401, 403, 404, 413, 422, 429]);

function safeResponseHeader(response,name,max=160){
  const raw=response?.headers?.get(name);
  if(!raw)return null;
  const value=String(raw).trim();
  if(!value||/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(value))return null;
  return value.slice(0,max);
}

function formField(name, value) {
  return `Content-Disposition: form-data; name="${name}"\r\n\r\n${String(value)}\r\n`;
}

function buildMultipartPrefix(boundary, metadata) {
  const model = MODELS[metadata.model];
  const parts = [];
  const add = (name, value) => parts.push(`--${boundary}\r\n${formField(name, value)}`);
  add("model", metadata.model);
  if (model.diarization) {
    add("response_format", "diarized_json");
    add("chunking_strategy", "auto");
  } else {
    add("response_format", "json");
  }
  if (metadata.prompt) add("prompt", metadata.prompt);
  if (model.languages === "plural") for (const language of metadata.languages) add("languages[]", language);
  if (model.languages === "single" && metadata.languages[0]) add("language", metadata.languages[0]);
  if (model.keywords) for (const keyword of metadata.keywords) add("keywords[]", keyword);
  // The transcription route validates the complete MPGA body as MPEG Layer
  // III before reserving a billable attempt. Only the upstream file label
  // changes here; original bytes and MPGA metadata/checkpoint identity stay put.
  const audioFormat = metadata.audioFormat || "mp3";
  const audio = formatSpec(audioFormat === "mpga" ? "mp3" : audioFormat);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${audio.extension}"\r\nContent-Type: ${audio.mime}\r\n\r\n`);
  return utf8(parts.join(""));
}

function buildMultipartStream(body, prefix, suffix, expectedBytes) {
  if (!body) throw new ApiError(400, "audio_missing", "Audio body is missing.");
  const reader = body.getReader();
  let stage = 0; let actual = 0;
  return {
    stream: new ReadableStream({
      async pull(controller) {
        if (stage === 0) { stage = 1; controller.enqueue(prefix); return; }
        if (stage === 1) {
          const { done, value } = await reader.read();
          if (done) {
            if (actual !== expectedBytes) { controller.error(new Error("AUDIO_SIZE_MISMATCH")); return; }
            stage = 2; controller.enqueue(suffix); return;
          }
          actual += value.byteLength;
          if (actual > MAX_AUDIO_BYTES || actual > expectedBytes) {
            try { await reader.cancel("audio limit exceeded"); } catch {}
            controller.error(new Error("AUDIO_LIMIT_EXCEEDED")); return;
          }
          controller.enqueue(value); return;
        }
        controller.close();
      },
      async cancel(reason) { try { await reader.cancel(reason); } catch {} }
    }),
    getActualBytes: () => actual
  };
}

async function readBoundedResponse(response) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = []; let total = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.byteLength;
    if (total > MAX_UPSTREAM_RESPONSE_BYTES) {
      try { await reader.cancel("response too large"); } catch {}
      throw new ApiError(502, "upstream_response_too_large", "OpenAI returned an unexpectedly large response.", { billingState: "completed_or_ambiguous" });
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total); let offset = 0; for (const c of chunks) { all.set(c, offset); offset += c.byteLength; }
  return all;
}

function classifyOpenAiStatus(status, bodyText = "") {
  if (status === 401) return ["openai_authentication_failed", "OpenAI rejected the API key."];
  if (status === 403) return ["openai_permission_denied", "The OpenAI key does not have permission for this transcription request."];
  if (status === 429) {
    const quota = /quota|billing|insufficient_quota/i.test(bodyText);
    return quota ? ["openai_quota_or_billing", "OpenAI reported a quota or billing problem."] : ["openai_rate_limited", "OpenAI rate-limited the request."];
  }
  if (status === 404) return ["openai_model_unavailable", "The requested OpenAI transcription model is unavailable to this project."];
  if (status >= 400 && status < 500) return ["openai_request_rejected", "OpenAI rejected the transcription request."];
  if (status >= 500) return ["openai_server_error", "OpenAI returned a server error. Because processing may have started, this request is not automatically retried."];
  return ["openai_error", "OpenAI could not complete the request."];
}

export async function dispatchTranscription({ requestBody, metadata, apiKey, signal, fetchImpl = fetch, timeoutMs = UPSTREAM_TIMEOUT_MS }) {
  const boundary = `ctw-${crypto.randomUUID().replace(/-/g, "")}`;
  const prefix = buildMultipartPrefix(boundary, metadata);
  const suffix = utf8(`\r\n--${boundary}--\r\n`);
  const { stream } = buildMultipartStream(requestBody, prefix, suffix, metadata.declaredBytes);
  const clientRequestId = `ctw-${metadata.attemptId}`.slice(0, 512);
  const started = Date.now();
  const upstreamAbort = new AbortController();
  let timedOut = false;
  let onCallerAbort = null;
  if (signal) {
    onCallerAbort = () => upstreamAbort.abort(signal.reason || new DOMException("Aborted", "AbortError"));
    if (signal.aborted) onCallerAbort(); else signal.addEventListener("abort", onCallerAbort, { once: true });
  }
  const timer = setTimeout(() => { timedOut = true; upstreamAbort.abort(new Error("UPSTREAM_TIMEOUT")); }, Math.max(1, timeoutMs));
  let response;
  let bytes;
  try {
    response = await fetchImpl(OPENAI_TRANSCRIPT_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/json",
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "X-Client-Request-Id": clientRequestId
      },
      body: stream,
      redirect: "manual",
      signal: upstreamAbort.signal
    });
    // CTW_WORKER_REDIRECT_FAIL_CLOSED
    if (response.status >= 300 && response.status <= 399) {
      throw new Error("Unexpected OpenAI redirect blocked after dispatch.");
    }
    try {
      bytes = await readBoundedResponse(response);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, "upstream_ambiguous", "OpenAI began responding, but the complete response was not received. Retrying could create a second transcription charge.", { billingState: "completed_or_ambiguous", openaiRequestId: safeResponseHeader(response,"x-request-id") });
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const reason = String(error?.message || error || "");
    const localLimit = reason.includes("AUDIO_LIMIT_EXCEEDED") || reason.includes("AUDIO_SIZE_MISMATCH");
    if (localLimit) throw new ApiError(413, "audio_stream_limit", "The streamed audio did not match the validated size limit.", { billingState: "ambiguous_after_dispatch" });
    const message = timedOut ? "The OpenAI request timed out after dispatch and may have been processed. Retrying could create a second transcription charge." : "The OpenAI request may have been transmitted, but a definitive response was not received. Retrying could create a second transcription charge.";
    throw new ApiError(timedOut ? 504 : 502, "upstream_ambiguous", message, { billingState: "ambiguous_after_dispatch" });
  } finally {
    clearTimeout(timer);
    if (signal && onCallerAbort) signal.removeEventListener("abort", onCallerAbort);
  }
  const requestId = safeResponseHeader(response,"x-request-id");
  const elapsedMs = Date.now() - started;
  let parsed = null; let text = "";
  try { text = decodeUtf8(bytes); parsed = text ? JSON.parse(text) : {}; } catch {
    if (response.ok) throw new ApiError(502, "upstream_malformed", "OpenAI returned a malformed transcription response.", { billingState: "completed_or_ambiguous", openaiRequestId: requestId });
  }
  if (!response.ok) {
    const [code, message] = classifyOpenAiStatus(response.status, text);
    const explicitRejection = EXPLICIT_REJECTION_STATUSES.has(response.status);
    throw new ApiError(response.status, code, message, {
      billingState: explicitRejection ? "explicit_rejection" : "ambiguous_after_dispatch",
      openaiRequestId: requestId,
      retryAfter: safeResponseHeader(response,"retry-after",120)
    });
  }
  return { result: parsed, diagnostics: { clientRequestId, openaiRequestId: requestId, status: response.status, elapsedMs } };
}

export function safeOperationalLog(event) {
  const allowed = {
    ts: new Date().toISOString(),
    route: safeLogValue(event.route, 80),
    requestId: safeLogValue(event.requestId, 100),
    user: safeLogValue(event.user, 80),
    jobId: safeLogValue(event.jobId, 80),
    attemptId: safeLogValue(event.attemptId, 100),
    requestKind: safeLogValue(event.requestKind, 40),
    model: safeLogValue(event.model, 80),
    chunkIndex: Number.isInteger(event.chunkIndex) ? event.chunkIndex : undefined,
    chunkCount: Number.isInteger(event.chunkCount) ? event.chunkCount : undefined,
    declaredBytes: Number.isInteger(event.declaredBytes) ? event.declaredBytes : undefined,
    status: Number.isInteger(event.status) ? event.status : undefined,
    category: safeLogValue(event.category, 80),
    openaiRequestId: safeLogValue(event.openaiRequestId, 120),
    elapsedMs: Number.isFinite(event.elapsedMs) ? Math.round(event.elapsedMs) : undefined
  };
  console.log(JSON.stringify(allowed));
}
