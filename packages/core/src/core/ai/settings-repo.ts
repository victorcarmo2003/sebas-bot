import type { DatabaseSync } from "node:sqlite";

export interface AiProviderSettings {
  providerId: string;
  apiKey: string | null;
  selectedModel: string | null;
  status: "unconfigured" | "ok" | "error";
  lastCheckedAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

interface AiProviderSettingsRow {
  provider_id: string;
  api_key: string | null;
  selected_model: string | null;
  status: AiProviderSettings["status"];
  last_checked_at: string | null;
  last_error: string | null;
  updated_at: string;
}

function toRow(row: AiProviderSettingsRow): AiProviderSettings {
  return {
    providerId: row.provider_id,
    apiKey: row.api_key,
    selectedModel: row.selected_model,
    status: row.status,
    lastCheckedAt: row.last_checked_at,
    lastError: row.last_error,
    updatedAt: row.updated_at
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
