import type { DatabaseSync } from "node:sqlite";
import type { CoreConfig } from "../config/env.js";
import { sendDiscordDirectMessage } from "../discord/client.js";
import { runOpenCodeChat } from "./opencode-client.js";
import { getAiProviderSettings, getBotParameter, listProviderModels, markModelRateLimited } from "./settings-repo.js";
import type { AiChatRequest, AiChatResult } from "./types.js";

const DEFAULT_COOLDOWN_HOURS = 24;
const COOLDOWN_PARAMETER_KEY = "rate_limit_cooldown_hours";

function cooldownHours(db: DatabaseSync): number {
  const raw = getBotParameter(db, COOLDOWN_PARAMETER_KEY);
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_COOLDOWN_HOURS;
}

function isEligible(model: { rateLimitedUntil: string | null }): boolean {
  if (!model.rateLimitedUntil) return true;
  return new Date(model.rateLimitedUntil).getTime() <= Date.now();
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/**
 * Fallback automatico de modelo pro provider OpenCode Zen. Tenta os modelos configurados em
 * ai_provider_models na ordem de `position`, pulando os que ainda estao em cooldown de rate
 * limit; quando um bate 429, marca o cooldown, avisa o dono por DM (fire-and-forget — o aviso
 * nunca deve atrasar ou derrubar a resposta ao usuario) e segue pro proximo elegivel dentro do
 * MESMO request, entao quem perguntou recebe uma resposta normal, nao o erro 429 cru.
 */
export async function runOpenCodeChatWithFallback(
  db: DatabaseSync,
  config: CoreConfig,
  apiKey: string,
  request: AiChatRequest
): Promise<AiChatResult> {
  const settings = getAiProviderSettings(db, "opencode");
  const models = listProviderModels(db, "opencode");

  if (models.length === 0) {
    // Compat: dono ainda nao configurou a lista de prioridade (fluxo antigo, um unico modelo).
    if (settings?.selectedModel) {
      return runOpenCodeChat(apiKey, settings.selectedModel, request);
    }
    return { ok: false, error: "Nenhum modelo OpenCode configurado.", providerId: "opencode" };
  }

  const ordered = [...models].sort((a, b) => a.position - b.position);

  if (settings?.autoSwitchEnabled === false) {
    // Troca automatica desligada: so tenta o de posicao minima, mesmo se estiver em cooldown —
    // sem pular modelo, sem loop, comportamento previsivel pro dono que desligou de proposito.
    return runOpenCodeChat(apiKey, ordered[0].modelId, request);
  }

  const eligible = ordered.filter(isEligible);
  if (eligible.length === 0) {
    return { ok: false, error: "Todos os modelos OpenCode configurados estao em cooldown de rate limit.", providerId: "opencode" };
  }

  let lastResult: AiChatResult = { ok: false, error: "Nenhum modelo elegivel.", providerId: "opencode" };

  for (let index = 0; index < eligible.length; index += 1) {
    const model = eligible[index];
    const result = await runOpenCodeChat(apiKey, model.modelId, request);
    if (result.ok) {
      return result;
    }
    lastResult = result;

    if (!result.rateLimited) {
      // Erro que nao e' rate limit (chave invalida, 5xx, timeout etc.) — tentar outro modelo nao
      // resolve a mesma causa; aborta aqui em vez de mascarar um erro real como "trocando de modelo".
      return result;
    }

    const untilIso = new Date(Date.now() + cooldownHours(db) * 60 * 60 * 1000).toISOString();
    markModelRateLimited(db, "opencode", model.modelId, untilIso);

    const nextModel = eligible[index + 1];
    const warning = nextModel
      ? `O modelo "${model.modelId}" (OpenCode Zen) bateu rate limit. Troquei pra "${nextModel.modelId}" ate ${formatDateTime(untilIso)}.`
      : `O modelo "${model.modelId}" (OpenCode Zen) bateu rate limit e nao ha outro modelo elegivel na lista ate ${formatDateTime(untilIso)}. Configure mais modelos de fallback no painel.`;
    void sendDiscordDirectMessage(config.discordBotToken, config.ownerDiscordId, warning).catch(() => undefined);
  }

  return lastResult;
}
