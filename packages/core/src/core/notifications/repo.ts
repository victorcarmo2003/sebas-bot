import type { DatabaseSync } from "node:sqlite";

export interface PendingAction {
  id: number;
  kind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  actionKind: string | null;
  dedupeKey: string;
  targetDiscordUserId: string | null;
  notifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

interface PendingActionRow {
  id: number;
  kind: string;
  severity: PendingAction["severity"];
  title: string;
  message: string;
  action_kind: string | null;
  dedupe_key: string;
  target_discord_user_id: string | null;
  notified_at: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

function toAction(row: PendingActionRow): PendingAction {
  return {
    id: row.id,
    kind: row.kind,
    severity: row.severity,
    title: row.title,
    message: row.message,
    actionKind: row.action_kind,
    dedupeKey: row.dedupe_key,
    targetDiscordUserId: row.target_discord_user_id,
    notifiedAt: row.notified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by
  };
}

export function listPendingActions(db: DatabaseSync, options: { includeResolved?: boolean } = {}): PendingAction[] {
  const where = options.includeResolved ? "" : "WHERE resolved_at IS NULL";
  const rows = db.prepare(`SELECT * FROM pending_actions ${where} ORDER BY created_at DESC`).all() as unknown as PendingActionRow[];
  return rows.map(toAction);
}

export interface UpsertPendingActionInput {
  kind: string;
  severity: PendingAction["severity"];
  title: string;
  message: string;
  actionKind?: string | null;
  dedupeKey: string;
  targetDiscordUserId?: string | null;
}

/** Cria a pendencia se nao existir, reabre se estava resolvida, ou so atualiza texto se ja ativa. */
export function upsertPendingAction(
  db: DatabaseSync,
  input: UpsertPendingActionInput
): { action: PendingAction; isNewOrReopened: boolean } {
  const existing = db.prepare("SELECT * FROM pending_actions WHERE dedupe_key = ?").get(input.dedupeKey) as
    | PendingActionRow
    | undefined;
  const now = new Date().toISOString();

  if (!existing) {
    db.prepare(
      `INSERT INTO pending_actions
        (kind, severity, title, message, action_kind, dedupe_key, target_discord_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.kind,
      input.severity,
      input.title,
      input.message,
      input.actionKind ?? null,
      input.dedupeKey,
      input.targetDiscordUserId ?? null,
      now,
      now
    );
    const created = db.prepare("SELECT * FROM pending_actions WHERE dedupe_key = ?").get(input.dedupeKey) as unknown as PendingActionRow;
    return { action: toAction(created), isNewOrReopened: true };
  }

  const wasResolved = existing.resolved_at !== null;
  db.prepare(
    `UPDATE pending_actions SET title = ?, message = ?, severity = ?, updated_at = ?, resolved_at = NULL, resolved_by = NULL
     WHERE dedupe_key = ?`
  ).run(input.title, input.message, input.severity, now, input.dedupeKey);
  const updated = db.prepare("SELECT * FROM pending_actions WHERE dedupe_key = ?").get(input.dedupeKey) as unknown as PendingActionRow;
  return { action: toAction(updated), isNewOrReopened: wasResolved };
}

export function resolvePendingActionByDedupeKey(db: DatabaseSync, dedupeKey: string, resolvedBy: string): void {
  db.prepare("UPDATE pending_actions SET resolved_at = ?, resolved_by = ? WHERE dedupe_key = ? AND resolved_at IS NULL").run(
    new Date().toISOString(),
    resolvedBy,
    dedupeKey
  );
}

export function resolvePendingActionById(db: DatabaseSync, id: number, resolvedBy: string): void {
  db.prepare("UPDATE pending_actions SET resolved_at = ?, resolved_by = ? WHERE id = ? AND resolved_at IS NULL").run(
    new Date().toISOString(),
    resolvedBy,
    id
  );
}

export function markNotified(db: DatabaseSync, id: number): void {
  db.prepare("UPDATE pending_actions SET notified_at = ? WHERE id = ?").run(new Date().toISOString(), id);
}
