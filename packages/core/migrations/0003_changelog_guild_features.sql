ALTER TABLE changelog_roblox_guild_settings ADD COLUMN mention_role_id TEXT;
ALTER TABLE changelog_roblox_guild_settings ADD COLUMN mention_role_enabled INTEGER NOT NULL DEFAULT 0;

CREATE TABLE changelog_roblox_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  rss_url TEXT,
  max_items_per_poll INTEGER
);

INSERT INTO changelog_roblox_settings (id, rss_url, max_items_per_poll) VALUES (1, NULL, NULL);
