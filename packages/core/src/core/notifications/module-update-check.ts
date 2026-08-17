import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { CoreConfig } from "../config/env.js";
import { getBotParameter, setBotParameter } from "../ai/settings-repo.js";
import { checkForUpdates } from "../modules/updater.js";
import { notifyDiscordUserOfPendingAction } from "./dm.js";
import { markNotified, upsertPendingAction } from "./repo.js";

const LAST_CHECK_KEY = "marketplace_last_checked_at";
const POLL_INTERVAL_KEY = "marketplace_poll_interval_minutes";
const AUTO_UPDATE_KEY = "marketplace_auto_update_enabled";
const DEFAULT_POLL_INTERVAL_MINUTES = 60;

function updateDedupeKey(moduleId: string, remoteSha: string): string {
  // Inclui o sha remoto no dedupeKey de proposito: se o repo avancar de novo antes do dono agir
  // na pendencia anterior, isso vira uma pendencia NOVA (reabre notificacao), em vez de ficar
  // silenciosamente desatualizada apontando pro sha errado.
  return `module-update:${moduleId}:${remoteSha}`;
}

/**
 * Roda no tick do worker (ver bin/worker.ts). So verifica de verdade quando o intervalo
 * configurado (marketplace_poll_interval_minutes, default 60) ja passou desde a ultima vez —
 * o Cron que chama isso roda num tick fixo curto (5min), essa funcao decide se e' "sua vez".
 */
export async function runModuleUpdateCheckIfDue(db: DatabaseSync, config: CoreConfig): Promise<void> {
  const intervalMinutes = Number(getBotParameter(db, POLL_INTERVAL_KEY) ?? DEFAULT_POLL_INTERVAL_MINUTES);
  const lastCheckedRaw = getBotParameter(db, LAST_CHECK_KEY);
  const lastChecked = lastCheckedRaw ? new Date(lastCheckedRaw).getTime() : 0;
  const dueAt = lastChecked + Math.max(1, intervalMinutes) * 60_000;
  if (Date.now() < dueAt) return;

  await runModuleUpdateCheck(db, config);
}

async function runModuleUpdateCheck(db: DatabaseSync, config: CoreConfig): Promise<void> {
  setBotParameter(db, LAST_CHECK_KEY, new Date().toISOString());

  const dataDir = dirname(config.dbPath);
  const candidates = await checkForUpdates(db, dataDir);
  const autoUpdateEnabled = getBotParameter(db, AUTO_UPDATE_KEY) === "true";

  for (const candidate of candidates) {
    if (autoUpdateEnabled) {
      await applyUpdateViaInternalApi(db, config, candidate.moduleId, candidate.currentSha, candidate.remoteSha);
    } else {
      await raiseUpdateAvailable(db, config, candidate.moduleId, candidate.currentSha, candidate.remoteSha);
    }
  }
}

async function applyUpdateViaInternalApi(
  db: DatabaseSync,
  config: CoreConfig,
  moduleId: string,
  fromSha: string,
  toSha: string
): Promise<void> {
  try {
    const response = await fetch(`http://127.0.0.1:${config.botPort}/internal/modules/${moduleId}/update`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.ADMIN_API_SECRET ?? ""}` }
    });
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !body.ok) {
      await notifyOwner(
        db,
        config,
        updateDedupeKey(moduleId, toSha),
        "critical",
        `Auto-update de "${moduleId}" falhou`,
        `Tentei atualizar sozinho (${fromSha.slice(0, 7)} → ${toSha.slice(0, 7)}) mas deu erro: ${body.error ?? `HTTP ${response.status}`}. Confira em /modules/${moduleId}.`
      );
      return;
    }
    await notifyOwner(
      db,
      config,
      updateDedupeKey(moduleId, toSha),
      "info",
      `Módulo "${moduleId}" atualizado automaticamente`,
      `Troquei sozinho de ${fromSha.slice(0, 7)} para ${toSha.slice(0, 7)} (auto-update ligado nas configurações de Marketplace).`
    );
  } catch (error) {
    await notifyOwner(
      db,
      config,
      updateDedupeKey(moduleId, toSha),
      "critical",
      `Auto-update de "${moduleId}" falhou`,
      `Não consegui nem chamar o processo do bot pra aplicar o update: ${error instanceof Error ? error.message : String(error)}.`
    );
  }
}

async function raiseUpdateAvailable(db: DatabaseSync, config: CoreConfig, moduleId: string, fromSha: string, toSha: string): Promise<void> {
  await notifyOwner(
    db,
    config,
    updateDedupeKey(moduleId, toSha),
    "info",
    `Atualização disponível: ${moduleId}`,
    `O repositório do módulo "${moduleId}" tem commit novo (${fromSha.slice(0, 7)} → ${toSha.slice(0, 7)}). Vá em /modules/${moduleId} pra aplicar, ou ligue auto-update em Configurações → Marketplace.`
  );
}

async function notifyOwner(
  db: DatabaseSync,
  config: CoreConfig,
  dedupeKey: string,
  severity: "info" | "warning" | "critical",
  title: string,
  message: string
): Promise<void> {
  const { action, isNewOrReopened } = upsertPendingAction(db, {
    kind: "module_update",
    severity,
    title,
    message,
    actionKind: "module_update_available",
    dedupeKey,
    targetDiscordUserId: config.ownerDiscordId
  });
  if (!isNewOrReopened) return;
  try {
    await notifyDiscordUserOfPendingAction(config.discordBotToken, config.panelUrl, action);
    markNotified(db, action.id);
  } catch (error) {
    console.warn("Failed to send module-update pending-action DM.", error);
  }
}
