import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCoreConfig } from "../config/env.js";
import { openDb } from "./client.js";

// process.cwd() e nao __dirname de proposito: __dirname muda de profundidade entre
// rodar via tsx (src/core/db/migrate.ts) e o build compilado (dist/src/core/db/migrate.js),
// mas o working directory do processo (systemd WorkingDirectory, ou a raiz do repo em dev)
// e sempre a raiz do projeto onde migrations/ vive.
const MIGRATIONS_DIR = join(process.cwd(), "migrations");

export function runMigrations(dbPath: string): void {
  const db = openDb(dbPath);
  const hasTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
    .get();
  if (!hasTable) {
    db.exec("CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);");
  }

  const applied = new Set(
    (db.prepare("SELECT id FROM schema_migrations").all() as Array<{ id: string }>).map((row) => row.id)
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    console.log(`Applying migration ${file}...`);
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(file, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, "/") || process.argv[1]?.endsWith("migrate.ts")) {
  const config = loadCoreConfig();
  runMigrations(config.dbPath);
  console.log("Migrations up to date.");
}
