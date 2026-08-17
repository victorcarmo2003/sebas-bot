import type { DatabaseSync } from "node:sqlite";
import type { CoreConfig } from "../config/env.js";
import { listOpenCodeModels, testOpenCodeKey } from "../ai/opencode-client.js";
import { markAiProviderStatus, getAiProviderSettings } from "../ai/settings-repo.js";
import { notifyDiscordUserOfPendingAction } from "./dm.js";
import { markNotified, resolvePendingActionByDedupeKey, upsertPendingAction } from "./repo.js";

const AI_SETUP_DEDUPE_KEY = "ai:opencode:setup";
const AI_INVALID_DEDUPE_KEY = "ai:opencode:invalid";
const AI_MODEL_GONE_DEDUPE_KEY = "ai:opencode:model-unavailable";
const AI_DEDUPE_KEYS = [AI_SETUP_DEDUPE_KEY, AI_INVALID_DEDUPE_KEY, AI_MODEL_GONE_DEDUPE_KEY];

/** Roda a cada tick do scheduler. Mantem ai_provider_settings + pending_actions em dia,
 *  e avisa o dono por DM na primeira vez que uma pendencia nova aparece. */
export async function runAiHealthCheck(db: DatabaseSync, config: CoreConfig): Promise<void> {
  const opencode = getAiProviderSettings(db, "opencode");

  if (!opencode?.apiKey) {
    await raise(db, config, {
      dedupeKey: AI_SETUP_DEDUPE_KEY,
      title: "Configure um provedor de IA",
      message: "O Sebas precisa de uma chave da OpenCode Zen (gratuita) para formatar changelogs com IA. Sem isso, os posts saem sem formatação.",
      actionKind: "ai_provider_setup"
    });
    return;
  }

  const keyCheck = await testOpenCodeKey(opencode.apiKey);
  if (!keyCheck.ok) {
    markAiProviderStatus(db, "opencode", "error", keyCheck.error);
    await raise(db, config, {
      dedupeKey: AI_INVALID_DEDUPE_KEY,
      title: "Chave da OpenCode invalida",
      message: `A chave configurada para a OpenCode Zen parou de funcionar (${keyCheck.error ?? "erro desconhecido"}). Configure uma nova no painel.`,
      actionKind: "ai_provider_setup"
    });
    return;
  }
  resolveByDedupe(db, AI_INVALID_DEDUPE_KEY);

  if (!opencode.selectedModel) {
    await raise(db, config, {
      dedupeKey: AI_SETUP_DEDUPE_KEY,
      title: "Escolha um modelo de IA",
      message: "A chave da OpenCode Zen esta configurada, mas nenhum modelo gratuito foi escolhido ainda.",
      actionKind: "ai_provider_setup"
    });
    return;
  }
  resolveByDedupe(db, AI_SETUP_DEDUPE_KEY);

  const models = await listOpenCodeModels(opencode.apiKey);
  const current = models.find((model) => model.id === opencode.selectedModel);
  if (!current || !current.free) {
    markAiProviderStatus(db, "opencode", "error", "modelo selecionado nao esta mais disponivel de graca");
    await raise(db, config, {
      dedupeKey: AI_MODEL_GONE_DEDUPE_KEY,
      title: "O modelo de IA escolhido nao esta mais gratis",
      message: `A OpenCode Zen trocou os modelos gratuitos e "${opencode.selectedModel}" nao esta mais disponivel de graca. Escolha outro modelo no painel.`,
      actionKind: "ai_provider_setup"
    });
    return;
  }

  markAiProviderStatus(db, "opencode", "ok");
  for (const key of AI_DEDUPE_KEYS) {
    resolveByDedupe(db, key);
  }
}

function resolveByDedupe(db: DatabaseSync, dedupeKey: string): void {
  resolvePendingActionByDedupeKey(db, dedupeKey, "system");
}

async function raise(
  db: DatabaseSync,
  config: CoreConfig,
  input: { dedupeKey: string; title: string; message: string; actionKind: string }
): Promise<void> {
  const { action, isNewOrReopened } = upsertPendingAction(db, {
    kind: "ai_provider",
    severity: "warning",
    title: input.title,
    message: input.message,
    actionKind: input.actionKind,
    dedupeKey: input.dedupeKey,
    targetDiscordUserId: config.ownerDiscordId
  });

  if (isNewOrReopened) {
    try {
      await notifyDiscordUserOfPendingAction(config.discordBotToken, config.panelUrl, action);
      markNotified(db, action.id);
    } catch (error) {
      console.warn("Failed to send pending-action DM.", error);
    }
  }
}
