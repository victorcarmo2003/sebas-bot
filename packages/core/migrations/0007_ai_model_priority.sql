ALTER TABLE ai_provider_settings ADD COLUMN auto_switch_enabled INTEGER NOT NULL DEFAULT 1;

CREATE TABLE ai_provider_models (
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  rate_limited_until TEXT,
  PRIMARY KEY (provider_id, model_id)
);
CREATE INDEX idx_ai_provider_models_provider ON ai_provider_models (provider_id, position);

CREATE TABLE bot_parameters (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL
);
