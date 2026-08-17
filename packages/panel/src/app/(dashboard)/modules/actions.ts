"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require-session";
import { installModule } from "@/lib/worker-api";

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
