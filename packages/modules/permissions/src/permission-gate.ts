import type { PermissionGateRequest, PermissionGateResult, SebasModuleContext, SebasModulePermissionGate } from "./sebas-types.js";
import type { GateConfig } from "./storage.js";
import { loadGateConfig, loadToolAllowlist } from "./storage.js";

function evaluate(config: GateConfig, discordUserId: string, roleIds: string[]): boolean {
  if (config.mode === "everyone") return true;
  const matched = config.userIds.includes(discordUserId) || roleIds.some((roleId) => config.roleIds.includes(roleId));
  return config.mode === "whitelist" ? matched : !matched; // blacklist: passa quem NAO esta na lista
}

async function checkGate(ctx: SebasModuleContext, req: PermissionGateRequest): Promise<PermissionGateResult> {
  if (req.isOwner) {
    return { canRespond: true, allowedTools: "all" };
  }

  // slash_command e mention avaliam a mesma regra ("posso falar dentro do fluxo normal") — so
  // muda o canal de entrada, nao a intencao. Ver nota em sebas-types.ts::PermissionGateRequest.
  const talkSurface = req.surface === "dm" ? "dm" : "mention";
  const talkConfig = await loadGateConfig(ctx, talkSurface);
  if (!evaluate(talkConfig, req.discordUserId, req.roleIds)) {
    return { canRespond: false, allowedTools: [] };
  }

  // Eixo "action": pode falar mas nao necessariamente pode pedir execucao de tool — avaliado
  // separado, com sua propria regra everyone/whitelist/blacklist.
  const actionConfig = await loadGateConfig(ctx, "action");
  if (!evaluate(actionConfig, req.discordUserId, req.roleIds)) {
    return { canRespond: true, allowedTools: [] };
  }

  const allowlist = await loadToolAllowlist(ctx);
  // Allowlist global vazia = ainda nao configurada -> "all" por default sensato. Sem isso, o
  // primeiro subadmin liberado no eixo "action" ficaria sem NENHUMA tool ate o dono lembrar de
  // preencher a allowlist — pior experiencia do que simplesmente nao restringir ainda.
  const allowedTools = allowlist.length === 0 ? "all" : allowlist;
  return { canRespond: true, allowedTools };
}

export default { checkGate } satisfies SebasModulePermissionGate;
