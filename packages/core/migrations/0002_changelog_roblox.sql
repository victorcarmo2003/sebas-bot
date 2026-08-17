CREATE TABLE changelog_roblox_guild_settings (
  guild_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE changelog_roblox_guild_state (
  guild_id TEXT PRIMARY KEY,
  initialized_at TEXT NOT NULL,
  processed_guids TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE changelog_roblox_posted (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  guid TEXT NOT NULL,
  title TEXT NOT NULL,
  version_number TEXT,
  channel_id TEXT NOT NULL,
  posted_at TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE INDEX idx_changelog_roblox_posted_guild ON changelog_roblox_posted (guild_id);
CREATE INDEX idx_changelog_roblox_posted_posted_at ON changelog_roblox_posted (posted_at);

INSERT INTO modules (id, display_name, source, enabled) VALUES ('changelog-roblox', 'Changelog do Roblox', 'in-tree', 1);
