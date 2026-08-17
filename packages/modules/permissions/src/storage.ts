import type { SebasModuleContext } from "./sebas-types.js";

/** Terceiro eixo interno ("action") controla quem pode pedir execucao de tool, separado de
 * DM/mencao (que controlam so "posso falar"). Nao aparece em PermissionGateRequest.surface —
 * e' calculado por fora, na hora de montar `allowedTools` (ver permission-gate.ts). */
export type GateSurface = "dm" | "mention" | "action";
export type GateMode = "everyone" | "whitelist" | "blacklist";

export const GATE_SURFACES: GateSurface[] = ["dm", "mention", "action"];

export interface GateConfig {
  surface: GateSurface;
  mode: GateMode;
  userIds: string[];
  roleIds: string[];
  updatedAt: string;
}

const CONFIG_TABLE = "gate_config";
const MEMBERS_TABLE = "gate_members";
const ALLOWLIST_TABLE = "tool_allowlist";

export function isGateSurface(value: string): value is GateSurface {
  return (GATE_SURFACES as string[]).includes(value);
}

async function ensureTables(ctx: SebasModuleContext): Promise<void> {
  await ctx.sql.createTable(CONFIG_TABLE, { surface: "text", mode: "text", updated_at: "text" });
  await ctx.sql.createTable(MEMBERS_TABLE, { surface: "text", member_type: "text", value: "text", created_at: "text" });
  await ctx.sql.createTable(ALLOWLIST_TABLE, { qualified_tool_name: "text", created_at: "text" });
}

/** Default quando ainda nao ha linha de config pra essa surface: "whitelist" vazio, ou seja,
 * NEGA por padrao pra quem nao e' o dono. E' proposital — o motivo de existir esse modulo e'
 * restringir acesso; um default "everyone" abriria o bot geral entre o install e a primeira
 * configuracao do dono no painel, o oposto do que foi pedido. */
const DEFAULT_MODE: GateMode = "whitelist";

export async function loadGateConfig(ctx: SebasModuleContext, surface: GateSurface): Promise<GateConfig> {
  await ensureTables(ctx);
  const configRows = await ctx.sql.select(CONFIG_TABLE, { where: { surface }, limit: 1 });
  const mode = (configRows[0]?.mode as GateMode | undefined) ?? DEFAULT_MODE;

  const userRows = await ctx.sql.select(MEMBERS_TABLE, { where: { surface, member_type: "user" }, limit: 500 });
  const roleRows = await ctx.sql.select(MEMBERS_TABLE, { where: { surface, member_type: "role" }, limit: 500 });

  return {
    surface,
    mode,
    userIds: userRows.map((row) => String(row.value)),
    roleIds: roleRows.map((row) => String(row.value)),
    updatedAt: (configRows[0]?.updated_at as string | undefined) ?? new Date(0).toISOString()
  };
}

export async function saveGateConfig(
  ctx: SebasModuleContext,
  surface: GateSurface,
  input: { mode: GateMode; userIds: string[]; roleIds: string[] }
): Promise<GateConfig> {
  await ensureTables(ctx);
  const now = new Date().toISOString();

  const existing = await ctx.sql.select(CONFIG_TABLE, { where: { surface }, limit: 1 });
  if (existing.length > 0) {
    await ctx.sql.update(CONFIG_TABLE, { surface }, { mode: input.mode, updated_at: now });
  } else {
    await ctx.sql.insert(CONFIG_TABLE, { surface, mode: input.mode, updated_at: now });
  }

  await replaceMembers(ctx, surface, "user", input.userIds);
  await replaceMembers(ctx, surface, "role", input.roleIds);

  return { surface, mode: input.mode, userIds: input.userIds, roleIds: input.roleIds, updatedAt: now };
}

async function replaceMembers(ctx: SebasModuleContext, surface: GateSurface, memberType: "user" | "role", values: string[]): Promise<void> {
  const existing = await ctx.sql.select(MEMBERS_TABLE, { where: { surface, member_type: memberType }, limit: 500 });
  for (const row of existing) {
    await ctx.sql.delete(MEMBERS_TABLE, { id: row.id });
  }
  const now = new Date().toISOString();
  for (const value of values) {
    await ctx.sql.insert(MEMBERS_TABLE, { surface, member_type: memberType, value, created_at: now });
  }
}

export async function loadToolAllowlist(ctx: SebasModuleContext): Promise<string[]> {
  await ensureTables(ctx);
  const rows = await ctx.sql.select(ALLOWLIST_TABLE, { limit: 500 });
  return rows.map((row) => String(row.qualified_tool_name));
}

export async function saveToolAllowlist(ctx: SebasModuleContext, tools: string[]): Promise<string[]> {
  await ensureTables(ctx);
  const existing = await ctx.sql.select(ALLOWLIST_TABLE, { limit: 500 });
  for (const row of existing) {
    await ctx.sql.delete(ALLOWLIST_TABLE, { id: row.id });
  }
  const now = new Date().toISOString();
  for (const tool of tools) {
    await ctx.sql.insert(ALLOWLIST_TABLE, { qualified_tool_name: tool, created_at: now });
  }
  return tools;
}
