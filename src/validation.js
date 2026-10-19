import {
  MAX_ATTEMPT_ID_CHARS, MAX_AUDIO_BYTES, MAX_FILE_ID_CHARS, MAX_JOB_ID_CHARS,
  MAX_KEYWORD_INPUT_CHARS, MAX_KEYWORDS, MAX_KEY_CHARS, MAX_LANGUAGE_INPUT_CHARS,
  MAX_LANGUAGES, MAX_METADATA_HEADER_CHARS, MAX_METADATA_JSON_BYTES, MAX_FINAL_PROMPT_CHARS, MODELS
} from "./config.js";
import { ApiError } from "./errors.js";
import { canonicalMime, formatSpec } from "./audio-formats.js";
import { b64urlDecode, decodeUtf8, utf8 } from "./utils.js";

// Keep alias local to make accidental relaxations visible in static review.
const MAX_KEYWORD_CHARACTERS = 200;
const GPT_TRANSCRIBE_REGIONAL_LANGUAGE_CODES = new Set(["zh-cn","zh-tw","zh-hk"]);

function validLanguageCode(code, model) {
  return model === "gpt-transcribe"
    ? (/^[a-z]{2,3}$/.test(code) || GPT_TRANSCRIBE_REGIONAL_LANGUAGE_CODES.has(code))
    : /^[a-z]{2}$/.test(code);
}

function rejectUnknownKeys(obj, allowed, code = "invalid_metadata") {
  for (const key of Object.keys(obj)) if (!allowed.has(key)) throw new ApiError(400, code, "Request contains an unsupported field.");
}

export function validateOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== env.APP_ORIGIN) throw new ApiError(403, "origin_rejected", "Cross-origin requests are not permitted.");
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin" && site !== "none") throw new ApiError(403, "origin_rejected", "Cross-site requests are not permitted.");
}

export function validateApiKey(raw) {
  if (typeof raw !== "string") throw new ApiError(400, "key_malformed", "Enter an OpenAI API key.");
  if (!raw || raw.length > MAX_KEY_CHARS || raw !== raw.trim() || /\s|[\u0000-\u001f\u007f]/u.test(raw)) {
    throw new ApiError(400, "key_malformed", "The OpenAI API key is malformed.");
  }
  return raw;
}

export function validateId(value, label, max) {
  if (typeof value !== "string" || value.length < 1 || value.length > max || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new ApiError(400, "invalid_metadata", `${label} is invalid.`);
  }
  return value;
}

export function normalizeLanguages(value, model) {
  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return [];
  const cap = MODELS[model];
  if (!cap || cap.languages === "none") throw new ApiError(400, "model_parameter_unsupported", "The selected model does not accept language hints in this application.");
  if (!Array.isArray(value) || JSON.stringify(value).length > MAX_LANGUAGE_INPUT_CHARS * 2) throw new ApiError(400, "invalid_language", "Language hints are invalid.");
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    if (typeof raw !== "string") throw new ApiError(400, "invalid_language", "Language hints must be strings.");
    const v = raw.trim().toLowerCase();
    if (!validLanguageCode(v, model)) throw new ApiError(400, "invalid_language", model === "gpt-transcribe"
      ? "Use ISO 639-1 codes, supported ISO 639-3 codes, or zh-cn/zh-tw/zh-hk."
      : "Use a two-letter ISO 639-1 language code such as en or zh.");
    if (!seen.has(v)) { seen.add(v); out.push(v); }
    if (out.length > MAX_LANGUAGES) throw new ApiError(400, "invalid_language", `No more than ${MAX_LANGUAGES} language hints are allowed.`);
  }
  if (cap.languages === "single" && out.length > 1) throw new ApiError(400, "invalid_language", "The selected model accepts one language hint.");
  return out;
}

export function normalizeKeywords(value, model) {
  if (value == null) return [];
  const cap = MODELS[model];
  if (!cap?.keywords && Array.isArray(value) && value.length === 0) return [];
  if (!cap?.keywords) throw new ApiError(400, "model_parameter_unsupported", "The selected model does not accept keyword hints.");
  if (!Array.isArray(value)) throw new ApiError(400, "invalid_keywords", "Keywords must be a list.");
  let total = 0;
  const out = []; const seen = new Set();
  for (const raw of value) {
    if (typeof raw !== "string") throw new ApiError(400, "invalid_keywords", "Each keyword must be text.");
    const v = raw.trim(); total += v.length;
    if (!v) continue;
    if (v.length > MAX_KEYWORD_CHARACTERS || /[<>\r\n\u0000-\u001f\u007f\u2028\u2029]/u.test(v)) throw new ApiError(400, "invalid_keywords", "A keyword contains unsupported characters or is too long.");
    if (!seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); }
    if (out.length > MAX_KEYWORDS || total > MAX_KEYWORD_INPUT_CHARS) throw new ApiError(400, "invalid_keywords", "Keyword guidance is too large.");
  }
  return out;
}

export function normalizePrompt(value, model) {
  const cap = MODELS[model];
  const v = typeof value === "string" ? value.trim() : "";
  if (!cap?.prompt && !v) return "";
  if (!cap?.prompt) throw new ApiError(400, "model_parameter_unsupported", "The diarization model does not accept a prompt.");
  if (v.length > MAX_FINAL_PROMPT_CHARS || /[\u0000\u000b\u000c\u000e-\u001f\u007f]/u.test(v)) throw new ApiError(400, "invalid_prompt", "The prompt is too long or contains unsupported control characters.");
  return v;
}

export function decodeMetadataHeader(request) {
  const encoded = request.headers.get("X-Cosmic-Metadata");
  if (!encoded || encoded.length > MAX_METADATA_HEADER_CHARS) throw new ApiError(400, "invalid_metadata", "Transcription metadata is missing or too large.");
  let bytes, value;
  try {
    bytes = b64urlDecode(encoded, MAX_METADATA_JSON_BYTES);
    value = JSON.parse(decodeUtf8(bytes));
  } catch {
    throw new ApiError(400, "invalid_metadata", "Transcription metadata is malformed.");
  }
  if (bytes.length > MAX_METADATA_JSON_BYTES || !value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "invalid_metadata", "Transcription metadata is invalid.");
  return validateTranscriptionMetadata(value);
}

export function validateTranscriptionMetadata(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new ApiError(400, "invalid_metadata", "Transcription metadata is invalid.");
  rejectUnknownKeys(obj, new Set(["v","jobId","fileId","chunkIndex","chunkCount","attemptId","declaredBytes","durationSeconds","model","languages","keywords","prompt","requestKind","audioFormat"]));
  if (obj.v !== 1 && obj.v !== 2) throw new ApiError(400, "invalid_metadata", "Unsupported request metadata version.");
  if (obj.v === 2 && typeof obj.audioFormat !== "string") throw new ApiError(400, "invalid_metadata", "Metadata V2 requires audioFormat.");
  if (obj.v === 1 && obj.audioFormat !== undefined) throw new ApiError(400, "invalid_metadata", "Metadata V1 does not accept audioFormat.");
  const audioFormat = obj.v === 1 ? "mp3" : obj.audioFormat;
  formatSpec(audioFormat);
  if (typeof obj.model !== "string" || !Object.prototype.hasOwnProperty.call(MODELS, obj.model)) throw new ApiError(400, "unsupported_model", "The selected model is not an approved completed-file transcription model.");
  if (typeof obj.chunkIndex !== "number" || !Number.isInteger(obj.chunkIndex) || obj.chunkIndex < 1 || typeof obj.chunkCount !== "number" || !Number.isInteger(obj.chunkCount) || obj.chunkCount < obj.chunkIndex || obj.chunkCount > 100_000) throw new ApiError(400, "invalid_metadata", "Chunk indexes are invalid.");
  if (typeof obj.declaredBytes !== "number" || !Number.isSafeInteger(obj.declaredBytes) || obj.declaredBytes < 1 || obj.declaredBytes > MAX_AUDIO_BYTES) throw new ApiError(413, "audio_too_large", "The audio chunk exceeds the application upload limit.");
  if (typeof obj.durationSeconds !== "number" || !Number.isFinite(obj.durationSeconds) || obj.durationSeconds <= 0 || obj.durationSeconds > 24 * 60 * 60) throw new ApiError(400, "invalid_metadata", "Chunk duration is invalid.");
  if (!Array.isArray(obj.languages) || !Array.isArray(obj.keywords) || typeof obj.prompt !== "string") throw new ApiError(400, "invalid_metadata", "Language, keyword and prompt fields have invalid types.");
  if (obj.requestKind !== "transcription" && obj.requestKind !== "key-test") throw new ApiError(400, "invalid_metadata", "Request kind is invalid.");
  return {
    v: obj.v,
    audioFormat,
    jobId: validateId(obj.jobId, "Job ID", MAX_JOB_ID_CHARS),
    fileId: validateId(obj.fileId, "File ID", MAX_FILE_ID_CHARS),
    chunkIndex: obj.chunkIndex, chunkCount: obj.chunkCount,
    attemptId: validateId(obj.attemptId, "Attempt ID", MAX_ATTEMPT_ID_CHARS),
    declaredBytes: obj.declaredBytes, durationSeconds: obj.durationSeconds, model: obj.model,
    languages: normalizeLanguages(obj.languages, obj.model),
    keywords: normalizeKeywords(obj.keywords, obj.model),
    prompt: normalizePrompt(obj.prompt, obj.model),
    requestKind: obj.requestKind
  };
}

export async function readSmallJson(request, maxBytes = 2048) {
  const ct = (request.headers.get("Content-Type") || "").split(";", 1)[0].trim().toLowerCase();
  if (ct !== "application/json") throw new ApiError(415, "content_type_rejected", "Expected application/json.");
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > maxBytes) throw new ApiError(413, "request_too_large", "Request body is too large.");
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks = []; let total = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.byteLength; if (total > maxBytes) throw new ApiError(413, "request_too_large", "Request body is too large.");
    chunks.push(value);
  }
  const all = new Uint8Array(total); let offset = 0; for (const c of chunks) { all.set(c, offset); offset += c.byteLength; }
  try {
    const parsed = JSON.parse(decodeUtf8(all));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ApiError(400, "invalid_json", "Request JSON must be an object.");
    return parsed;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "invalid_json", "Request JSON is malformed.");
  }
}

export function validateAudioRequestHeaders(request, metadata) {
  const spec = formatSpec(metadata.audioFormat || "mp3");
  const rawType = (request.headers.get("Content-Type") || "").split(";",1)[0].trim().toLowerCase();
  if (!rawType || canonicalMime(rawType) !== spec.mime) throw new ApiError(415, "content_type_rejected", "Audio format and Content-Type do not match.");
  const raw = request.headers.get("Content-Length");
  if (raw) {
    const actual = Number(raw);
    if (!Number.isSafeInteger(actual) || actual < 1 || actual > MAX_AUDIO_BYTES) throw new ApiError(413, "audio_too_large", "The audio upload exceeds the application limit.");
    if (actual !== metadata.declaredBytes) throw new ApiError(400, "size_mismatch", "Declared audio size does not match Content-Length.");
  }
  return spec;
}
