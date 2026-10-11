-- Additive V1.1.1 usage-accounting and paid-dispatch hardening.
-- Stores only opaque request identifiers and bounded operational metadata;
-- never credential material, audio content, transcript content, prompts or filenames.
CREATE TABLE IF NOT EXISTS cosmic_attempt_dispatches (
  user_id INTEGER NOT NULL,
  job_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  model TEXT NOT NULL,
  chunk_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, job_id, attempt_id),
  FOREIGN KEY(user_id, job_id) REFERENCES cosmic_jobs(user_id, job_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cosmic_attempt_dispatches_created ON cosmic_attempt_dispatches(created_at DESC);

CREATE TABLE IF NOT EXISTS cosmic_attempt_results (
  user_id INTEGER NOT NULL,
  job_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  success INTEGER NOT NULL CHECK(success IN (0,1)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, job_id, attempt_id),
  FOREIGN KEY(user_id, job_id, attempt_id) REFERENCES cosmic_attempt_dispatches(user_id, job_id, attempt_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cosmic_attempt_results_created ON cosmic_attempt_results(created_at DESC);
