CREATE TABLE github_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  token TEXT,
  updated_at TEXT
);

INSERT INTO github_settings (id, token, updated_at) VALUES (1, NULL, NULL);
