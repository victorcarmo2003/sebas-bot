import type { SebasControllerRequest, SebasControllerResponse, SebasModuleContext } from "./sebas-types.js";
import type { GateMode } from "./storage.js";
import { GATE_SURFACES, isGateSurface, loadGateConfig, loadToolAllowlist, saveGateConfig, saveToolAllowlist } from "./storage.js";

function json(status: number, body: unknown): SebasControllerResponse {
  return { status, body };
}

function isValidMode(value: unknown): value is GateMode {
  return value === "everyone" || value === "whitelist" || value === "blacklist";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Rotas CRUD consumidas pelo painel via /api/admin/modules/permissions/controller/* (ver
 * admin-api/router.ts::registerModuleControllerRoutes no core). req.path ja chega relativo
 * (sem o prefixo /modules/permissions/controller).
 *
 *   GET  /gates            -> configuracao das 3 surfaces (dm/mention/action) de uma vez
 *   GET  /gates/:surface   -> configuracao de uma surface
 *   PUT  /gates/:surface   -> body { mode, userIds, roleIds }
 *   GET  /tools/allowlist  -> lista de qualifiedToolName liberados globalmente
 *   PUT  /tools/allowlist  -> body { items: string[] }
 */
async function handleRequest(ctx: SebasModuleContext, req: SebasControllerRequest): Promise<SebasControllerResponse> {
  const parts = req.path.split("/").filter(Boolean);

  if (req.method === "GET" && parts.length === 1 && parts[0] === "gates") {
    const items = await Promise.all(GATE_SURFACES.map((surface) => loadGateConfig(ctx, surface)));
    return json(200, { items });
  }

  if (parts.length === 2 && parts[0] === "gates") {
    const surface = parts[1];
    if (!isGateSurface(surface)) return json(400, { error: `invalid surface: ${surface}` });

    if (req.method === "GET") {
      return json(200, await loadGateConfig(ctx, surface));
    }
    if (req.method === "PUT") {
      const body = req.body as { mode?: unknown; userIds?: unknown; roleIds?: unknown } | null;
      if (!isValidMode(body?.mode)) return json(400, { error: "mode must be 'everyone', 'whitelist' or 'blacklist'" });
      const userIds = isStringArray(body?.userIds) ? body.userIds : [];
      const roleIds = isStringArray(body?.roleIds) ? body.roleIds : [];
      const saved = await saveGateConfig(ctx, surface, { mode: body.mode, userIds, roleIds });
      return json(200, saved);
    }
  }

  if (parts.length === 2 && parts[0] === "tools" && parts[1] === "allowlist") {
    if (req.method === "GET") {
      return json(200, { items: await loadToolAllowlist(ctx) });
    }
    if (req.method === "PUT") {
      const body = req.body as { items?: unknown } | null;
      if (!isStringArray(body?.items)) return json(400, { error: "items must be an array of strings" });
      const saved = await saveToolAllowlist(ctx, body.items);
      return json(200, { items: saved });
    }
  }

  return json(404, { error: "not found" });
}

// Mesmo padrao do changelog-roblox: so ctx.storage e' liberado durante o self-test de instalacao
// (ver installer.ts::installModule). Modulo in-tree nunca passa por aqui de verdade, mas mantem
// o entrypoint coerente caso um dia vire um modulo instalavel via marketplace.
async function selfTest(ctx: SebasModuleContext): Promise<void> {
  await ctx.storage.set("__selftest__", { at: new Date().toISOString() });
  const value = await ctx.storage.get<{ at: string }>("__selftest__");
  if (!value?.at) {
    throw new Error("storage roundtrip falhou no smoke test.");
  }
  await ctx.storage.delete("__selftest__");
  ctx.logger.info("permissions: smoke test ok.");
}

export default { handleRequest, selfTest };
