// Backfill de dado de producao: copia o schema antigo do modulo changelog-roblox (tabelas
// criadas pelas migrations 0002/0003, usadas pelo core antigo com acesso direto ao db) pro
// schema novo que o modulo usa hoje atraves de ctx.storage/ctx.config/ctx.sql (ver M4/M9 em
// MILESTONES.md — o modulo novo NUNCA le as tabelas antigas, elas ficam orfas no schema).
//
// So roda uma vez, manualmente, contra um sebas.db real que ja tenha as migrations 0001-0005
// aplicadas (rode `npm run migrate` antes). Idempotente: usa "ON CONFLICT ... DO UPDATE" nas
// tabelas novas, entao rodar de novo so reescreve o mesmo dado, nao duplica.
//
// Uso: DB_PATH=/caminho/pro/sebas.db node scripts/backfill-changelog-storage.mjs
import { DatabaseSync } from "node:sqlite";

const dbPath = process.env.DB_PATH;
if (!dbPath) {
  throw new Error("DB_PATH is required — aponte pro sebas.db que quer migrar.");
}

const db = new DatabaseSync(dbPath);
const now = new Date().toISOString();

function tableExists(name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function setStorage(key, value) {
  db.prepare(
    `INSERT INTO module_storage (module_id, key, value, updated_at) VALUES ('changelog-roblox', ?, ?, ?)
     ON CONFLICT(module_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, JSON.stringify(value), now);
}

function setConfig(key, value) {
  db.prepare(
    `INSERT INTO module_config (module_id, key, value, updated_at) VALUES ('changelog-roblox', ?, ?, ?)
     ON CONFLICT(module_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, JSON.stringify(value), now);
}

let guildsBackfilled = 0;
let postedBackfilled = 0;
let settingsBackfilled = false;

// --- guild config + state (changelog_roblox_guild_settings/_state -> module_storage) ---
if (tableExists("changelog_roblox_guild_settings")) {
  const settingsRows = db.prepare("SELECT * FROM changelog_roblox_guild_settings").all();
  const stateByGuild = new Map(
    tableExists("changelog_roblox_guild_state")
      ? db.prepare("SELECT * FROM changelog_roblox_guild_state").all().map((row) => [row.guild_id, row])
      : []
  );

  for (const settings of settingsRows) {
    setStorage(`guild:${settings.guild_id}:config`, {
      channelId: settings.channel_id,
      mentionRoleId: settings.mention_role_id ?? null,
      mentionRoleEnabled: Boolean(settings.mention_role_enabled),
      updatedAt: settings.updated_at
    });

    const state = stateByGuild.get(settings.guild_id);
    if (state) {
      setStorage(`guild:${settings.guild_id}:state`, {
        initializedAt: state.initialized_at,
        processedGuids: JSON.parse(state.processed_guids || "[]")
      });
    }
    guildsBackfilled += 1;
  }
}

// --- historico postado (changelog_roblox_posted -> tabela fisica que ctx.sql cria, "mod_changelog_roblox_posted") ---
if (tableExists("changelog_roblox_posted")) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS "mod_changelog_roblox_posted" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      "guild_id" TEXT, "guid" TEXT, "title" TEXT, "version_number" TEXT,
      "channel_id" TEXT, "posted_at" TEXT, "status" TEXT
    )`
  );
  const postedRows = db.prepare("SELECT * FROM changelog_roblox_posted ORDER BY id ASC").all();
  const insertPosted = db.prepare(
    `INSERT INTO "mod_changelog_roblox_posted" (guild_id, guid, title, version_number, channel_id, posted_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  // dedupe por guid+guild_id, caso o script rode mais de uma vez
  const alreadyPosted = new Set(
    db.prepare(`SELECT guild_id, guid FROM "mod_changelog_roblox_posted"`).all().map((row) => `${row.guild_id}:${row.guid}`)
  );
  for (const row of postedRows) {
    const key = `${row.guild_id}:${row.guid}`;
    if (alreadyPosted.has(key)) continue;
    insertPosted.run(row.guild_id, row.guid, row.title, row.version_number, row.channel_id, row.posted_at, row.status);
    postedBackfilled += 1;
  }
}

// --- settings do modulo (changelog_roblox_settings -> module_config, chave "module-settings") ---
if (tableExists("changelog_roblox_settings")) {
  const row = db.prepare("SELECT * FROM changelog_roblox_settings WHERE id = 1").get();
  if (row) {
    setConfig("module-settings", { rssUrl: row.rss_url ?? null, maxItemsPerPoll: row.max_items_per_poll ?? null });
    settingsBackfilled = true;
  }
}

console.log(`Backfill concluido: ${guildsBackfilled} guild(s), ${postedBackfilled} changelog(s) postado(s), settings=${settingsBackfilled}.`);
