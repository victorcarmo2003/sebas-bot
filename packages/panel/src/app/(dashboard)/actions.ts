"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/require-session";
import {
  clearModelCooldown,
  getSelfUpdateStatus,
  listOpenCodeModels,
  requestSelfUpdate,
  resolveNotification,
  saveBotParameter,
  saveGithubToken,
  saveModelPriority,
  saveOpenCodeKey,
  selectOpenCodeModel,
  setAutoSwitch,
  type OpenCodeModel,
  type SelfUpdateStatus
} from "@/lib/worker-api";

export async function resolveNotificationAction(id: number): Promise<void> {
  const session = await requireSession();
  await resolveNotification(session.discordUserId, id);
  revalidatePath("/");
}

export async function saveOpenCodeKeyAction(apiKey: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  if (session.role !== "owner") {
    return { ok: false, error: "So o dono pode configurar o provedor de IA." };
  }

  try {
    await saveOpenCodeKey(session.discordUserId, apiKey);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function listOpenCodeModelsAction(): Promise<{ items: OpenCodeModel[] } | { error: string }> {
  const session = await requireSession();
  try {
    return await listOpenCodeModels(session.discordUserId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function selectOpenCodeModelAction(model: string, notificationId?: number): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  if (session.role !== "owner") {
    return { ok: false, error: "So o dono pode configurar o provedor de IA." };
  }

  try {
    await selectOpenCodeModel(session.discordUserId, model);
    if (notificationId !== undefined) {
      await resolveNotification(session.discordUserId, notificationId);
    }
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function saveGithubTokenAction(token: string, notificationId?: number): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  if (session.role !== "owner") {
    return { ok: false, error: "So o dono pode configurar o token do GitHub." };
  }

  try {
    await saveGithubToken(session.discordUserId, token);
    if (notificationId !== undefined) {
      await resolveNotification(session.discordUserId, notificationId);
    }
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function setAutoSwitchAction(enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  if (session.role !== "owner") {
    return { ok: false, error: "So o dono pode configurar o provedor de IA." };
  }

  try {
    await setAutoSwitch(session.discordUserId, enabled);
    revalidatePath("/settings/opencode");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function saveModelPriorityAction(modelIds: string[]): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  if (session.role !== "owner") {
    return { ok: false, error: "So o dono pode configurar o provedor de IA." };
  }

  try {
    await saveModelPriority(session.discordUserId, modelIds);
    revalidatePath("/settings/opencode");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function clearModelCooldownAction(modelId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  if (session.role !== "owner") {
    return { ok: false, error: "So o dono pode configurar o provedor de IA." };
  }

  try {
    await clearModelCooldown(session.discordUserId, modelId);
    revalidatePath("/settings/opencode");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function saveBotParameterAction(key: string, value: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  if (session.role !== "owner") {
    return { ok: false, error: "So o dono pode alterar os parametros do bot." };
  }

  try {
    await saveBotParameter(session.discordUserId, key, value);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getSelfUpdateStatusAction(): Promise<SelfUpdateStatus> {
  const session = await requireSession();
  try {
    return await getSelfUpdateStatus(session.discordUserId);
  } catch {
    return { phase: "idle", error: null, lastAppliedSha: null, lastAppliedAt: null, currentVersion: null };
  }
}

export async function requestSelfUpdateAction(): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  if (session.role !== "owner") {
    return { ok: false, error: "So o dono pode aplicar o self-update." };
  }
  try {
    const result = await requestSelfUpdate(session.discordUserId);
    return { ok: result.ok, error: result.error };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
