import type { DatabaseSync } from "node:sqlite";
import type { CoreConfig } from "../config/env.js";
import { getBotParameter } from "../ai/settings-repo.js";
import { checkSelfUpdateAvailable } from "../self-update/check.js";
import { isSelfUpdateInProgress, requestSelfUpdate } from "../self-update/status.js";
import { notifyDiscordUserOfPendingAction } from "./dm.js";
import { markNotified, upsertPendingAction } from "./repo.js";

const AUTO_UPDATE_KEY = "self_update_auto_enabled";

/** Chamado no tick fixo do worker (bin/worker.ts) e uma vez no start — sem intervalo
 * configuravel separado (o dono so pediu "chronos + check on start"), reusa o mesmo tick
 * de 5min que ja existe pro checkForUpdates de modulos. */
export async function runSelfUpdateCheck(db: DatabaseSync, config: CoreConfig, repoRoot: string, dataDir: string): Promise<void> {
  if (await isSelfUpdateInProgress(dataDir)) return;

  const candidate = await checkSelfUpdateAvailable(repoRoot);
  if (!candidate) return;

  const autoUpdateEnabled = getBotParameter(db, AUTO_UPDATE_KEY) === "true";
  if (autoUpdateEnabled) {
    await requestSelfUpdate(dataDir);
    await notifyOwner(
      db,
      config,
      dedupeKey(candidate.remoteSha),
      "info",
      "Sebas está se atualizando sozinho",
      `Encontrei commit novo no próprio repositório (${candidate.currentSha.slice(0, 7)} → ${candidate.remoteSha.slice(0, 7)}) e auto-update está ligado. Aplicando agora — acompanhe o progresso na tela principal.`
    );
    return;
  }

  await notifyOwner(
    db,
    config,
    dedupeKey(candidate.remoteSha),
    "info",
    "Atualização do Sebas disponível",
    `O repositório principal tem commit novo (${candidate.currentSha.slice(0, 7)} → ${candidate.remoteSha.slice(0, 7)}). Ligue auto-update em Configurações → Conta, ou aplique manualmente pela tela principal.`
  );
}

function dedupeKey(remoteSha: string): string {
  return `self-update:${remoteSha}`;
}

async function notifyOwner(
  db: DatabaseSync,
  config: CoreConfig,
  dedupeKeyValue: string,
  severity: "info" | "warning" | "critical",
  title: string,
  message: string
): Promise<void> {
  const { action, isNewOrReopened } = upsertPendingAction(db, {
    kind: "self_update",
    severity,
    title,
    message,
    actionKind: "self_update_available",
    dedupeKey: dedupeKeyValue,
    targetDiscordUserId: config.ownerDiscordId
  });
  if (!isNewOrReopened) return;
  try {
    await notifyDiscordUserOfPendingAction(config.discordBotToken, config.panelUrl, action);
    markNotified(db, action.id);
  } catch (error) {
    console.warn("Failed to send self-update pending-action DM.", error);
  }
}
