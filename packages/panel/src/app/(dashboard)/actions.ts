"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/require-session";
import {
  listOpenCodeModels,
  resolveNotification,
  saveOpenCodeKey,
  selectOpenCodeModel,
  type OpenCodeModel
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
