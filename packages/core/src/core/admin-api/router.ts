import { Hono } from "hono";
import type { Context } from "hono";
import type { DatabaseSync } from "node:sqlite";
import type { CoreConfig } from "../config/env.js";
import { listOpenCodeModels, testOpenCodeKey } from "../ai/opencode-client.js";
import {
  clearModelCooldown,
  getAiProviderSettings,
  listBotParameters,
  listProviderModels,
  markAiProviderStatus,
  saveAiProviderKey,
  saveProviderModelOrder,
  selectAiProviderModel,
  setAutoSwitch,
  setBotParameter
} from "../ai/settings-repo.js";
import { testGithubToken } from "../github/client.js";
import { getGithubToken, saveGithubToken } from "../github/settings-repo.js";
import { runAiHealthCheck, runGithubTokenHealthCheck } from "../notifications/health-check.js";
import { listPendingActions, resolvePendingActionByDedupeKey, resolvePendingActionById } from "../notifications/repo.js";
import { discoverModules } from "../modules/discover.js";
import type { ModuleHost } from "../modules/host.js";
import { installModule } from "../modules/installer.js";
import { approveModule, disableModule, enableModule, rejectModule, uninstallModule } from "../modules/lifecycle.js";
import { getModuleInstall, listModuleInstalls, toModuleDetail } from "../modules/marketplace-repo.js";
import { checkForUpdates, updateModule } from "../modules/updater.js";
import { checkSelfUpdateAvailable, readCurrentVersion } from "../self-update/check.js";
import { isSelfUpdateInProgress, readSelfUpdateStatus, requestSelfUpdate } from "../self-update/status.js";
import { diffAgainstGrantedItems, grantsRequestedByManifest, loadActiveGrantItems } from "../modules/grants.js";
import type { SebasControllerRequest } from "../modules/types.js";
import { createMcpServer, deleteMcpServer, listMcpServers, type McpClientManager } from "../mcp/client.js";
import type { ToolRegistry } from "../tools/registry.js";
import { ALL_SCOPES, hasScope, resolveAdmin, type Admin, type PermissionScope } from "./rbac.js";
import { deleteSubadmin, listAdmins, listModuleRows, listRunLogs, upsertSubadmin } from "./repo.js";

export interface AdminApiDeps {
  db: DatabaseSync;
  config: CoreConfig;
  host: ModuleHost;
  dataDir: string;
  /** Raiz do checkout do proprio sebas-bot (repo inteiro, nao so packages/core) — usado so pelo
   * self-update (checkSelfUpdateAvailable le HEAD local/remoto daqui). */
  repoRoot: string;
  /** Todos os modulos in-tree ativos (changelog-roblox, permissions, ...) — usado pra rotas que
   * precisam agregar/iterar sobre todos eles (ver bin/bot.ts). */
  inTreeModuleIds: string[];
  /** Modulo cujo controller e' montado direto na raiz da admin API sem prefixo de moduleId —
   * mantem compat com o painel atual (/guilds, /settings, /history). Outros modulos in-tree
   * (ex. permissions) ficam acessiveis via /modules/:moduleId/controller/* (ver
   * registerInTreeControllerFallback mais abaixo). */
  legacyControllerModuleId: string;
  toolRegistry: ToolRegistry;
  mcpClientManager: McpClientManager;
}

type Env = { Variables: { admin: Admin } };

export function createAdminApiRouter(deps: AdminApiDeps): Hono<Env> {
  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    const auth = c.req.header("authorization");
    const expected = `Bearer ${process.env.ADMIN_API_SECRET ?? ""}`;
    if (!process.env.ADMIN_API_SECRET || auth !== expected) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const discordUserId = c.req.header("x-admin-discord-id");
    if (!discordUserId) {
      return c.json({ error: "missing X-Admin-Discord-Id header" }, 400);
    }
    const admin = resolveAdmin(deps.db, deps.config.ownerDiscordId, discordUserId);
    if (!admin) {
      return c.json({ error: "forbidden" }, 403);
    }
    c.set("admin", admin);
    await next();
  });

  app.get("/whoami", (c) => {
    const admin = c.get("admin");
    return c.json({ discordUserId: admin.discordUserId, role: admin.role, permissions: admin.permissions });
  });

  registerAdminsRoutes(app, deps);
  registerLogsRoutes(app, deps);
  registerModulesRoutes(app, deps);
  registerNotificationsRoutes(app, deps);
  registerAiRoutes(app, deps);
  registerGithubRoutes(app, deps);
  registerSelfUpdateRoutes(app, deps);
  registerToolsRoutes(app, deps);
  registerMcpRoutes(app, deps);
  registerSettingsRoutes(app, deps);
  registerInTreeControllerFallback(app, deps);

  return app;
}

function requireScope(admin: Admin, scope: PermissionScope): Response | null {
  if (!hasScope(admin, scope)) {
    return Response.json({ error: `missing scope: ${scope}` }, { status: 403 });
  }
  return null;
}

/** Instalar modulo e cadastrar servidor MCP disparam execucao de comando arbitrario (clone+build,
 * spawn de processo) — mesmo com sandboxCommand() (ver security/sandbox.ts), so o dono, nao
 * qualquer subadmin com "modules:manage", pode iniciar isso. Mesmo padrao de /ai/opencode/key. */
function requireOwner(admin: Admin): Response | null {
  if (admin.role !== "owner") {
    return Response.json({ error: "only the owner can do this" }, { status: 403 });
  }
  return null;
}

function registerAdminsRoutes(app: Hono<Env>, deps: AdminApiDeps): void {
  app.get("/admins", (c) => {
    const denied = requireScope(c.get("admin"), "admins:manage");
    if (denied) return denied;
    return c.json({ items: listAdmins(deps.db) });
  });

  app.post("/admins", async (c) => {
    const admin = c.get("admin");
    const denied = requireScope(admin, "admins:manage");
    if (denied) return denied;
    const body = await c.req.json();
    if (!body.discordUserId) {
      return c.json({ error: "discordUserId is required" }, 400);
    }
    const permissions = sanitizePermissions(body.permissions);
    upsertSubadmin(deps.db, {
      discordUserId: body.discordUserId,
      displayName: body.displayName,
      permissions,
      createdBy: admin.discordUserId
    });
    return c.json({ discordUserId: body.discordUserId, role: "subadmin", permissions }, 201);
  });

  app.patch("/admins/:id", async (c) => {
    const admin = c.get("admin");
    const denied = requireScope(admin, "admins:manage");
    if (denied) return denied;
    const targetId = c.req.param("id");
    const body = await c.req.json();
    const permissions = sanitizePermissions(body.permissions);
    upsertSubadmin(deps.db, { discordUserId: targetId, displayName: body.displayName, permissions, createdBy: admin.discordUserId });
    return c.json({ discordUserId: targetId, role: "subadmin", permissions });
  });

  app.delete("/admins/:id", (c) => {
    const denied = requireScope(c.get("admin"), "admins:manage");
    if (denied) return denied;
    const targetId = c.req.param("id");
    deleteSubadmin(deps.db, targetId);
    return c.json({ discordUserId: targetId, deleted: true });
  });
}

function registerLogsRoutes(app: Hono<Env>, deps: AdminApiDeps): void {
  app.get("/logs", (c) => {
    const denied = requireScope(c.get("admin"), "logs:view");
    if (denied) return denied;
    const cursor = c.req.query("cursor");
    const page = listRunLogs(deps.db, {
      level: c.req.query("level"),
      context: c.req.query("context"),
      cursor: cursor ? Number(cursor) : undefined,
      limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined
    });
    return c.json(page);
  });
}

function registerModulesRoutes(app: Hono<Env>, deps: AdminApiDeps): void {
  app.get("/modules", (c) => {
    const denied = requireScope(c.get("admin"), "modules:manage");
    if (denied) return denied;
    return c.json({ items: listModuleRows(deps.db) });
  });

  app.get("/modules/discover", async (c) => {
    const denied = requireScope(c.get("admin"), "modules:manage");
    if (denied) return denied;
    const result = await discoverModules(deps.db, c.req.query("q") ?? "");
    return c.json(result);
  });

  app.post("/modules/install", async (c) => {
    const admin = c.get("admin");
    const denied = requireOwner(admin);
    if (denied) return denied;
    const body = await c.req.json();
    if (!body.repoUrl) {
      return c.json({ ok: false, errors: ["repoUrl is required"] }, 400);
    }
    const result = await installModule(deps.db, deps.host, deps.dataDir, body.repoUrl, admin.discordUserId);
    return c.json(result, result.ok ? 200 : 400);
  });

  app.get("/modules/:id", (c) => {
    const denied = requireScope(c.get("admin"), "modules:manage");
    if (denied) return denied;
    const row = getModuleInstall(deps.db, c.req.param("id"));
    if (!row) return c.json({ error: "not found" }, 404);
    const detail = toModuleDetail(deps.db, row);
    const alreadyGranted = loadActiveGrantItems(deps.db, detail.id);
    detail.pendingPermissionDiff = diffAgainstGrantedItems(grantsRequestedByManifest(detail.manifest), alreadyGranted);
    return c.json(detail);
  });

  app.delete("/modules/:id", async (c) => {
    const admin = c.get("admin");
    const denied = requireScope(admin, "modules:manage");
    if (denied) return denied;
    await uninstallModule(deps.db, deps.host, c.req.param("id"), admin.discordUserId);
    return c.json({ deleted: true });
  });

  app.post("/modules/:id/approve", (c) => {
    const admin = c.get("admin");
    const denied = requireScope(admin, "modules:manage");
    if (denied) return denied;
    approveModule(deps.db, c.req.param("id"), admin.discordUserId);
    return c.json({ ok: true });
  });

  app.post("/modules/:id/reject", (c) => {
    const admin = c.get("admin");
    const denied = requireScope(admin, "modules:manage");
    if (denied) return denied;
    rejectModule(deps.db, c.req.param("id"), admin.discordUserId);
    return c.json({ ok: true });
  });

  app.post("/modules/:id/enable", (c) => {
    const admin = c.get("admin");
    const denied = requireScope(admin, "modules:manage");
    if (denied) return denied;
    enableModule(deps.db, deps.host, deps.dataDir, c.req.param("id"), admin.discordUserId);
    return c.json({ ok: true });
  });

  app.post("/modules/:id/disable", (c) => {
    const admin = c.get("admin");
    const denied = requireScope(admin, "modules:manage");
    if (denied) return denied;
    disableModule(deps.db, deps.host, c.req.param("id"), admin.discordUserId);
    return c.json({ ok: true });
  });

  app.post("/modules/:id/check-update", async (c) => {
    const denied = requireScope(c.get("admin"), "modules:manage");
    if (denied) return denied;
    const moduleId = c.req.param("id");
    const candidates = await checkForUpdates(deps.db, deps.dataDir);
    const match = candidates.find((item) => item.moduleId === moduleId);
    const row = getModuleInstall(deps.db, moduleId);
    return c.json({
      hasUpdate: Boolean(match),
      currentSha: row?.pinned_sha ?? null,
      remoteSha: match?.remoteSha ?? row?.pinned_sha ?? null
    });
  });

  app.post("/modules/:id/update", async (c) => {
    const admin = c.get("admin");
    if (admin.role !== "owner") {
      return c.json({ error: "only the owner can apply module updates" }, 403);
    }
    const moduleId = c.req.param("id");
    const result = await updateModule(deps.db, deps.host, deps.dataDir, moduleId, admin.discordUserId);
    if (result.ok && result.toSha) {
      resolvePendingActionByDedupeKey(deps.db, `module-update:${moduleId}:${result.toSha}`, admin.discordUserId);
    }
    return c.json(result, result.ok ? 200 : 502);
  });
}

function registerNotificationsRoutes(app: Hono<Env>, deps: AdminApiDeps): void {
  app.get("/notifications", (c) => {
    return c.json({ items: listPendingActions(deps.db) });
  });

  app.post("/notifications/:id/resolve", (c) => {
    const admin = c.get("admin");
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) {
      return c.json({ error: "invalid id" }, 400);
    }
    resolvePendingActionById(deps.db, id, admin.discordUserId);
    return c.json({ id, resolved: true });
  });
}

function registerAiRoutes(app: Hono<Env>, deps: AdminApiDeps): void {
  app.get("/ai/status", (c) => {
    const opencode = getAiProviderSettings(deps.db, "opencode");
    return c.json({
      opencode: opencode
        ? {
            providerId: opencode.providerId,
            hasApiKey: Boolean(opencode.apiKey),
            selectedModel: opencode.selectedModel,
            status: opencode.status,
            lastCheckedAt: opencode.lastCheckedAt,
            lastError: opencode.lastError,
            autoSwitchEnabled: opencode.autoSwitchEnabled
          }
        : { providerId: "opencode", hasApiKey: false, status: "unconfigured", selectedModel: null, autoSwitchEnabled: true }
    });
  });

  app.post("/ai/opencode/key", async (c) => {
    const admin = c.get("admin");
    if (admin.role !== "owner") {
      return c.json({ error: "only the owner can configure the AI provider" }, 403);
    }
    const body = await c.req.json();
    if (!body.apiKey) {
      return c.json({ error: "apiKey is required" }, 400);
    }
    const check = await testOpenCodeKey(body.apiKey);
    if (!check.ok) {
      return c.json({ error: check.error ?? "invalid API key" }, 400);
    }
    saveAiProviderKey(deps.db, "opencode", body.apiKey);
    return c.json({ ok: true });
  });

  app.get("/ai/opencode/models", async (c) => {
    const settings = getAiProviderSettings(deps.db, "opencode");
    if (!settings?.apiKey) {
      return c.json({ error: "no OpenCode API key configured yet" }, 400);
    }
    try {
      const models = await listOpenCodeModels(settings.apiKey);
      return c.json({ items: models.filter((model) => model.free) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
    }
  });

  app.post("/ai/opencode/select", async (c) => {
    const admin = c.get("admin");
    if (admin.role !== "owner") {
      return c.json({ error: "only the owner can configure the AI provider" }, 403);
    }
    const body = await c.req.json();
    if (!body.model) {
      return c.json({ error: "model is required" }, 400);
    }
    selectAiProviderModel(deps.db, "opencode", body.model);
    await runAiHealthCheck(deps.db, deps.config);
    return c.json({ ok: true, model: body.model });
  });

  app.get("/ai/opencode/models/priority", (c) => {
    return c.json({ items: listProviderModels(deps.db, "opencode") });
  });

  app.post("/ai/opencode/models/priority", async (c) => {
    const admin = c.get("admin");
    if (admin.role !== "owner") {
      return c.json({ error: "only the owner can configure the AI provider" }, 403);
    }
    const body = await c.req.json();
    if (!Array.isArray(body.modelIds) || body.modelIds.some((id: unknown) => typeof id !== "string")) {
      return c.json({ error: "modelIds must be an array of strings" }, 400);
    }
    saveProviderModelOrder(deps.db, "opencode", body.modelIds);
    if (body.modelIds.length > 0) {
      // Ter uma lista de prioridade configurada ja conta como "provider pronto pra uso" — o
      // fluxo novo (drag-and-drop) nao passa mais por selectAiProviderModel (que marcava status
      // 'ok' no fluxo legado de modelo unico).
      markAiProviderStatus(deps.db, "opencode", "ok");
    }
    return c.json({ ok: true, items: listProviderModels(deps.db, "opencode") });
  });

  app.post("/ai/opencode/models/:modelId/clear-cooldown", (c) => {
    const admin = c.get("admin");
    if (admin.role !== "owner") {
      return c.json({ error: "only the owner can configure the AI provider" }, 403);
    }
    clearModelCooldown(deps.db, "opencode", c.req.param("modelId"));
    return c.json({ ok: true });
  });

  app.post("/ai/opencode/auto-switch", async (c) => {
    const admin = c.get("admin");
    if (admin.role !== "owner") {
      return c.json({ error: "only the owner can configure the AI provider" }, 403);
    }
    const body = await c.req.json();
    if (typeof body.enabled !== "boolean") {
      return c.json({ error: "enabled must be a boolean" }, 400);
    }
    setAutoSwitch(deps.db, "opencode", body.enabled);
    return c.json({ ok: true, enabled: body.enabled });
  });
}

function registerGithubRoutes(app: Hono<Env>, deps: AdminApiDeps): void {
  app.get("/github/status", (c) => {
    return c.json({ hasToken: Boolean(getGithubToken(deps.db)) });
  });

  app.post("/github/token", async (c) => {
    const admin = c.get("admin");
    if (admin.role !== "owner") {
      return c.json({ error: "only the owner can configure the GitHub token" }, 403);
    }
    const body = await c.req.json();
    if (!body.token) {
      return c.json({ error: "token is required" }, 400);
    }
    const check = await testGithubToken(body.token);
    if (!check.ok) {
      return c.json({ error: check.error ?? "invalid token" }, 400);
    }
    saveGithubToken(deps.db, body.token);
    await runGithubTokenHealthCheck(deps.db, deps.config);
    return c.json({ ok: true });
  });
}

function registerToolsRoutes(app: Hono<Env>, deps: AdminApiDeps): void {
  app.get("/tools", async (c) => {
    const denied = requireScope(c.get("admin"), "modules:manage");
    if (denied) return denied;
    const tools = await deps.toolRegistry.listQualifiedTools();
    return c.json({ items: tools });
  });
}

function registerMcpRoutes(app: Hono<Env>, deps: AdminApiDeps): void {
  app.get("/mcp/servers", (c) => {
    const denied = requireScope(c.get("admin"), "modules:manage");
    if (denied) return denied;
    return c.json({ items: listMcpServers(deps.db) });
  });

  app.post("/mcp/servers", async (c) => {
    const denied = requireOwner(c.get("admin"));
    if (denied) return denied;
    const body = await c.req.json();
    if (!body.id || !body.name || !body.transport) {
      return c.json({ error: "id, name and transport are required" }, 400);
    }
    if (body.transport !== "stdio" && body.transport !== "http") {
      return c.json({ error: "transport must be 'stdio' or 'http'" }, 400);
    }
    createMcpServer(deps.db, {
      id: body.id,
      name: body.name,
      transport: body.transport,
      command: body.command,
      args: Array.isArray(body.args) ? body.args : undefined,
      url: body.url,
      env: typeof body.env === "object" && body.env !== null ? body.env : undefined
    });
    const created = listMcpServers(deps.db).find((server) => server.id === body.id);
    if (created) {
      try {
        await deps.mcpClientManager.connect(created);
      } catch (error) {
        return c.json({ ok: true, connected: false, error: error instanceof Error ? error.message : String(error) }, 201);
      }
    }
    return c.json({ ok: true, connected: true }, 201);
  });

  app.delete("/mcp/servers/:id", async (c) => {
    const denied = requireScope(c.get("admin"), "modules:manage");
    if (denied) return denied;
    const id = c.req.param("id");
    await deps.mcpClientManager.disconnect(id);
    deleteMcpServer(deps.db, id);
    return c.json({ deleted: true });
  });
}

/** GET/POST genericos de key-value pra comportamento do bot (persona override, defaults de IA,
 * cooldown de rate limit — chave "rate_limit_cooldown_hours" e' a que opencode-fallback.ts le).
 * Generico de proposito: o backend nao precisa conhecer o conjunto de chaves que o painel usa. */
function registerSettingsRoutes(app: Hono<Env>, deps: AdminApiDeps): void {
  app.get("/settings/parameters", (c) => {
    return c.json({ items: listBotParameters(deps.db) });
  });

  app.post("/settings/parameters", async (c) => {
    const admin = c.get("admin");
    if (admin.role !== "owner") {
      return c.json({ error: "only the owner can configure bot parameters" }, 403);
    }
    const body = await c.req.json();
    if (typeof body.key !== "string" || !body.key) {
      return c.json({ error: "key is required" }, 400);
    }
    if (typeof body.value !== "string") {
      return c.json({ error: "value must be a string" }, 400);
    }
    setBotParameter(deps.db, body.key, body.value);
    return c.json({ ok: true, key: body.key, value: body.value });
  });
}

/** Status e' lido direto de um arquivo JSON escrito pelo script root fora do checkout (ver
 * self-update/status.ts) — nao passa pelo banco, o script nao roda node nenhum. */
function registerSelfUpdateRoutes(app: Hono<Env>, deps: AdminApiDeps): void {
  app.get("/self-update/status", async (c) => {
    const [status, currentVersion] = await Promise.all([
      readSelfUpdateStatus(deps.dataDir),
      readCurrentVersion(deps.repoRoot)
    ]);
    return c.json({ ...status, currentVersion });
  });

  app.post("/self-update/request", async (c) => {
    const admin = c.get("admin");
    if (admin.role !== "owner") {
      return c.json({ error: "only the owner can trigger a self-update" }, 403);
    }
    if (await isSelfUpdateInProgress(deps.dataDir)) {
      return c.json({ ok: false, error: "Ja tem um self-update em andamento." }, 409);
    }
    const candidate = await checkSelfUpdateAvailable(deps.repoRoot);
    if (!candidate) {
      return c.json({ ok: false, error: "Nenhuma atualizacao disponivel." }, 404);
    }
    await requestSelfUpdate(deps.dataDir);
    return c.json({ ok: true, ...candidate });
  });
}

function stripPathPrefix(pathname: string, prefix: string): string {
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) || "/" : pathname;
}

async function forwardToModuleController(c: Context<Env>, deps: AdminApiDeps, moduleId: string, stripPrefix: string): Promise<Response> {
  if (!deps.host.isRunning(moduleId)) {
    return c.json({ error: "not found" }, 404);
  }
  const url = new URL(c.req.url);
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => {
    headers[key] = value;
  });

  let body: unknown = null;
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    body = await c.req.json().catch(() => null);
  }

  const req: SebasControllerRequest = {
    method: c.req.method,
    path: stripPathPrefix(url.pathname, stripPrefix),
    query,
    headers,
    body
  };

  try {
    const response = await deps.host.handleControllerRequest(moduleId, req);
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "content-type": "application/json" }
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
  }
}

/** Superficie generica de controller pra qualquer modulo in-tree (ex. /modules/permissions/controller/gates/dm)
 * — o path relativo (apos ".../controller") vira req.path pro handleRequest do modulo, exatamente
 * como o fallback legado abaixo faz pra changelog-roblox sem prefixo nenhum. */
function registerModuleControllerRoutes(app: Hono<Env>, deps: AdminApiDeps): void {
  app.all("/modules/:moduleId/controller/*", async (c) => {
    const moduleId = c.req.param("moduleId");
    return forwardToModuleController(c, deps, moduleId, `/api/admin/modules/${moduleId}/controller`);
  });
}

/** Rotas do modulo legado (changelog-roblox: /guilds, /settings, /history, ...) sem prefixo de
 * moduleId — preserva o contrato que o painel ja consome (worker-api.ts). Modulos instalados via
 * marketplace nao passam por aqui; eles ainda nao tem uma superficie de admin API generica
 * exposta ao painel (fica pra quando o primeiro modulo de terceiro precisar de uma alem do
 * /modules/:moduleId/controller/* acima). */
function registerInTreeControllerFallback(app: Hono<Env>, deps: AdminApiDeps): void {
  registerModuleControllerRoutes(app, deps);

  app.all("/*", async (c) => {
    return forwardToModuleController(c, deps, deps.legacyControllerModuleId, "/api/admin");
  });
}

function sanitizePermissions(input: unknown): PermissionScope[] {
  if (!Array.isArray(input)) return [];
  return input.filter((value): value is PermissionScope => (ALL_SCOPES as readonly string[]).includes(value));
}
