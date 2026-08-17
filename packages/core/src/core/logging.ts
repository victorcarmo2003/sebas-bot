import type { DatabaseSync } from "node:sqlite";

export interface LogEntry {
  level: "info" | "warn" | "error";
  context: string;
  guildId?: string | null;
  moduleId?: string | null;
  message: string;
  meta?: unknown;
}

export function logRun(db: DatabaseSync, entry: LogEntry): void {
  try {
    db.prepare(
      "INSERT INTO run_logs (created_at, level, context, guild_id, module_id, message, meta) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      new Date().toISOString(),
      entry.level,
      entry.context,
      entry.guildId ?? null,
      entry.moduleId ?? null,
      entry.message,
      entry.meta ? JSON.stringify(entry.meta) : null
    );
  } catch (error) {
    console.warn("Failed to persist run log.", error);
  }
}
