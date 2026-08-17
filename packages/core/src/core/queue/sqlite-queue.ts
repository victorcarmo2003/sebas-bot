import type { DatabaseSync } from "node:sqlite";

const REAP_STALE_AFTER_MS = 10 * 60_000;

export interface EnqueueInput {
  moduleId: string;
  kind: string;
  dedupeKey?: string | null;
  payload: unknown;
  maxAttempts?: number;
  runAfter?: Date;
}

export interface Job {
  id: number;
  moduleId: string;
  kind: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
}

export function enqueue(db: DatabaseSync, input: EnqueueInput): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO jobs (module_id, kind, dedupe_key, payload, status, attempts, max_attempts, run_after, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)`
  ).run(
    input.moduleId,
    input.kind,
    input.dedupeKey ?? null,
    JSON.stringify(input.payload),
    input.maxAttempts ?? 3,
    (input.runAfter ?? new Date()).toISOString(),
    now,
    now
  );
}

/** Reclama o proximo job elegivel de forma atomica (single-writer, mas defensivo mesmo assim). */
export function claimNext(db: DatabaseSync): Job | null {
  reapStale(db);
  const now = new Date().toISOString();
  const row = db.prepare("SELECT id FROM jobs WHERE status = 'pending' AND run_after <= ? ORDER BY id ASC LIMIT 1").get(now) as
    | { id: number }
    | undefined;
  if (!row) return null;

  const result = db
    .prepare("UPDATE jobs SET status = 'processing', claimed_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
    .run(now, now, row.id);
  if (result.changes === 0) return null;

  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(row.id) as {
    id: number;
    module_id: string;
    kind: string;
    payload: string;
    attempts: number;
    max_attempts: number;
  };
  return {
    id: job.id,
    moduleId: job.module_id,
    kind: job.kind,
    payload: JSON.parse(job.payload),
    attempts: job.attempts,
    maxAttempts: job.max_attempts
  };
}

export function completeJob(db: DatabaseSync, id: number): void {
  db.prepare("DELETE FROM jobs WHERE id = ?").run(id);
}

export function failJob(db: DatabaseSync, id: number, errorMessage: string): void {
  const now = new Date().toISOString();
  const row = db.prepare("SELECT attempts, max_attempts FROM jobs WHERE id = ?").get(id) as
    | { attempts: number; max_attempts: number }
    | undefined;
  if (!row) return;

  const attempts = row.attempts + 1;
  if (attempts >= row.max_attempts) {
    db.prepare("UPDATE jobs SET status = 'failed', attempts = ?, last_error = ?, updated_at = ? WHERE id = ?").run(
      attempts,
      errorMessage.slice(0, 2000),
      now,
      id
    );
    return;
  }
  db.prepare("UPDATE jobs SET status = 'pending', attempts = ?, last_error = ?, claimed_at = NULL, updated_at = ? WHERE id = ?").run(
    attempts,
    errorMessage.slice(0, 2000),
    now,
    id
  );
}

function reapStale(db: DatabaseSync): void {
  const staleThreshold = new Date(Date.now() - REAP_STALE_AFTER_MS).toISOString();
  db.prepare("UPDATE jobs SET status = 'pending', claimed_at = NULL WHERE status = 'processing' AND claimed_at < ?").run(staleThreshold);
}
