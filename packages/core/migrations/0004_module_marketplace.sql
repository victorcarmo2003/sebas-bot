CREATE TABLE module_installs (
  id TEXT PRIMARY KEY,
  repo_url TEXT NOT NULL,
  pinned_sha TEXT NOT NULL,
  installed_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','approved','enabled','disabled','rejected')) DEFAULT 'pending',
  manifest TEXT NOT NULL,
  first_enabled_at TEXT,
  first_enabled_by TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE module_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id TEXT NOT NULL REFERENCES module_installs (id),
  grant_type TEXT NOT NULL CHECK (grant_type IN ('adminScope','providesScope','networkDomain','storage','discordPermission','aiProviderDependency')),
  grant_value TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT
);
CREATE INDEX idx_module_grants_module ON module_grants (module_id);
CREATE INDEX idx_module_grants_active ON module_grants (module_id, revoked_at);

CREATE TABLE module_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id TEXT NOT NULL REFERENCES module_installs (id),
  event_type TEXT NOT NULL,
  actor_discord_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_module_events_module ON module_events (module_id, created_at);

-- Key-value sempre liberado pra qualquer modulo, mesmo no self-test de instalacao
-- (antes de qualquer grant) — e' o que ctx.storage usa.
CREATE TABLE module_storage (
  module_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (module_id, key)
);

CREATE TABLE module_config (
  module_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (module_id, key)
);
