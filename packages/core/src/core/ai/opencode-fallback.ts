import type { DatabaseSync } from "node:sqlite";
import type { CoreConfig } from "../config/env.js";
import { sendDiscordDirectMessage } from "../discord/client.js";
import { runOpenCodeChat } from "./opencode-client.js";
import { getAiProviderSettings, getBotParameter, listProviderModels, markModelRateLimited } from "./settings-repo.js";
import type { AiChatRequest, AiChatResult } from "./types.js";

const DEFAULT_COOLDOWN_HOURS = 24;
const COOLDOWN_PARAMETER_KEY = "rate_limit_cooldown_hours";

interface FailureRecord {
  modelId: string;
  reason: "rate_limit" | "error";
  detail: string;
  cooldownUntil?: string;
}

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

function describeFailure(failure: FailureRecord): string {
  return failure.reason === "rate_limit"
    ? `bateu rate limit (cooldown ate ${failure.cooldownUntil ? formatDateTime(failure.cooldownUntil) : "?"})`
    : `deu erro (${failure.detail.slice(0, 200)})`;
}

/**
 * Fallback automatico de modelo pro provider OpenCode Zen. Tenta os modelos configurados em
 * ai_provider_models na ordem de `position`, pulando os que estao em cooldown de rate limit.
 * Continua pro proximo modelo elegivel em QUALQUER falha (rate limit OU erro generico — um
 * modelo free pode dar 400/5xx pontual sem ser rate limit, e travar a cadeia nesse caso so
 * devolve o erro cru pro usuario final igual o problema original que essa feature resolve). So
 * rate limit (429) vira cooldown de 24h — erro generico nao bota o modelo em quarentena, pode
 * ter sido transitorio, tenta de novo na proxima mensagem. O DM ao dono so sai DEPOIS de saber
 * o desfecho real (modelo que funcionou, ou "todos falharam") — nunca promete uma troca que
 * ainda nao foi confirmada.
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
  const failures: FailureRecord[] = [];

  for (const model of eligible) {
    const result = await runOpenCodeChat(apiKey, model.modelId, request);
    if (result.ok) {
      if (failures.length > 0) {
        void notifySwitch(config, failures, model.modelId).catch(() => undefined);
      }
      return result;
    }

    lastResult = result;
    if (result.rateLimited) {
      const untilIso = new Date(Date.now() + cooldownHours(db) * 60 * 60 * 1000).toISOString();
      markModelRateLimited(db, "opencode", model.modelId, untilIso);
      failures.push({ modelId: model.modelId, reason: "rate_limit", detail: result.error ?? "rate limit", cooldownUntil: untilIso });
    } else {
      failures.push({ modelId: model.modelId, reason: "error", detail: result.error ?? "erro desconhecido" });
    }
  }

  void notifyExhausted(config, failures).catch(() => undefined);
  return lastResult;
}

async function notifySwitch(config: CoreConfig, failures: FailureRecord[], workingModelId: string): Promise<void> {
  const last = failures[failures.length - 1];
  const message =
    failures.length === 1
      ? `O modelo "${last.modelId}" (OpenCode Zen) ${describeFailure(last)}. Troquei pra "${workingModelId}" e respondi normalmente.`
      : `${failures.length} modelos falharam em sequencia antes de "${workingModelId}" funcionar (${failures.map((f) => f.modelId).join(" -> ")}). Ultimo motivo: ${describeFailure(last)}.`;
  await sendDiscordDirectMessage(config.discordBotToken, config.ownerDiscordId, message);
}

async function notifyExhausted(config: CoreConfig, failures: FailureRecord[]): Promise<void> {
  const summary = failures.map((f) => `"${f.modelId}" (${describeFailure(f)})`).join("; ");
  const message = `Nenhum modelo OpenCode configurado respondeu nesta tentativa: ${summary}. Configure mais modelos de fallback ou confira a conta no painel.`;
  await sendDiscordDirectMessage(config.discordBotToken, config.ownerDiscordId, message);
}
