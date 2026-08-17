import { revalidatePath } from "next/cache";
import { Panel } from "@/components/panel";
import { GithubTokenForm } from "@/components/github-token-form";
import { SelfUpdateTriggerButton } from "@/components/self-update-trigger-button";
import { requireSession } from "@/lib/require-session";
import { getBotParameters, getGithubStatus } from "@/lib/worker-api";
import { saveBotParameterAction } from "@/app/(dashboard)/actions";

const ROLE_LABELS: Record<string, string> = {
  owner: "Dono",
  subadmin: "Subadmin"
};

export default async function AccountSettingsPage() {
  const session = await requireSession();
  const { hasToken } = await getGithubStatus(session.discordUserId);
  const { items } = await getBotParameters(session.discordUserId);
  const canEdit = session.role === "owner";
  const selfUpdateEnabled = items.find((item) => item.key === "self_update_auto_enabled")?.value === "true";

  async function saveSelfUpdateAction(formData: FormData) {
    "use server";
    const enabled = formData.get("selfUpdateEnabled") === "on" ? "true" : "false";
    await saveBotParameterAction("self_update_auto_enabled", enabled);
    revalidatePath("/settings/account");
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-sm uppercase tracking-[0.14em] text-parchment-dim">Conta</h1>

      <Panel title="Sessão atual">
        <div className="flex flex-col gap-2 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-parchment-muted">Discord user ID</span>
            <span className="font-mono text-xs text-parchment">{session.discordUserId}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-parchment-muted">Papel</span>
            <span className="text-parchment">{ROLE_LABELS[session.role] ?? session.role}</span>
          </div>
        </div>
      </Panel>

      <Panel title="Token do GitHub">
        <GithubTokenForm hasToken={hasToken} canEdit={canEdit} />
      </Panel>

      <Panel title="Auto-update do Sebas">
        <form action={saveSelfUpdateAction} className="flex flex-col gap-3 p-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              name="selfUpdateEnabled"
              type="checkbox"
              defaultChecked={selfUpdateEnabled}
              disabled={!canEdit}
              className="accent-gold"
            />
            <span className="text-parchment-muted">
              Atualizar sozinho quando o repositório principal (sebas-bot) tiver commit novo
            </span>
          </label>
          <p className="text-xs text-parchment-dim">
            Desligado por padrão: só avisa na tela principal quando há atualização, você aplica manualmente. Ligado: puxa, builda e reinicia sozinho — acompanhe o progresso na tela principal.
          </p>
          {canEdit && (
            <div className="flex items-center gap-3">
              <button
                type="submit"
                className="w-fit rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gold-bright"
              >
                Salvar
              </button>
              <SelfUpdateTriggerButton />
            </div>
          )}
        </form>
      </Panel>
    </div>
  );
}
