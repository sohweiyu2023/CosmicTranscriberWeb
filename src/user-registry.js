import { ApiError } from './errors.js';

const USER_STATUSES = new Set(['pending', 'active', 'blocked']);
const REGISTRATION_MODES = new Set(['open', 'approval', 'closed']);
const LAST_SEEN_WRITE_INTERVAL_SECONDS = 300;
const MAX_ADMIN_EMAILS = 32;
const MAX_ADMIN_LIST_OFFSET = 10_000;

function nowSeconds() { return Math.floor(Date.now() / 1000); }

export function normalizeIdentityEmail(value) {
  if (typeof value !== 'string') throw new ApiError(401, 'access_identity_missing', 'Cloudflare Access did not provide a verified user email.');
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(401, 'access_identity_invalid', 'Cloudflare Access did not provide a usable verified user email.');
  }
  return email;
}

export function configuredAdminEmails(env) {
  const raw = String(env?.ADMIN_EMAILS || '');
  const emails = raw.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (emails.length < 1 || emails.length > MAX_ADMIN_EMAILS || new Set(emails).size !== emails.length) {
    throw new ApiError(503, 'admin_config_invalid', 'Cosmic Transcriber administrator configuration is unavailable.');
  }
  for (const email of emails) normalizeIdentityEmail(email);
  return new Set(emails);
}

export function principalIsAdmin(principal, env) {
  return configuredAdminEmails(env).has(normalizeIdentityEmail(principal?.email));
}

function db(env) {
  if (!env?.USER_DB || typeof env.USER_DB.prepare !== 'function' || typeof env.USER_DB.batch !== 'function') {
    throw new ApiError(503, 'user_registry_unavailable', 'The Cosmic Transcriber user registry is unavailable.');
  }
  return env.USER_DB;
}

async function registrationMode(env) {
  const row = await db(env).prepare("SELECT value FROM cosmic_settings WHERE key = 'registration_mode'").first();
  const mode = row?.value || 'open';
  if (!REGISTRATION_MODES.has(mode)) throw new ApiError(503, 'user_registry_invalid', 'The Cosmic Transcriber registration setting is invalid.');
  return mode;
}

function accountFromRow(row, { isAdmin, mode }) {
  return {
    userId: Number(row.id),
    status: row.status,
    email: row.email,
    isAdmin,
    registrationMode: mode,
    createdAt: Number(row.created_at),
    lastSeenAt: Number(row.last_seen_at)
  };
}

async function selectUserBySub(env, sub) {
  return db(env).prepare(`SELECT id, access_sub, email, status, created_at, last_seen_at, approved_at, blocked_at
    FROM cosmic_users WHERE access_sub = ?`).bind(sub).first();
}

async function selectUserByEmail(env, email) {
  return db(env).prepare(`SELECT id, access_sub, email, status, created_at, last_seen_at, approved_at, blocked_at
    FROM cosmic_users WHERE email = ?`).bind(email).first();
}

async function insertUser(env, principal, status, now) {
  const email = normalizeIdentityEmail(principal.email);
  try {
    await db(env).prepare(`INSERT INTO cosmic_users
      (access_sub, email, status, created_at, last_seen_at, approved_at, blocked_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`) 
      .bind(principal.sub, email, status, now, now, status === 'active' ? now : null, status === 'blocked' ? now : null, now).run();
  } catch {
    // A concurrent first request may have created the same verified identity.
    const existing = await selectUserBySub(env, principal.sub) || await selectUserByEmail(env, email);
    if (!existing) throw new ApiError(503, 'user_registry_unavailable', 'The Cosmic Transcriber user registry could not create your account.');
  }
}

async function reconcileSubject(env, row, principal, now) {
  if (row.access_sub === principal.sub) return row;
  try {
    await db(env).prepare('UPDATE cosmic_users SET access_sub = ?, updated_at = ? WHERE id = ?')
      .bind(principal.sub, now, row.id).run();
  } catch {
    throw new ApiError(409, 'identity_reconciliation_failed', 'This verified email is already associated with another active Cosmic identity. Please sign out of Cloudflare Access and sign in again.');
  }
  return { ...row, access_sub: principal.sub };
}

async function touchUser(env, row, principal, { isAdmin, now }) {
  const email = normalizeIdentityEmail(principal.email);
  const forceActive = isAdmin && row.status !== 'active';
  const stale = !Number.isFinite(Number(row.last_seen_at)) || now - Number(row.last_seen_at) >= LAST_SEEN_WRITE_INTERVAL_SECONDS;
  if (!forceActive && !stale) return row;
  const status = forceActive ? 'active' : row.status;
  await db(env).prepare(`UPDATE cosmic_users SET
      status = ?, last_seen_at = ?,
      approved_at = CASE WHEN ? = 'active' AND approved_at IS NULL THEN ? ELSE approved_at END,
      blocked_at = CASE WHEN ? = 'blocked' THEN COALESCE(blocked_at, ?) ELSE NULL END,
      updated_at = ?
    WHERE id = ? AND email = ?`)
    .bind(status, now, status, now, status, now, now, row.id, email).run();
  return { ...row, status, last_seen_at: now };
}

export async function resolveUserAccount(env, principal) {
  if (!principal?.sub || typeof principal.sub !== 'string' || principal.sub.length > 512) throw new ApiError(401, 'access_identity_missing', 'Cloudflare Access user identity is unavailable.');
  const email = normalizeIdentityEmail(principal.email);
  const isAdmin = principalIsAdmin({ ...principal, email }, env);
  const mode = await registrationMode(env);
  const now = nowSeconds();
  let row = await selectUserBySub(env, principal.sub);

  if (row && row.email !== email) {
    // Access documents `sub` as unique to an email per Zero Trust account. A
    // different verified email on the same subject is therefore a fail-closed
    // identity inconsistency rather than an automatic account rename.
    throw new ApiError(409, 'identity_email_mismatch', 'The verified Cloudflare Access identity no longer matches this Cosmic account.');
  }

  if (!row) {
    const byEmail = await selectUserByEmail(env, email);
    if (byEmail) {
      // Cloudflare documents that `sub` changes when a user is removed and
      // re-added to a Zero Trust organization. Preserve their Cosmic status and
      // aggregate usage by reconciling the new subject to the verified email.
      row = await reconcileSubject(env, byEmail, { ...principal, email }, now);
    } else {
      if (!isAdmin && mode === 'closed') {
        return { userId: null, status: 'registration_closed', email, isAdmin: false, registrationMode: mode, createdAt: null, lastSeenAt: null };
      }
      const initialStatus = isAdmin || mode === 'open' ? 'active' : 'pending';
      await insertUser(env, { ...principal, email }, initialStatus, now);
      row = await selectUserBySub(env, principal.sub) || await selectUserByEmail(env, email);
      if (!row) throw new ApiError(503, 'user_registry_unavailable', 'The Cosmic Transcriber user registry could not create your account.');
      if (row.access_sub !== principal.sub) row = await reconcileSubject(env, row, { ...principal, email }, now);
    }
  }

  row = await touchUser(env, row, { ...principal, email }, { isAdmin, now });
  if (!USER_STATUSES.has(row.status)) throw new ApiError(503, 'user_registry_invalid', 'The Cosmic Transcriber user account state is invalid.');
  return accountFromRow(row, { isAdmin, mode });
}

export function requireActiveAccount(account) {
  if (account?.isAdmin || account?.status === 'active') return account;
  if (account?.status === 'pending') throw new ApiError(403, 'registration_pending', 'Your Cosmic Transcriber registration is awaiting approval.');
  if (account?.status === 'blocked') throw new ApiError(403, 'account_blocked', 'This Cosmic Transcriber account is blocked.');
  if (account?.status === 'registration_closed') throw new ApiError(403, 'registration_closed', 'New Cosmic Transcriber registrations are currently closed.');
  throw new ApiError(403, 'account_inactive', 'This Cosmic Transcriber account is not active.');
}

export function requireAdminAccount(account) {
  if (account?.isAdmin) return account;
  throw new ApiError(403, 'admin_required', 'Cosmic Transcriber administrator access is required.');
}

function boundedInteger(value, fallback, min, max) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : fallback;
}

export async function adminOverview(env) {
  const database = db(env);
  const now = nowSeconds();
  const [users, jobs, usage, models, mode] = await Promise.all([
    database.prepare(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='blocked' THEN 1 ELSE 0 END) AS blocked,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_24h,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_7d,
      SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END) AS seen_24h
      FROM cosmic_users`).bind(now - 86400, now - 7 * 86400, now - 86400).first(),
    database.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed FROM cosmic_jobs`).first(),
    database.prepare(`SELECT
      COALESCE(SUM(chunks_started),0) AS chunks_started,
      COALESCE(SUM(chunks_succeeded),0) AS chunks_succeeded,
      COALESCE(SUM(chunks_failed),0) AS chunks_failed,
      COALESCE(SUM(bytes_requested),0) AS bytes_requested,
      COALESCE(SUM(audio_seconds_requested),0) AS audio_seconds_requested
      FROM cosmic_users`).first(),
    database.prepare(`SELECT model, request_count, success_count, failure_count, bytes_requested, audio_seconds_requested
      FROM cosmic_model_usage ORDER BY request_count DESC, model ASC LIMIT 32`).all(),
    registrationMode(env)
  ]);
  return {
    registrationMode: mode,
    users: {
      total: Number(users?.total || 0), active: Number(users?.active || 0), pending: Number(users?.pending || 0), blocked: Number(users?.blocked || 0),
      new24h: Number(users?.new_24h || 0), new7d: Number(users?.new_7d || 0), seen24h: Number(users?.seen_24h || 0)
    },
    jobs: { total: Number(jobs?.total || 0), completed: Number(jobs?.completed || 0) },
    usage: {
      chunksStarted: Number(usage?.chunks_started || 0), chunksSucceeded: Number(usage?.chunks_succeeded || 0), chunksFailed: Number(usage?.chunks_failed || 0),
      bytesRequested: Number(usage?.bytes_requested || 0), audioSecondsRequested: Number(usage?.audio_seconds_requested || 0)
    },
    models: Array.isArray(models?.results) ? models.results.map(x => ({
      model: String(x.model), requests: Number(x.request_count || 0), successes: Number(x.success_count || 0), failures: Number(x.failure_count || 0),
      bytesRequested: Number(x.bytes_requested || 0), audioSecondsRequested: Number(x.audio_seconds_requested || 0)
    })) : []
  };
}

export async function adminListUsers(env, { status = 'all', limit = 100, offset = 0 } = {}) {
  const database = db(env);
  const boundedLimit = boundedInteger(limit, 100, 1, 100);
  const boundedOffset = boundedInteger(offset, 0, 0, MAX_ADMIN_LIST_OFFSET);
  const params = [];
  let where = '';
  if (status !== 'all') {
    if (!USER_STATUSES.has(status)) throw new ApiError(400, 'invalid_admin_filter', 'Unsupported user-status filter.');
    where = 'WHERE status = ?';
    params.push(status);
  }
  const stmt = database.prepare(`SELECT id, email, status, created_at, last_seen_at, approved_at, blocked_at,
    jobs_started, chunks_started, chunks_succeeded, chunks_failed, bytes_requested, audio_seconds_requested
    FROM cosmic_users ${where} ORDER BY last_seen_at DESC, created_at DESC LIMIT ? OFFSET ?`);
  const result = await stmt.bind(...params, boundedLimit, boundedOffset).all();
  return {
    users: (result?.results || []).map(row => ({
      id: Number(row.id), email: row.email, status: row.status, isAdmin: configuredAdminEmails(env).has(normalizeIdentityEmail(row.email)),
      createdAt: Number(row.created_at), lastSeenAt: Number(row.last_seen_at),
      approvedAt: row.approved_at == null ? null : Number(row.approved_at), blockedAt: row.blocked_at == null ? null : Number(row.blocked_at),
      jobsStarted: Number(row.jobs_started || 0), chunksStarted: Number(row.chunks_started || 0), chunksSucceeded: Number(row.chunks_succeeded || 0),
      chunksFailed: Number(row.chunks_failed || 0), bytesRequested: Number(row.bytes_requested || 0), audioSecondsRequested: Number(row.audio_seconds_requested || 0)
    })),
    limit: boundedLimit,
    offset: boundedOffset
  };
}

export async function adminSetRegistrationMode(env, actorAccount, mode) {
  if (!REGISTRATION_MODES.has(mode)) throw new ApiError(400, 'invalid_registration_mode', 'Registration mode must be open, approval, or closed.');
  if (actorAccount?.isAdmin !== true || !Number.isSafeInteger(Number(actorAccount?.userId))) throw new ApiError(403, 'admin_required', 'Cosmic Transcriber administrator access is required.');
  const now = nowSeconds();
  const database = db(env);
  await database.batch([
    database.prepare(`INSERT INTO cosmic_settings(key,value,updated_at) VALUES('registration_mode', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).bind(mode, now),
    database.prepare(`INSERT INTO cosmic_admin_audit(actor_user_id, action, target_user_id, detail, created_at)
      VALUES(?, 'registration_mode', NULL, ?, ?)`).bind(Number(actorAccount.userId), mode, now)
  ]);
  return { registrationMode: mode };
}

export async function adminSetUserStatus(env, actorAccount, targetUserId, status) {
  if (!USER_STATUSES.has(status)) throw new ApiError(400, 'invalid_user_status', 'User status must be pending, active, or blocked.');
  const id = Number(targetUserId);
  if (!Number.isSafeInteger(id) || id < 1) throw new ApiError(400, 'invalid_user_id', 'User identifier is malformed.');
  if (actorAccount?.isAdmin !== true || !Number.isSafeInteger(Number(actorAccount?.userId))) throw new ApiError(403, 'admin_required', 'Cosmic Transcriber administrator access is required.');
  const database = db(env);
  const row = await database.prepare('SELECT id, email, status FROM cosmic_users WHERE id = ?').bind(id).first();
  if (!row) throw new ApiError(404, 'user_not_found', 'Cosmic Transcriber user was not found.');
  if (configuredAdminEmails(env).has(normalizeIdentityEmail(row.email))) throw new ApiError(400, 'admin_status_protected', 'Administrator account status is protected by configuration.');
  const now = nowSeconds();
  await database.batch([
    database.prepare(`UPDATE cosmic_users SET status=?,
      approved_at=CASE WHEN ?='active' THEN COALESCE(approved_at, ?) ELSE approved_at END,
      blocked_at=CASE WHEN ?='blocked' THEN ? ELSE NULL END,
      updated_at=? WHERE id=?`).bind(status, status, now, status, now, now, id),
    database.prepare(`INSERT INTO cosmic_admin_audit(actor_user_id, action, target_user_id, detail, created_at)
      VALUES(?, 'user_status', ?, ?, ?)`).bind(Number(actorAccount.userId), id, status, now)
  ]);
  return { id, status };
}

async function userIdForPrincipal(env, principal) {
  const row = await selectUserBySub(env, principal.sub);
  if (!row) throw new ApiError(503, 'user_registry_unavailable', 'The active Cosmic Transcriber user record could not be found.');
  return Number(row.id);
}

function positiveInt(value, code) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new ApiError(400, code, 'Transcription usage metadata is invalid.');
  return n;
}

async function existingAttemptDispatch(database, userId, metadata) {
  return database.prepare(`SELECT chunk_index, model, chunk_count FROM cosmic_attempt_dispatches
    WHERE user_id=? AND job_id=? AND attempt_id=?`).bind(userId, metadata.jobId, metadata.attemptId).first();
}

function assertMatchingAttemptDispatch(row, metadata) {
  if (Number(row.chunk_index) !== Number(metadata.chunkIndex) || row.model !== metadata.model || Number(row.chunk_count) !== Number(metadata.chunkCount)) {
    throw new ApiError(409, 'usage_attempt_identity_mismatch', 'The transcription attempt identity conflicts with an existing dispatch.', { billingState: 'ambiguous_after_dispatch' });
  }
}

function duplicateAttemptError() {
  return new ApiError(409, 'duplicate_usage_attempt', 'This transcription attempt identifier was already accepted. A prior request with this identifier may already be in progress or billed; retry only with a new attempt after explicit confirmation.', { billingState: 'ambiguous_after_dispatch' });
}

export async function recordTranscriptionDispatch(env, principal, metadata) {
  const database = db(env);
  const userId = await userIdForPrincipal(env, principal);
  const now = nowSeconds();
  const declaredBytes = positiveInt(metadata.declaredBytes, 'invalid_usage_bytes');
  const chunkIndex = positiveInt(metadata.chunkIndex, 'invalid_usage_chunk');
  const chunkCount = positiveInt(metadata.chunkCount, 'invalid_usage_chunks');
  if (!validAttemptId(metadata.attemptId)) throw new ApiError(400, 'invalid_usage_attempt', 'Transcription usage metadata is invalid.');
  const seconds = Math.max(0, Number(metadata.durationSeconds) || 0);

  // attemptId is a server-side single-use key. Rejecting a replay before the
  // OpenAI call prevents duplicate browser/network delivery from silently
  // becoming a second paid dispatch. Explicit retries already create a fresh
  // attemptId in the browser and are therefore unaffected.
  const existingAttempt = await existingAttemptDispatch(database, userId, metadata);
  if (existingAttempt) {
    assertMatchingAttemptDispatch(existingAttempt, metadata);
    throw duplicateAttemptError();
  }

  const existingJob = await database.prepare('SELECT model, chunk_count FROM cosmic_jobs WHERE user_id=? AND job_id=?').bind(userId, metadata.jobId).first();
  if (existingJob && (existingJob.model !== metadata.model || Number(existingJob.chunk_count) !== chunkCount)) {
    throw new ApiError(409, 'usage_job_identity_mismatch', 'The transcription job identity conflicts with an existing job.');
  }

  try {
    // The logical job row and its first attempt receipt commit atomically. The
    // ON CONFLICT branch accepts only the same immutable job identity; assigning
    // NULL to the NOT NULL updated_at column deliberately aborts the entire D1
    // batch if a concurrent request raced in with a conflicting model/chunk
    // count. This prevents an orphan running job or partially incremented usage
    // record when dispatch accounting fails before the paid OpenAI call.
    await database.batch([
      database.prepare(`INSERT INTO cosmic_jobs(user_id, job_id, model, chunk_count, created_at, updated_at, status)
        VALUES(?,?,?,?,?,?,'running')
        ON CONFLICT(user_id,job_id) DO UPDATE SET
          updated_at=CASE WHEN cosmic_jobs.model=excluded.model AND cosmic_jobs.chunk_count=excluded.chunk_count THEN excluded.updated_at ELSE NULL END`)
        .bind(userId, metadata.jobId, metadata.model, chunkCount, now, now),
      database.prepare(`INSERT INTO cosmic_attempt_dispatches(user_id, job_id, attempt_id, chunk_index, model, chunk_count, created_at)
        VALUES(?,?,?,?,?,?,?)`).bind(userId, metadata.jobId, metadata.attemptId, chunkIndex, metadata.model, chunkCount, now),
      database.prepare(`INSERT INTO cosmic_job_chunks(user_id, job_id, chunk_index, attempts_started, status, updated_at)
        VALUES(?,?,?,1,'running',?)
        ON CONFLICT(user_id,job_id,chunk_index) DO UPDATE SET attempts_started=attempts_started+1,
        status=CASE WHEN status='completed' THEN status ELSE 'running' END, updated_at=excluded.updated_at`)
        .bind(userId, metadata.jobId, chunkIndex, now),
      database.prepare(`UPDATE cosmic_users SET
        jobs_started=(SELECT COUNT(*) FROM cosmic_jobs WHERE user_id=?), chunks_started=chunks_started+1,
        bytes_requested=bytes_requested+?, audio_seconds_requested=audio_seconds_requested+?, updated_at=? WHERE id=?`)
        .bind(userId, declaredBytes, seconds, now, userId),
      database.prepare(`INSERT INTO cosmic_model_usage(model, request_count, success_count, failure_count, bytes_requested, audio_seconds_requested, updated_at)
        VALUES(?,1,0,0,?,?,?) ON CONFLICT(model) DO UPDATE SET request_count=request_count+1,
        bytes_requested=bytes_requested+excluded.bytes_requested, audio_seconds_requested=audio_seconds_requested+excluded.audio_seconds_requested,
        updated_at=excluded.updated_at`).bind(metadata.model, declaredBytes, seconds, now),
      database.prepare(`UPDATE cosmic_jobs SET updated_at=?, status=CASE WHEN status='completed' THEN status ELSE 'running' END
        WHERE user_id=? AND job_id=?`).bind(now, userId, metadata.jobId)
    ]);
  } catch (error) {
    // Concurrent duplicate requests can race the initial lookup. The unique
    // attempt receipt makes one transaction win; the loser is rejected before
    // dispatchTranscription() can call OpenAI.
    const raced = await existingAttemptDispatch(database, userId, metadata).catch(() => null);
    if (raced) {
      assertMatchingAttemptDispatch(raced, metadata);
      throw duplicateAttemptError();
    }
    const racedJob = await database.prepare('SELECT model, chunk_count FROM cosmic_jobs WHERE user_id=? AND job_id=?').bind(userId, metadata.jobId).first().catch(() => null);
    if (racedJob && (racedJob.model !== metadata.model || Number(racedJob.chunk_count) !== chunkCount)) {
      throw new ApiError(409, 'usage_job_identity_mismatch', 'The transcription job identity conflicts with an existing job.');
    }
    throw error;
  }
}

async function refreshJobStatus(database, userId, jobId, now) {
  const summary = await database.prepare(`SELECT
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors
    FROM cosmic_job_chunks WHERE user_id=? AND job_id=?`).bind(userId, jobId).first();
  const job = await database.prepare('SELECT chunk_count FROM cosmic_jobs WHERE user_id=? AND job_id=?').bind(userId, jobId).first();
  if (!job) return;
  const completed = Number(summary?.completed || 0);
  const errors = Number(summary?.errors || 0);
  const status = completed >= Number(job.chunk_count) ? 'completed' : errors > 0 ? 'error' : 'running';
  await database.prepare('UPDATE cosmic_jobs SET status=?, updated_at=? WHERE user_id=? AND job_id=?').bind(status, now, userId, jobId).run();
}

function validAttemptId(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 100 && /^[A-Za-z0-9._:-]+$/.test(value);
}

async function existingAttemptResult(database, userId, metadata) {
  return database.prepare(`SELECT chunk_index, success FROM cosmic_attempt_results
    WHERE user_id=? AND job_id=? AND attempt_id=?`).bind(userId, metadata.jobId, metadata.attemptId).first();
}

function assertMatchingAttemptResult(row, metadata, success) {
  if (Number(row.chunk_index) !== Number(metadata.chunkIndex) || Number(row.success) !== (success ? 1 : 0)) {
    throw new ApiError(409, 'usage_attempt_result_conflict', 'The transcription attempt result conflicts with an existing accounting record.');
  }
}

export async function recordTranscriptionResult(env, principal, metadata, { success }) {
  const database = db(env);
  const userId = await userIdForPrincipal(env, principal);
  const now = nowSeconds();
  const chunkIndex = positiveInt(metadata.chunkIndex, 'invalid_usage_chunk');
  if (!validAttemptId(metadata.attemptId)) throw new ApiError(400, 'invalid_usage_attempt', 'Transcription usage metadata is invalid.');
  const dispatched = await existingAttemptDispatch(database, userId, metadata);
  if (!dispatched) throw new ApiError(409, 'usage_attempt_dispatch_missing', 'The transcription result does not match a recorded dispatch.');
  assertMatchingAttemptDispatch(dispatched, metadata);

  // Outcome persistence is idempotent per validated attemptId. This makes it
  // safe for the Worker to retry a background D1 write without double-counting
  // user/model/chunk statistics. D1 batch() is transactional: if any statement
  // fails, the receipt and all aggregate increments roll back together.
  const existing = await existingAttemptResult(database, userId, metadata);
  if (existing) {
    assertMatchingAttemptResult(existing, metadata, success);
    await refreshJobStatus(database, userId, metadata.jobId, now);
    return { duplicate: true };
  }

  try {
    await database.batch([
      database.prepare(`INSERT INTO cosmic_attempt_results(user_id, job_id, attempt_id, chunk_index, success, created_at)
        VALUES(?,?,?,?,?,?)`).bind(userId, metadata.jobId, metadata.attemptId, chunkIndex, success ? 1 : 0, now),
      database.prepare(`UPDATE cosmic_users SET chunks_succeeded=chunks_succeeded+?, chunks_failed=chunks_failed+?, updated_at=? WHERE id=?`)
        .bind(success ? 1 : 0, success ? 0 : 1, now, userId),
      database.prepare(`UPDATE cosmic_model_usage SET success_count=success_count+?, failure_count=failure_count+?, updated_at=? WHERE model=?`)
        .bind(success ? 1 : 0, success ? 0 : 1, now, metadata.model),
      database.prepare(`UPDATE cosmic_job_chunks SET successes=successes+?, failures=failures+?,
        status=CASE WHEN successes+? > 0 THEN 'completed' ELSE 'error' END, updated_at=?
        WHERE user_id=? AND job_id=? AND chunk_index=?`)
        .bind(success ? 1 : 0, success ? 0 : 1, success ? 1 : 0, now, userId, metadata.jobId, chunkIndex)
    ]);
  } catch (error) {
    // A concurrent duplicate result can race the initial existence check. If
    // the other transaction committed the exact same receipt, treat this as an
    // idempotent replay; otherwise preserve the original failure.
    const raced = await existingAttemptResult(database, userId, metadata).catch(() => null);
    if (!raced) throw error;
    assertMatchingAttemptResult(raced, metadata, success);
  }

  await refreshJobStatus(database, userId, metadata.jobId, now);
  return { duplicate: false };
}
