CREATE TABLE IF NOT EXISTS cosmic_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO cosmic_settings(key, value, updated_at)
VALUES ('registration_mode', 'open', unixepoch());

CREATE TABLE IF NOT EXISTS cosmic_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  access_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('pending','active','blocked')),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  approved_at INTEGER,
  blocked_at INTEGER,
  updated_at INTEGER NOT NULL,
  jobs_started INTEGER NOT NULL DEFAULT 0,
  chunks_started INTEGER NOT NULL DEFAULT 0,
  chunks_succeeded INTEGER NOT NULL DEFAULT 0,
  chunks_failed INTEGER NOT NULL DEFAULT 0,
  bytes_requested INTEGER NOT NULL DEFAULT 0,
  audio_seconds_requested REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cosmic_users_status ON cosmic_users(status);
CREATE INDEX IF NOT EXISTS idx_cosmic_users_last_seen ON cosmic_users(last_seen_at DESC);

CREATE TABLE IF NOT EXISTS cosmic_jobs (
  user_id INTEGER NOT NULL,
  job_id TEXT NOT NULL,
  model TEXT NOT NULL,
  chunk_count INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','completed','error')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, job_id),
  FOREIGN KEY(user_id) REFERENCES cosmic_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cosmic_jobs_created ON cosmic_jobs(created_at DESC);

CREATE TABLE IF NOT EXISTS cosmic_job_chunks (
  user_id INTEGER NOT NULL,
  job_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  attempts_started INTEGER NOT NULL DEFAULT 0,
  successes INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('running','completed','error')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, job_id, chunk_index),
  FOREIGN KEY(user_id, job_id) REFERENCES cosmic_jobs(user_id, job_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cosmic_model_usage (
  model TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  bytes_requested INTEGER NOT NULL DEFAULT 0,
  audio_seconds_requested REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cosmic_admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  target_user_id INTEGER,
  detail TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(actor_user_id) REFERENCES cosmic_users(id) ON DELETE RESTRICT,
  FOREIGN KEY(target_user_id) REFERENCES cosmic_users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_cosmic_admin_audit_created ON cosmic_admin_audit(created_at DESC);
