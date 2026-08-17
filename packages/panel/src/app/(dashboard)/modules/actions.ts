"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/require-session";
import { applyModuleUpdate, checkModuleUpdate, installModule, type ModuleUpdateCheck, type ModuleUpdateResult } from "@/lib/worker-api";

export async function installModuleAction(formData: FormData): Promise<void> {
  const activeSession = await requireSession("modules:manage");
  if (activeSession.role !== "owner") return;

  const repoUrl = String(formData.get("repoUrl") ?? "").trim();
  if (!repoUrl) return;

  const result = await installModule(activeSession.discordUserId, repoUrl);
  if (result.ok && result.moduleId) {
    redirect(`/modules/${result.moduleId}`);
  }
  redirect(`/modules?installError=${encodeURIComponent(result.errors.join(" · ") || "Falha ao instalar módulo.")}`);
}

export async function checkModuleUpdateAction(moduleId: string): Promise<ModuleUpdateCheck | { hasUpdate: false; currentSha: null; remoteSha: null; error: string }> {
  const session = await requireSession("modules:manage");
  try {
    return await checkModuleUpdate(session.discordUserId, moduleId);
  } catch (error) {
    return { hasUpdate: false, currentSha: null, remoteSha: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function applyModuleUpdateAction(moduleId: string): Promise<ModuleUpdateResult> {
  const session = await requireSession("modules:manage");
  if (session.role !== "owner") {
    return { ok: false, error: "Só o dono pode aplicar atualizações de módulo." };
  }
  try {
    const result = await applyModuleUpdate(session.discordUserId, moduleId);
    revalidatePath(`/modules/${moduleId}`);
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
