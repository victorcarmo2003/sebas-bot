import type { DatabaseSync } from "node:sqlite";

export const ALL_SCOPES = [
  "guilds:view",
  "guilds:edit",
  "history:view",
  "logs:view",
  "sources:manage",
  "admins:manage",
  "modules:manage"
] as const;

export type PermissionScope = (typeof ALL_SCOPES)[number];

export interface Admin {
  discordUserId: string;
  role: "owner" | "subadmin";
  permissions: PermissionScope[];
}

interface AdminRow {
  discord_user_id: string;
  role: "owner" | "subadmin";
  permissions: string;
}

export function resolveAdmin(db: DatabaseSync, ownerDiscordId: string, discordUserId: string): Admin | null {
  if (discordUserId === ownerDiscordId) {
    return { discordUserId, role: "owner", permissions: [...ALL_SCOPES] };
  }

  const row = db.prepare("SELECT discord_user_id, role, permissions FROM admins WHERE discord_user_id = ?").get(discordUserId) as
    | AdminRow
    | undefined;
  if (!row) {
    return null;
  }
  if (row.role === "owner") {
    return { discordUserId: row.discord_user_id, role: "owner", permissions: [...ALL_SCOPES] };
  }
  return {
    discordUserId: row.discord_user_id,
    role: "subadmin",
    permissions: parsePermissions(row.permissions)
  };
}

export function hasScope(admin: Admin, scope: PermissionScope): boolean {
  return admin.role === "owner" || admin.permissions.includes(scope);
}

export function parsePermissions(raw: string): PermissionScope[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((value): value is PermissionScope => (ALL_SCOPES as readonly string[]).includes(value));
  } catch {
    return [];
  }
}
