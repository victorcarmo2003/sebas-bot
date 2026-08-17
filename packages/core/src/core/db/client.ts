import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

let instance: DatabaseSync | undefined;

export function openDb(dbPath: string): DatabaseSync {
  if (instance) {
    return instance;
  }
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  instance = db;
  return db;
}

export function getDb(): DatabaseSync {
  if (!instance) {
    throw new Error("Database not opened yet. Call openDb() first.");
  }
  return instance;
}
