import type { DatabaseSync } from "node:sqlite";
import { ALL_SCOPES, parsePermissions, type PermissionScope } from "./rbac.js";

export interface AdminRow {
  discordUserId: string;
  displayName: string | null;
  role: "owner" | "subadmin";
  permissions: PermissionScope[];
  createdAt: string;
  createdBy: string | null;
}

interface RawAdminRow {
  discord_user_id: string;
  display_name: string | null;
  role: "owner" | "subadmin";
  permissions: string;
  created_at: string;
  created_by: string | null;
}

export function listAdmins(db: DatabaseSync): AdminRow[] {
  const rows = db
    .prepare("SELECT discord_user_id, display_name, role, permissions, created_at, created_by FROM admins ORDER BY created_at ASC")
    .all() as unknown as RawAdminRow[];
  return rows.map(toAdminRow);
}

export interface UpsertSubadminInput {
  discordUserId: string;
  displayName?: string | null;
  permissions: PermissionScope[];
  createdBy: string;
}

export function upsertSubadmin(db: DatabaseSync, input: UpsertSubadminInput): void {
  db.prepare(
    `INSERT INTO admins (discord_user_id, display_name, role, permissions, created_at, created_by)
     VALUES (?, ?, 'subadmin', ?, ?, ?)
     ON CONFLICT(discord_user_id) DO UPDATE SET display_name = excluded.display_name, permissions = excluded.permissions`
  ).run(
    input.discordUserId,
    input.displayName ?? null,
    JSON.stringify(input.permissions.filter((scope) => (ALL_SCOPES as readonly string[]).includes(scope))),
    new Date().toISOString(),
    input.createdBy
  );
}

export function deleteSubadmin(db: DatabaseSync, discordUserId: string): void {
  db.prepare("DELETE FROM admins WHERE discord_user_id = ? AND role = 'subadmin'").run(discordUserId);
}

function toAdminRow(row: RawAdminRow): AdminRow {
  return {
    discordUserId: row.discord_user_id,
    displayName: row.display_name,
    role: row.role === "owner" ? "owner" : "subadmin",
    permissions: row.role === "owner" ? [...ALL_SCOPES] : parsePermissions(row.permissions),
    createdAt: row.created_at,
    createdBy: row.created_by
  };
}

export interface RunLogRow {
  id: number;
  createdAt: string;
  level: string;
  context: string;
  guildId: string | null;
  moduleId: string | null;
  message: string;
  meta: unknown;
}

export interface RunLogFilter {
  level?: string;
  context?: string;
  cursor?: number;
  limit?: number;
}

export interface RunLogPage {
  items: RunLogRow[];
  nextCursor: number | null;
}

export function listRunLogs(db: DatabaseSync, filter: RunLogFilter): RunLogPage {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (filter.level) {
    conditions.push("level = ?");
    params.push(filter.level);
  }
  if (filter.context) {
    conditions.push("context = ?");
    params.push(filter.context);
  }
  if (filter.cursor !== undefined) {
    conditions.push("id < ?");
    params.push(filter.cursor);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT id, created_at, level, context, guild_id, module_id, message, meta FROM run_logs ${where} ORDER BY id DESC LIMIT ?`)
    .all(...params, limit + 1) as unknown as Array<{
    id: number;
    created_at: string;
    level: string;
    context: string;
    guild_id: string | null;
    module_id: string | null;
    message: string;
    meta: string | null;
  }>;
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      level: row.level,
      context: row.context,
      guildId: row.guild_id,
      moduleId: row.module_id,
      message: row.message,
      meta: row.meta ? safeParseJson(row.meta) : null
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null
  };
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export interface ModuleRow {
  id: string;
  displayName: string;
  enabled: boolean;
}

export function listModuleRows(db: DatabaseSync): ModuleRow[] {
  const rows = db.prepare("SELECT id, display_name, enabled FROM modules ORDER BY id ASC").all() as Array<{
    id: string;
    display_name: string;
    enabled: number;
  }>;
  return rows.map((row) => ({ id: row.id, displayName: row.display_name, enabled: row.enabled === 1 }));
}
