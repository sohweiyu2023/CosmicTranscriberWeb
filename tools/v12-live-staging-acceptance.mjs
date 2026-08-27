import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';

const BASE = 'https://transcriber-staging.awakeningtoreality.com';
const WORKER = 'cosmic-transcriber-web-staging';
const EXPECTED_VERSION = '1.2.0';
const EXPECTED_LOCK_SHA256 = '90c85c65637a2e243273a13438cb23a9a51c3d1aea80236ecf4983df4876b85d';
const FORMATS = Object.freeze({
  mp3: 'audio/mpeg', flac: 'audio/flac', mp4: 'audio/mp4', mpeg: 'audio/mpeg', mpga: 'audio/mpeg',
  m4a: 'audio/mp4', ogg: 'audio/ogg', wav: 'audio/wav', webm: 'audio/webm'
});
const candidate = process.env.CANDIDATE;
const accessSecret = process.env.STAGING_CF_AUTHORIZATION;
const openaiKey = process.env.STAGING_OPENAI_API_KEY;
const cfToken = process.env.CLOUDFLARE_API_TOKEN;
const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID;

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function safeId(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function b64urlJson(value) { return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url'); }
function requireSecret(value, name) { if (!value || !String(value).trim()) fail(`Missing required staging environment secret ${name}.`); }

requireSecret(candidate, 'CANDIDATE');
requireSecret(accessSecret, 'STAGING_CF_AUTHORIZATION');
requireSecret(openaiKey, 'STAGING_OPENAI_API_KEY');
requireSecret(cfToken, 'CLOUDFLARE_API_TOKEN');
requireSecret(cfAccount, 'CLOUDFLARE_ACCOUNT_ID');

const accessValue = String(accessSecret).trim().replace(/^CF_Authorization=/i, '').split(';', 1)[0].trim();
assert(accessValue.length > 20, 'STAGING_CF_AUTHORIZATION does not look like a usable Access application-session token.');
assert(!/\s/.test(accessValue), 'STAGING_CF_AUTHORIZATION contains whitespace.');

const cookies = new Map([['CF_Authorization', accessValue]]);
function cookieHeader() { return [...cookies.entries()].map(([k,v]) => `${k}=${v}`).join('; '); }
function absorbSetCookies(headers) {
  const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [headers.get('set-cookie')].filter(Boolean);
  for (const raw of values) {
    const first = String(raw).split(';', 1)[0];
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (!name) continue;
    if (!value) cookies.delete(name); else cookies.set(name, value);
  }
}

async function appRequest(route, { method='GET', json, body, headers={}, expect=200 } = {}) {
  const requestHeaders = new Headers(headers);
  requestHeaders.set('Cookie', cookieHeader());
  requestHeaders.set('Accept', 'application/json');
  if (method !== 'GET' && method !== 'HEAD') requestHeaders.set('Origin', BASE);
  let requestBody = body;
  if (json !== undefined) {
    requestHeaders.set('Content-Type', 'application/json');
    requestBody = JSON.stringify(json);
  }
  const response = await fetch(`${BASE}${route}`, { method, headers: requestHeaders, body: requestBody, redirect: 'manual' });
  absorbSetCookies(response.headers);
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch {}
  const accepted = Array.isArray(expect) ? expect.includes(response.status) : response.status === expect;
  if (!accepted) {
    const code = parsed?.error?.code || parsed?.code || 'non_json_response';
    const detail = response.status >= 300 && response.status < 400 ? 'Access redirect/session likely expired.' : code;
    fail(`${method} ${route} returned HTTP ${response.status}; ${detail}`);
  }
  return { response, json: parsed, text };
}

async function cfJson(url, init={}) {
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${cfToken}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { fail(`Cloudflare API returned non-JSON HTTP ${response.status}.`); }
  if (!response.ok || json?.success !== true) fail(`Cloudflare API request failed with HTTP ${response.status}.`);
  return json;
}

async function d1Query(databaseId, sql, params=[]) {
  const data = await cfJson(`https://api.cloudflare.com/client/v4/accounts/${cfAccount}/d1/database/${databaseId}/query`, {
    method: 'POST', body: JSON.stringify({ sql, params })
  });
  assert(Array.isArray(data.result) && data.result.length >= 1 && data.result.every(x => x?.success === true), 'D1 query did not report success.');
  return data.result;
}

async function sha256File(file) {
  const bytes = await readFile(file);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
function modelRequests(overview, model) { return Number(overview?.models?.find(x => x.model === model)?.requests || 0); }

let originalRegistrationMode = null;
let syntheticUserId = null;
let databaseId = null;
let mainError = null;

try {
  const pkg = JSON.parse(await readFile(path.join(candidate, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(candidate, 'RELEASE_MANIFEST.json'), 'utf8'));
  assert(pkg.version === EXPECTED_VERSION, `Candidate version mismatch: ${pkg.version}`);
  assert(manifest.releaseReady === false, 'Live staging acceptance must run against releaseReady:false candidate.');
  assert(manifest.certificationLevel === 'staging', 'Candidate is not staging-certified.');
  assert(await sha256File(path.join(candidate, 'package-lock.json')) === EXPECTED_LOCK_SHA256, 'Candidate dependency-lock SHA-256 mismatch.');
  console.log('PASS candidate identity: exact staging-certified V1.2 artifact; releaseReady remains false.');

  const settings = await cfJson(`https://api.cloudflare.com/client/v4/accounts/${cfAccount}/workers/scripts/${WORKER}/settings`);
  const bindings = settings?.result?.bindings;
  assert(Array.isArray(bindings), 'Current staging Worker bindings unavailable.');
  const d1 = bindings.find(x => x?.name === 'USER_DB' && x?.type === 'd1');
  databaseId = d1?.database_id || d1?.id;
  assert(typeof databaseId === 'string' && /^[0-9a-f-]{36}$/i.test(databaseId), 'Current staging USER_DB binding unavailable.');
  console.log('PASS staging target identity: existing Access/admin/D1 bindings resolved without printing private values.');

  const initial = await appRequest('/api/session/status');
  assert(initial.json?.ok === true, 'Session status did not return ok:true.');
  assert(initial.json?.version === EXPECTED_VERSION, 'Live Worker version mismatch.');
  assert(initial.json?.account?.isAdmin === true, 'Acceptance Access session must belong to a configured staging administrator.');
  assert(initial.json?.account?.status === 'active', 'Acceptance administrator account is not active.');
  originalRegistrationMode = initial.json.account.registrationMode;
  assert(['open','approval','closed'].includes(originalRegistrationMode), 'Invalid current registration mode.');
  console.log('PASS authenticated Cloudflare Access identity + active staging administrator session.');

  const overviewBefore = (await appRequest('/api/admin/overview')).json;
  assert(overviewBefore?.ok === true, 'Admin overview unavailable.');

  await appRequest('/api/key/session', { method:'POST', json:{ apiKey: openaiKey } });
  assert(cookies.has('__Host-cosmic_byok'), 'BYOK session cookie was not issued.');
  const configured = await appRequest('/api/session/status');
  assert(configured.json?.configured === true, 'BYOK session was not recognized after creation.');
  console.log('PASS BYOK encrypted browser-session lifecycle: create + status.');

  const keyTest = await appRequest('/api/key/test', { method:'POST', json:{ confirmMinimalUsage: true } });
  assert(keyTest.json?.ok === true && keyTest.json?.permitted === true, 'Dedicated staging OpenAI key minimal-permission test failed.');
  console.log('PASS live OpenAI BYOK permission smoke (minimal paid test).');

  for (const mode of ['open','approval','closed']) {
    const changed = await appRequest('/api/admin/settings/registration', { method:'PUT', json:{ mode } });
    assert(changed.json?.registrationMode === mode, `Registration mode did not change to ${mode}.`);
  }
  const restored = await appRequest('/api/admin/settings/registration', { method:'PUT', json:{ mode: originalRegistrationMode } });
  assert(restored.json?.registrationMode === originalRegistrationMode, 'Registration mode restoration failed.');
  console.log('PASS registration admin modes: open + approval + closed + restoration.');

  const now = Math.floor(Date.now()/1000);
  const syntheticEmail = `ctw-live-${crypto.randomUUID()}@example.invalid`;
  const syntheticSub = `live-acceptance-${crypto.randomUUID()}`;
  await d1Query(databaseId, `INSERT INTO cosmic_users(access_sub,email,status,created_at,last_seen_at,updated_at) VALUES(?,?,'active',?,?,?)`, [syntheticSub, syntheticEmail, String(now), String(now), String(now)]);
  const selected = await d1Query(databaseId, 'SELECT id FROM cosmic_users WHERE email=?', [syntheticEmail]);
  syntheticUserId = Number(selected?.[0]?.results?.[0]?.id);
  assert(Number.isSafeInteger(syntheticUserId) && syntheticUserId > 0, 'Synthetic staging user could not be created safely.');
  for (const status of ['blocked','pending','active']) {
    const changed = await appRequest(`/api/admin/users/${syntheticUserId}`, { method:'PATCH', json:{ status } });
    assert(changed.json?.id === syntheticUserId && changed.json?.status === status, `Admin user status did not change to ${status}.`);
  }
  console.log('PASS admin user block/pending/unblock lifecycle on isolated synthetic staging account.');

  const tableNames = ['cosmic_users','cosmic_jobs','cosmic_job_chunks','cosmic_model_usage','cosmic_admin_audit','cosmic_attempt_dispatches','cosmic_attempt_results'];
  const forbidden = /(audio|transcript|prompt|filename|api.?key|credential|secret|cookie)/i;
  for (const table of tableNames) {
    const info = await d1Query(databaseId, `PRAGMA table_info(${table})`);
    const names = (info?.[0]?.results || []).map(x => String(x.name));
    assert(names.length > 0, `Remote D1 table ${table} is missing.`);
    assert(!names.some(name => forbidden.test(name)), `Remote D1 table ${table} contains forbidden content-bearing column.`);
  }
  console.log('PASS remote staging D1 persistence schema: no transcript/audio/prompt/filename/credential columns.');

  let replay = null;
  for (const [format, mime] of Object.entries(FORMATS)) {
    const bytes = await readFile(path.join(candidate, 'tests', 'fixtures', `format.${format}`));
    const metadata = {
      v: 2, jobId: safeId(`live-${format}`), fileId: safeId(`file-${format}`), chunkIndex: 1, chunkCount: 1,
      attemptId: safeId(`attempt-${format}`), declaredBytes: bytes.byteLength, durationSeconds: 1,
      model: 'gpt-transcribe', languages: [], keywords: [], prompt: '', requestKind: 'transcription', audioFormat: format
    };
    const result = await appRequest('/api/transcribe', {
      method:'POST', body: bytes,
      headers: { 'Content-Type': mime, 'X-Cosmic-Metadata': b64urlJson(metadata), 'Content-Length': String(bytes.byteLength) }
    });
    assert(result.json?.ok === true && result.json?.diagnostics?.status === 200, `Live ${format} transcription did not succeed.`);
    if (format === 'mp3') replay = { bytes, mime, metadata };
    console.log(`PASS live transcription format .${format}`);
  }

  assert(replay, 'MP3 replay fixture missing.');
  const duplicate = await appRequest('/api/transcribe', {
    method:'POST', body: replay.bytes,
    headers: { 'Content-Type': replay.mime, 'X-Cosmic-Metadata': b64urlJson(replay.metadata), 'Content-Length': String(replay.bytes.byteLength) },
    expect: 409
  });
  assert((duplicate.json?.error?.code || duplicate.json?.code) === 'duplicate_usage_attempt', 'Duplicate paid-dispatch attempt was not rejected with duplicate_usage_attempt.');
  const mismatchMetadata = { ...replay.metadata, model:'gpt-4o-mini-transcribe' };
  const mismatch = await appRequest('/api/transcribe', {
    method:'POST', body: replay.bytes,
    headers: { 'Content-Type': replay.mime, 'X-Cosmic-Metadata': b64urlJson(mismatchMetadata), 'Content-Length': String(replay.bytes.byteLength) },
    expect: 409
  });
  const mismatchCode = mismatch.json?.error?.code || mismatch.json?.code;
  const mismatchBilling = mismatch.json?.error?.details?.billingState || mismatch.json?.details?.billingState;
  assert(mismatchCode === 'usage_attempt_identity_mismatch', 'Attempt-identity conflict was not rejected fail-closed.');
  assert(mismatchBilling === 'ambiguous_after_dispatch', 'Attempt-identity conflict did not preserve conservative billing state.');
  console.log('PASS billing safety: duplicate dispatch blocked pre-OpenAI + identity mismatch stays conservative/ambiguous.');

  const diarizeBytes = await readFile(path.join(candidate, 'tests', 'fixtures', 'format.mp3'));
  const diarizeMetadata = {
    v:2, jobId:safeId('live-diarize'), fileId:safeId('file-diarize'), chunkIndex:1, chunkCount:1,
    attemptId:safeId('attempt-diarize'), declaredBytes:diarizeBytes.byteLength, durationSeconds:1,
    model:'gpt-4o-transcribe-diarize', languages:[], keywords:[], prompt:'', requestKind:'transcription', audioFormat:'mp3'
  };
  const diarized = await appRequest('/api/transcribe', {
    method:'POST', body:diarizeBytes,
    headers:{ 'Content-Type':'audio/mpeg', 'X-Cosmic-Metadata':b64urlJson(diarizeMetadata), 'Content-Length':String(diarizeBytes.byteLength) }
  });
  assert(diarized.json?.ok === true && diarized.json?.diagnostics?.status === 200, 'Live diarization request failed.');
  console.log('PASS live diarization dispatch.');

  const overviewAfter = (await appRequest('/api/admin/overview')).json;
  assert(modelRequests(overviewAfter, 'gpt-transcribe') >= modelRequests(overviewBefore, 'gpt-transcribe') + 9, 'Usage aggregates did not record all nine normal live transcription dispatches.');
  assert(modelRequests(overviewAfter, 'gpt-4o-transcribe-diarize') >= modelRequests(overviewBefore, 'gpt-4o-transcribe-diarize') + 1, 'Usage aggregates did not record live diarization dispatch.');
  console.log('PASS usage aggregates increased without transcript/audio persistence.');

  const forgotten = await appRequest('/api/key/forget', { method:'DELETE' });
  assert(forgotten.json?.configured === false, 'BYOK forget endpoint did not clear configuration.');
  const afterForget = await appRequest('/api/session/status');
  assert(afterForget.json?.configured === false, 'BYOK session remained configured after forget.');
  console.log('PASS BYOK forget + post-forget session status.');
  console.log('LIVE_STAGING_API_ACCEPTANCE_PASS');
} catch (error) {
  mainError = error;
} finally {
  if (originalRegistrationMode) {
    try { await appRequest('/api/admin/settings/registration', { method:'PUT', json:{ mode: originalRegistrationMode } }); }
    catch (error) { console.error(`CLEANUP WARNING: could not restore registration mode: ${error.message}`); if (!mainError) mainError = error; }
  }
  if (databaseId && syntheticUserId) {
    try {
      await d1Query(databaseId, 'DELETE FROM cosmic_admin_audit WHERE target_user_id=?', [String(syntheticUserId)]);
      await d1Query(databaseId, 'DELETE FROM cosmic_users WHERE id=?', [String(syntheticUserId)]);
    } catch (error) {
      console.error(`CLEANUP WARNING: could not remove synthetic staging user: ${error.message}`);
      if (!mainError) mainError = error;
    }
  }
  if (cookies.has('__Host-cosmic_byok')) {
    try { await appRequest('/api/key/forget', { method:'DELETE' }); } catch {}
  }
}

if (mainError) {
  console.error(`LIVE_STAGING_API_ACCEPTANCE_FAIL: ${mainError.message}`);
  process.exitCode = 1;
}
