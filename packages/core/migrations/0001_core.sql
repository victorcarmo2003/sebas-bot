CREATE TABLE admins (
  discord_user_id TEXT PRIMARY KEY,
  display_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner','subadmin')),
  permissions TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE run_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  level TEXT NOT NULL,
  context TEXT NOT NULL,
  guild_id TEXT,
  module_id TEXT,
  message TEXT NOT NULL,
  meta TEXT
);
CREATE INDEX idx_run_logs_created_at ON run_logs (created_at);
CREATE INDEX idx_run_logs_context ON run_logs (context);

CREATE TABLE modules (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'in-tree',
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  dedupe_key TEXT,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_after TEXT NOT NULL,
  claimed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_error TEXT
);
CREATE UNIQUE INDEX idx_jobs_dedupe ON jobs (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX idx_jobs_status_run_after ON jobs (status, run_after);

CREATE TABLE pending_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical')) DEFAULT 'warning',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  action_kind TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  target_discord_user_id TEXT,
  notified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT
);
CREATE INDEX idx_pending_actions_unresolved ON pending_actions (resolved_at);

CREATE TABLE ai_provider_settings (
  provider_id TEXT PRIMARY KEY,
  api_key TEXT,
  selected_model TEXT,
  status TEXT NOT NULL DEFAULT 'unconfigured',
  last_checked_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL
);
