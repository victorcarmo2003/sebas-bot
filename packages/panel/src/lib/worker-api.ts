import "server-only";

export type PermissionScope =
  | "guilds:view"
  | "guilds:edit"
  | "history:view"
  | "logs:view"
  | "sources:manage"
  | "admins:manage"
  | "modules:manage";

export interface WhoAmI {
  discordUserId: string;
  role: "owner" | "subadmin";
  permissions: PermissionScope[];
}

export interface GuildConfig {
  channelId: string;
  mentionRoleId: string | null;
  mentionRoleEnabled: boolean;
  updatedAt: string;
}

export interface ModuleSettings {
  rssUrl: string | null;
  maxItemsPerPoll: number | null;
}

export interface GuildEntry {
  guildId: string;
  config: GuildConfig;
}

export interface HistoryRow {
  id: number;
  guildId: string;
  guid: string;
  title: string;
  versionNumber: string | null;
  channelId: string;
  postedAt: string;
  status: string;
}

export interface HistoryPage {
  items: HistoryRow[];
  nextCursor: number | null;
}

export interface LogRow {
  id: number;
  createdAt: string;
  level: string;
  context: string;
  guildId: string | null;
  moduleId: string | null;
  message: string;
  meta: unknown;
}

export interface LogPage {
  items: LogRow[];
  nextCursor: number | null;
}

export interface AdminRow {
  discordUserId: string;
  displayName: string | null;
  role: "owner" | "subadmin";
  permissions: PermissionScope[];
  createdAt: string;
  createdBy: string | null;
}

export interface ModuleRow {
  id: string;
  displayName: string;
  enabled: boolean;
  state: string;
  source: string;
}

export type ModuleCapability = "controller" | "cron" | "ui" | "discordCommands" | "aiProvider" | "storage" | "webhook";

export interface SebasModuleManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  version: string;
  sebasCompat: string;
  repoUrl: string;
  capabilities: ModuleCapability[];
  entryPoints: Record<string, string | undefined>;
  cron?: { schedule: string; timeoutMs?: number };
  discordCommands?: { commands: string[] };
  webhook?: { publicPath: string };
  permissions?: {
    adminScopes?: string[];
    providesScopes?: string[];
    network?: { domains: string[] };
    storage?: { kind?: "kv" | "sql"; maxMb: number };
    discordPermissions?: string[];
  };
  dependencies?: { aiProvider?: string };
  resources: { maxMemoryMb: number };
}

export interface PermissionDiffItem {
  grantType: "adminScope" | "providesScope" | "networkDomain" | "storage" | "discordPermission" | "aiProviderDependency";
  grantValue: string;
}

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
  state: string;
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

export interface InstallModuleResult {
  ok: boolean;
  moduleId?: string;
  manifest?: SebasModuleManifest;
  permissionDiff?: PermissionDiffItem[];
  errors: string[];
}

export interface PendingAction {
  id: number;
  kind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  actionKind: string | null;
  dedupeKey: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AiProviderStatus {
  providerId: string;
  hasApiKey: boolean;
  selectedModel: string | null;
  status: "unconfigured" | "ok" | "error";
  lastCheckedAt: string | null;
  lastError: string | null;
  /** Extensao aditiva ao contrato original: vem da mesma linha de ai_provider_settings
   * que a migration 0007 (auto_switch_enabled) passa a expor via /ai/status. */
  autoSwitchEnabled: boolean;
}

export interface OpenCodeModel {
  id: string;
  free: boolean;
}

export interface ModelPriorityItem {
  modelId: string;
  position: number;
  rateLimitedUntil: string | null;
}

export interface BotParameterRow {
  key: string;
  value: string | null;
  updatedAt: string | null;
}

export type PermissionSurface = "dm" | "mention" | "action";
export type PermissionMode = "everyone" | "whitelist" | "blacklist";

export interface PermissionSurfaceConfig {
  mode: PermissionMode;
  userIds: string[];
  roleIds: string[];
}

export interface PermissionsModuleSettings {
  dm: PermissionSurfaceConfig;
  mention: PermissionSurfaceConfig;
  action: PermissionSurfaceConfig;
  enabledTools: string[];
}

export class WorkerApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

function baseUrl(): string {
  const url = process.env.SEBAS_CORE_API_URL;
  if (!url) {
    throw new Error("SEBAS_CORE_API_URL is not configured.");
  }
  return url.replace(/\/$/, "");
}

async function callWorkerApi<T>(
  discordUserId: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const secret = process.env.SEBAS_CORE_API_SECRET;
  if (!secret) {
    throw new Error("SEBAS_CORE_API_SECRET is not configured.");
  }

  const response = await fetch(`${baseUrl()}/api/admin${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...init.headers,
      authorization: `Bearer ${secret}`,
      "x-admin-discord-id": discordUserId,
      ...(init.body ? { "content-type": "application/json" } : {})
    }
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const message = (data && typeof data === "object" && "error" in data && String(data.error)) || response.statusText;
    throw new WorkerApiError(response.status, message);
  }

  return data as T;
}

export function getWhoAmI(discordUserId: string): Promise<WhoAmI> {
  return callWorkerApi<WhoAmI>(discordUserId, "/whoami");
}

export function listGuilds(discordUserId: string): Promise<{ items: GuildEntry[] }> {
  return callWorkerApi(discordUserId, "/guilds");
}

export function getGuild(discordUserId: string, guildId: string): Promise<GuildConfig> {
  return callWorkerApi(discordUserId, `/guilds/${guildId}`);
}

export function saveGuild(
  discordUserId: string,
  guildId: string,
  input: { channelId: string; mentionRoleId?: string | null; mentionRoleEnabled?: boolean }
): Promise<GuildConfig> {
  return callWorkerApi(discordUserId, `/guilds/${guildId}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function listHistory(
  discordUserId: string,
  filter: { guildId?: string; cursor?: number } = {}
): Promise<HistoryPage> {
  const params = new URLSearchParams();
  if (filter.guildId) params.set("guildId", filter.guildId);
  if (filter.cursor !== undefined) params.set("cursor", String(filter.cursor));
  const query = params.toString();
  return callWorkerApi(discordUserId, `/history${query ? `?${query}` : ""}`);
}

export function repostHistoryItem(discordUserId: string, id: number): Promise<{ status: string }> {
  return callWorkerApi(discordUserId, `/history/${id}/repost`, { method: "POST" });
}

export function listLogs(
  discordUserId: string,
  filter: { level?: string; context?: string; cursor?: number } = {}
): Promise<LogPage> {
  const params = new URLSearchParams();
  if (filter.level) params.set("level", filter.level);
  if (filter.context) params.set("context", filter.context);
  if (filter.cursor !== undefined) params.set("cursor", String(filter.cursor));
  const query = params.toString();
  return callWorkerApi(discordUserId, `/logs${query ? `?${query}` : ""}`);
}

export function listModules(discordUserId: string): Promise<{ items: ModuleRow[] }> {
  return callWorkerApi(discordUserId, "/modules");
}

export function getModuleDetail(discordUserId: string, moduleId: string): Promise<ModuleDetail> {
  return callWorkerApi(discordUserId, `/modules/${moduleId}`);
}

export interface DiscoveredModule {
  repoFullName: string;
  repoUrl: string;
  htmlUrl: string;
  manifestPath: string;
  alreadyInstalled: boolean;
}

export interface DiscoverModulesResult {
  ok: boolean;
  items: DiscoveredModule[];
  error?: string;
}

export function discoverModules(discordUserId: string, query: string): Promise<DiscoverModulesResult> {
  const params = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
  return callWorkerApi(discordUserId, `/modules/discover${params}`);
}

/** Corpo da resposta (ok:true/false + errors[]) e' o resultado em si, mesmo quando a
 * validacao falha — por isso nao usa callWorkerApi (que joga WorkerApiError em !response.ok
 * e perderia a lista de erros, sobrando so o statusText generico). */
export async function installModule(discordUserId: string, repoUrl: string): Promise<InstallModuleResult> {
  const secret = process.env.SEBAS_CORE_API_SECRET;
  if (!secret) throw new Error("SEBAS_CORE_API_SECRET is not configured.");

  const response = await fetch(`${baseUrl()}/api/admin/modules/install`, {
    method: "POST",
    cache: "no-store",
    headers: {
      authorization: `Bearer ${secret}`,
      "x-admin-discord-id": discordUserId,
      "content-type": "application/json"
    },
    body: JSON.stringify({ repoUrl })
  });
  const text = await response.text();
  return text ? (JSON.parse(text) as InstallModuleResult) : { ok: false, errors: ["resposta vazia do servidor"] };
}

export function approveModule(discordUserId: string, moduleId: string): Promise<{ ok: boolean }> {
  return callWorkerApi(discordUserId, `/modules/${moduleId}/approve`, { method: "POST" });
}

export function rejectModule(discordUserId: string, moduleId: string): Promise<{ ok: boolean }> {
  return callWorkerApi(discordUserId, `/modules/${moduleId}/reject`, { method: "POST" });
}

export function enableModule(discordUserId: string, moduleId: string): Promise<{ ok: boolean }> {
  return callWorkerApi(discordUserId, `/modules/${moduleId}/enable`, { method: "POST" });
}

export function disableModule(discordUserId: string, moduleId: string): Promise<{ ok: boolean }> {
  return callWorkerApi(discordUserId, `/modules/${moduleId}/disable`, { method: "POST" });
}

export function uninstallModule(discordUserId: string, moduleId: string): Promise<{ deleted: boolean }> {
  return callWorkerApi(discordUserId, `/modules/${moduleId}`, { method: "DELETE" });
}

/** changelog-roblox continua no fallback legado sem prefixo de moduleId (registerInTreeControllerFallback
 * no core, catch-all "/*" -> legacyControllerModuleId) — path bate exatamente com o que o modulo
 * ja reconhecia antes da generalizacao multi-modulo, sem precisar mudar o modulo em si. */
export function getChangelogModuleSettings(discordUserId: string): Promise<ModuleSettings> {
  return callWorkerApi(discordUserId, "/settings");
}

export function saveChangelogModuleSettings(discordUserId: string, input: ModuleSettings): Promise<ModuleSettings> {
  return callWorkerApi(discordUserId, "/settings", {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

/** O modulo permissions expoe rotas granulares (ver packages/modules/permissions/src/controller.ts)
 * sob /modules/permissions/controller/* — nao existe um "/settings" combinado do lado do core.
 * Essas duas funcoes agregam/desagregam pra manter o shape unico que o painel consome. */
export function getPermissionsModuleSettings(discordUserId: string): Promise<PermissionsModuleSettings> {
  return Promise.all([
    callWorkerApi<{ items: Array<{ surface: PermissionSurface } & PermissionSurfaceConfig> }>(
      discordUserId,
      "/modules/permissions/controller/gates"
    ),
    callWorkerApi<{ items: string[] }>(discordUserId, "/modules/permissions/controller/tools/allowlist")
  ]).then(([gates, allowlist]) => {
    const bySurface = new Map(gates.items.map((item) => [item.surface, item]));
    const fallback: PermissionSurfaceConfig = { mode: "whitelist", userIds: [], roleIds: [] };
    const pick = (surface: PermissionSurface): PermissionSurfaceConfig => {
      const found = bySurface.get(surface);
      return found ? { mode: found.mode, userIds: found.userIds, roleIds: found.roleIds } : fallback;
    };
    return { dm: pick("dm"), mention: pick("mention"), action: pick("action"), enabledTools: allowlist.items };
  });
}

export async function savePermissionsModuleSettings(
  discordUserId: string,
  input: PermissionsModuleSettings
): Promise<PermissionsModuleSettings> {
  const putGate = (surface: PermissionSurface, config: PermissionSurfaceConfig) =>
    callWorkerApi(discordUserId, `/modules/permissions/controller/gates/${surface}`, {
      method: "PUT",
      body: JSON.stringify(config)
    });
  await Promise.all([
    putGate("dm", input.dm),
    putGate("mention", input.mention),
    putGate("action", input.action),
    callWorkerApi(discordUserId, "/modules/permissions/controller/tools/allowlist", {
      method: "PUT",
      body: JSON.stringify({ items: input.enabledTools })
    })
  ]);
  return input;
}

export function listAdmins(discordUserId: string): Promise<{ items: AdminRow[] }> {
  return callWorkerApi(discordUserId, "/admins");
}

export function createSubadmin(
  discordUserId: string,
  input: { discordUserId: string; displayName?: string; permissions: PermissionScope[] }
): Promise<AdminRow> {
  return callWorkerApi(discordUserId, "/admins", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateSubadmin(
  discordUserId: string,
  targetId: string,
  input: { displayName?: string; permissions: PermissionScope[] }
): Promise<AdminRow> {
  return callWorkerApi(discordUserId, `/admins/${targetId}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function deleteSubadmin(discordUserId: string, targetId: string): Promise<{ deleted: boolean }> {
  return callWorkerApi(discordUserId, `/admins/${targetId}`, { method: "DELETE" });
}

export function listNotifications(discordUserId: string): Promise<{ items: PendingAction[] }> {
  return callWorkerApi(discordUserId, "/notifications");
}

export function resolveNotification(discordUserId: string, id: number): Promise<{ resolved: boolean }> {
  return callWorkerApi(discordUserId, `/notifications/${id}/resolve`, { method: "POST" });
}

export function getAiStatus(discordUserId: string): Promise<{ opencode: AiProviderStatus }> {
  return callWorkerApi(discordUserId, "/ai/status");
}

export function saveOpenCodeKey(discordUserId: string, apiKey: string): Promise<{ ok: boolean }> {
  return callWorkerApi(discordUserId, "/ai/opencode/key", {
    method: "POST",
    body: JSON.stringify({ apiKey })
  });
}

export function listOpenCodeModels(discordUserId: string): Promise<{ items: OpenCodeModel[] }> {
  return callWorkerApi(discordUserId, "/ai/opencode/models");
}

export function selectOpenCodeModel(discordUserId: string, model: string): Promise<{ ok: boolean; model: string }> {
  return callWorkerApi(discordUserId, "/ai/opencode/select", {
    method: "POST",
    body: JSON.stringify({ model })
  });
}

export function getGithubStatus(discordUserId: string): Promise<{ hasToken: boolean }> {
  return callWorkerApi(discordUserId, "/github/status");
}

export function saveGithubToken(discordUserId: string, token: string): Promise<{ ok: boolean }> {
  return callWorkerApi(discordUserId, "/github/token", {
    method: "POST",
    body: JSON.stringify({ token })
  });
}

export function listModelPriority(discordUserId: string): Promise<{ items: ModelPriorityItem[] }> {
  return callWorkerApi(discordUserId, "/ai/opencode/models/priority");
}

/** Nova ordem completa — o backend faz replace-all por posicao, entao a lista enviada
 * precisa conter todos os modelos que devem permanecer na prioridade. */
export function saveModelPriority(discordUserId: string, modelIds: string[]): Promise<{ ok: boolean }> {
  return callWorkerApi(discordUserId, "/ai/opencode/models/priority", {
    method: "POST",
    body: JSON.stringify({ modelIds })
  });
}

export function clearModelCooldown(discordUserId: string, modelId: string): Promise<{ ok: boolean }> {
  return callWorkerApi(discordUserId, `/ai/opencode/models/${encodeURIComponent(modelId)}/clear-cooldown`, {
    method: "POST"
  });
}

export function setAutoSwitch(discordUserId: string, enabled: boolean): Promise<{ ok: boolean }> {
  return callWorkerApi(discordUserId, "/ai/opencode/auto-switch", {
    method: "POST",
    body: JSON.stringify({ enabled })
  });
}

export function getBotParameters(discordUserId: string): Promise<{ items: BotParameterRow[] }> {
  return callWorkerApi(discordUserId, "/settings/parameters");
}

export function saveBotParameter(discordUserId: string, key: string, value: string): Promise<{ ok: boolean }> {
  return callWorkerApi(discordUserId, "/settings/parameters", {
    method: "POST",
    body: JSON.stringify({ key, value })
  });
}
