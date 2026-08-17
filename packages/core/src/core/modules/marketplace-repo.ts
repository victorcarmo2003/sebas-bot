import type { DatabaseSync } from "node:sqlite";
import { grantsRequestedByManifest, loadActiveGrantItems, recordGrants } from "./grants.js";
import type { PermissionDiffItem, SebasModuleManifest } from "./types.js";

/** Sentinela em `pinned_sha` pra módulos in-tree (embutidos no monorepo) — não vieram de um
 * clone de repo de verdade, então não têm SHA. Usado pra distinguir de módulos instalados via
 * marketplace onde precisar (ex.: `lifecycle.ts` decide onde procurar os entrypoints). */
export const IN_TREE_PINNED_SHA = "in-tree";

export type ModuleInstallState = "pending" | "approved" | "enabled" | "disabled" | "rejected";

export interface ModuleGrant extends PermissionDiffItem {
  id: number;
  grantedBy: string;
  grantedAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
}

export interface ModuleEvent {
  id: number;
  eventType: string;
  actorDiscordId: string | null;
  detail: string | null;
  createdAt: string;
}

export interface ModuleDetail {
  id: string;
  repoUrl: string;
  pinnedSha: string;
  installedVersion: string;
  state: ModuleInstallState;
  manifest: SebasModuleManifest;
  firstEnabledAt: string | null;
  firstEnabledBy: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  grants: ModuleGrant[];
  events: ModuleEvent[];
  pendingPermissionDiff: PermissionDiffItem[];
}

export interface ModuleInstallRow {
  id: string;
  repo_url: string;
  pinned_sha: string;
  installed_version: string;
  state: ModuleInstallState;
  manifest: string;
  first_enabled_at: string | null;
  first_enabled_by: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export function getModuleInstall(db: DatabaseSync, id: string): ModuleInstallRow | null {
  return (db.prepare("SELECT * FROM module_installs WHERE id = ?").get(id) as ModuleInstallRow | undefined) ?? null;
}

export function listModuleInstalls(db: DatabaseSync): ModuleInstallRow[] {
  return db.prepare("SELECT * FROM module_installs ORDER BY created_at DESC").all() as unknown as ModuleInstallRow[];
}

export interface CreateModuleInstallInput {
  id: string;
  repoUrl: string;
  pinnedSha: string;
  manifest: SebasModuleManifest;
}

export function createModuleInstall(db: DatabaseSync, input: CreateModuleInstallInput): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO module_installs (id, repo_url, pinned_sha, installed_version, state, manifest, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET repo_url = excluded.repo_url, pinned_sha = excluded.pinned_sha,
       installed_version = excluded.installed_version, manifest = excluded.manifest, state = 'pending', updated_at = excluded.updated_at`
  ).run(input.id, input.repoUrl, input.pinnedSha, input.manifest.version, JSON.stringify(input.manifest), now, now);
}

export function setModuleInstallState(db: DatabaseSync, id: string, state: ModuleInstallState, lastError?: string | null): void {
  db.prepare("UPDATE module_installs SET state = ?, last_error = ?, updated_at = ? WHERE id = ?").run(
    state,
    lastError ?? null,
    new Date().toISOString(),
    id
  );
}

export function markFirstEnabled(db: DatabaseSync, id: string, by: string): void {
  db.prepare("UPDATE module_installs SET first_enabled_at = COALESCE(first_enabled_at, ?), first_enabled_by = COALESCE(first_enabled_by, ?) WHERE id = ?").run(
    new Date().toISOString(),
    by,
    id
  );
}

/**
 * Módulos in-tree (embutidos no monorepo, ver `grantedPermissionsForInTreeModule` em grants.ts)
 * nunca passam pelo fluxo de install do marketplace — mas o painel/admin API tratam TODO módulo
 * uniformemente via `module_installs` (GET /modules/:id, enable/disable, grants). Sem essa
 * linha, `GET /modules/changelog-roblox` sempre dava 404 e a tela do painel quebrava.
 * Idempotente: só cria na primeira vez (boot seguinte encontra a linha e não mexe no estado —
 * assim um "desabilitar" feito pelo dono sobrevive a um restart do processo).
 */
export function ensureInTreeModuleRegistered(db: DatabaseSync, manifest: SebasModuleManifest): ModuleInstallRow {
  const existing = getModuleInstall(db, manifest.id);
  if (existing) return existing;

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO module_installs (id, repo_url, pinned_sha, installed_version, state, manifest, first_enabled_at, first_enabled_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'enabled', ?, ?, 'system', ?, ?)`
  ).run(manifest.id, manifest.repoUrl, IN_TREE_PINNED_SHA, manifest.version, JSON.stringify(manifest), now, now, now);
  recordGrants(db, manifest.id, grantsRequestedByManifest(manifest), "system");
  recordModuleEvent(db, manifest.id, "install", "system", { source: "in-tree" });

  // getModuleInstall() nunca retorna null aqui — acabou de inserir a linha acima.
  return getModuleInstall(db, manifest.id) as ModuleInstallRow;
}

export function deleteModuleInstall(db: DatabaseSync, id: string): void {
  db.prepare("DELETE FROM module_events WHERE module_id = ?").run(id);
  db.prepare("DELETE FROM module_grants WHERE module_id = ?").run(id);
  db.prepare("DELETE FROM module_installs WHERE id = ?").run(id);
}

export function recordModuleEvent(db: DatabaseSync, moduleId: string, eventType: string, actorDiscordId: string | null, detail?: unknown): void {
  db.prepare("INSERT INTO module_events (module_id, event_type, actor_discord_id, detail, created_at) VALUES (?, ?, ?, ?, ?)").run(
    moduleId,
    eventType,
    actorDiscordId,
    detail !== undefined ? JSON.stringify(detail) : null,
    new Date().toISOString()
  );
}

export function toModuleDetail(db: DatabaseSync, row: ModuleInstallRow): ModuleDetail {
  const grantRows = db.prepare("SELECT * FROM module_grants WHERE module_id = ? ORDER BY granted_at ASC").all(row.id) as Array<{
    id: number;
    grant_type: PermissionDiffItem["grantType"];
    grant_value: string;
    granted_by: string;
    granted_at: string;
    revoked_at: string | null;
    revoked_by: string | null;
  }>;
  const eventRows = db.prepare("SELECT * FROM module_events WHERE module_id = ? ORDER BY created_at DESC").all(row.id) as Array<{
    id: number;
    event_type: string;
    actor_discord_id: string | null;
    detail: string | null;
    created_at: string;
  }>;

  const manifest = JSON.parse(row.manifest) as SebasModuleManifest;

  return {
    id: row.id,
    repoUrl: row.repo_url,
    pinnedSha: row.pinned_sha,
    installedVersion: row.installed_version,
    state: row.state,
    manifest,
    firstEnabledAt: row.first_enabled_at,
    firstEnabledBy: row.first_enabled_by,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    grants: grantRows.map((grant) => ({
      id: grant.id,
      grantType: grant.grant_type,
      grantValue: grant.grant_value,
      grantedBy: grant.granted_by,
      grantedAt: grant.granted_at,
      revokedAt: grant.revoked_at,
      revokedBy: grant.revoked_by
    })),
    events: eventRows.map((event) => ({
      id: event.id,
      eventType: event.event_type,
      actorDiscordId: event.actor_discord_id,
      detail: event.detail ? JSON.parse(event.detail) : null,
      createdAt: event.created_at
    })),
    pendingPermissionDiff: []
  };
}
