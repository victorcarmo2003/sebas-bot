import type { DatabaseSync } from "node:sqlite";

export interface AiProviderSettings {
  providerId: string;
  apiKey: string | null;
  selectedModel: string | null;
  status: "unconfigured" | "ok" | "error";
  lastCheckedAt: string | null;
  lastError: string | null;
  updatedAt: string;
  /** Troca automatica de modelo em rate limit (migration 0007) — default true. */
  autoSwitchEnabled: boolean;
}

interface AiProviderSettingsRow {
  provider_id: string;
  api_key: string | null;
  selected_model: string | null;
  status: AiProviderSettings["status"];
  last_checked_at: string | null;
  last_error: string | null;
  updated_at: string;
  auto_switch_enabled: number;
}

function toRow(row: AiProviderSettingsRow): AiProviderSettings {
  return {
    providerId: row.provider_id,
    apiKey: row.api_key,
    selectedModel: row.selected_model,
    status: row.status,
    lastCheckedAt: row.last_checked_at,
    lastError: row.last_error,
    updatedAt: row.updated_at,
    autoSwitchEnabled: row.auto_switch_enabled !== 0
  };
}

export function getAiProviderSettings(db: DatabaseSync, providerId: string): AiProviderSettings | null {
  const row = db.prepare("SELECT * FROM ai_provider_settings WHERE provider_id = ?").get(providerId) as
    | AiProviderSettingsRow
    | undefined;
  return row ? toRow(row) : null;
}

export function listAiProviderSettings(db: DatabaseSync): AiProviderSettings[] {
  const rows = db.prepare("SELECT * FROM ai_provider_settings").all() as unknown as AiProviderSettingsRow[];
  return rows.map(toRow);
}

export function saveAiProviderKey(db: DatabaseSync, providerId: string, apiKey: string): void {
  db.prepare(
    `INSERT INTO ai_provider_settings (provider_id, api_key, selected_model, status, updated_at)
     VALUES (?, ?, NULL, 'unconfigured', ?)
     ON CONFLICT(provider_id) DO UPDATE SET api_key = excluded.api_key, status = 'unconfigured', selected_model = NULL, updated_at = excluded.updated_at`
  ).run(providerId, apiKey, new Date().toISOString());
}

export function selectAiProviderModel(db: DatabaseSync, providerId: string, model: string): void {
  db.prepare(
    `UPDATE ai_provider_settings SET selected_model = ?, status = 'ok', last_error = NULL, last_checked_at = ?, updated_at = ? WHERE provider_id = ?`
  ).run(model, new Date().toISOString(), new Date().toISOString(), providerId);
}

export function markAiProviderStatus(
  db: DatabaseSync,
  providerId: string,
  status: AiProviderSettings["status"],
  errorMessage?: string | null
): void {
  db.prepare(
    `UPDATE ai_provider_settings SET status = ?, last_error = ?, last_checked_at = ?, updated_at = ? WHERE provider_id = ?`
  ).run(status, errorMessage ?? null, new Date().toISOString(), new Date().toISOString(), providerId);
}

export function setAutoSwitch(db: DatabaseSync, providerId: string, enabled: boolean): void {
  db.prepare(
    `INSERT INTO ai_provider_settings (provider_id, selected_model, status, auto_switch_enabled, updated_at)
     VALUES (?, NULL, 'unconfigured', ?, ?)
     ON CONFLICT(provider_id) DO UPDATE SET auto_switch_enabled = excluded.auto_switch_enabled, updated_at = excluded.updated_at`
  ).run(providerId, enabled ? 1 : 0, new Date().toISOString());
}

export interface AiProviderModel {
  modelId: string;
  position: number;
  rateLimitedUntil: string | null;
}

interface AiProviderModelRow {
  provider_id: string;
  model_id: string;
  position: number;
  rate_limited_until: string | null;
}

export function listProviderModels(db: DatabaseSync, providerId: string): AiProviderModel[] {
  const rows = db
    .prepare("SELECT * FROM ai_provider_models WHERE provider_id = ? ORDER BY position ASC")
    .all(providerId) as unknown as AiProviderModelRow[];
  return rows.map((row) => ({ modelId: row.model_id, position: row.position, rateLimitedUntil: row.rate_limited_until }));
}

/** Substitui a lista inteira de prioridade — mais simples que fazer diff, e o caso de uso
 * (painel manda a ordem inteira apos um drag-and-drop) sempre reenvia tudo mesmo. */
export function saveProviderModelOrder(db: DatabaseSync, providerId: string, modelIds: string[]): void {
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM ai_provider_models WHERE provider_id = ?").run(providerId);
    const insert = db.prepare(
      "INSERT INTO ai_provider_models (provider_id, model_id, position, rate_limited_until) VALUES (?, ?, ?, NULL)"
    );
    modelIds.forEach((modelId, index) => insert.run(providerId, modelId, index));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function markModelRateLimited(db: DatabaseSync, providerId: string, modelId: string, untilIso: string): void {
  db.prepare("UPDATE ai_provider_models SET rate_limited_until = ? WHERE provider_id = ? AND model_id = ?").run(
    untilIso,
    providerId,
    modelId
  );
}

export function clearModelCooldown(db: DatabaseSync, providerId: string, modelId: string): void {
  db.prepare("UPDATE ai_provider_models SET rate_limited_until = NULL WHERE provider_id = ? AND model_id = ?").run(
    providerId,
    modelId
  );
}

export interface BotParameter {
  key: string;
  value: string | null;
  updatedAt: string;
}

export function getBotParameter(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("SELECT value FROM bot_parameters WHERE key = ?").get(key) as { value: string | null } | undefined;
  return row ? row.value : null;
}

export function listBotParameters(db: DatabaseSync): BotParameter[] {
  const rows = db.prepare("SELECT key, value, updated_at FROM bot_parameters ORDER BY key ASC").all() as unknown as Array<{
    key: string;
    value: string | null;
    updated_at: string;
  }>;
  return rows.map((row) => ({ key: row.key, value: row.value, updatedAt: row.updated_at }));
}

export function setBotParameter(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    `INSERT INTO bot_parameters (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, new Date().toISOString());
}
