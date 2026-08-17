import type { DatabaseSync } from "node:sqlite";

export function getGithubToken(db: DatabaseSync): string | null {
  const row = db.prepare("SELECT token FROM github_settings WHERE id = 1").get() as { token: string | null } | undefined;
  return row?.token ?? null;
}

export function saveGithubToken(db: DatabaseSync, token: string): void {
  db.prepare("UPDATE github_settings SET token = ?, updated_at = ? WHERE id = 1").run(token, new Date().toISOString());
}
