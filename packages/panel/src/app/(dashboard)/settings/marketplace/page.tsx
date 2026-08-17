import { revalidatePath } from "next/cache";
import { Panel } from "@/components/panel";
import { requireSession } from "@/lib/require-session";
import { getBotParameters } from "@/lib/worker-api";
import { saveBotParameterAction } from "@/app/(dashboard)/actions";

const DEFAULT_POLL_INTERVAL_MINUTES = 60;

export default async function MarketplaceSettingsPage() {
  const session = await requireSession();
  const { items } = await getBotParameters(session.discordUserId);
  const canEdit = session.role === "owner";

  const values = new Map(items.map((item) => [item.key, item.value ?? ""]));

  async function saveAction(formData: FormData) {
    "use server";
    const pollIntervalMinutes = String(formData.get("pollIntervalMinutes") ?? "").trim();
    const autoUpdateEnabled = formData.get("autoUpdateEnabled") === "on" ? "true" : "false";

    await Promise.all([
      saveBotParameterAction("marketplace_poll_interval_minutes", pollIntervalMinutes),
      saveBotParameterAction("marketplace_auto_update_enabled", autoUpdateEnabled)
    ]);
    revalidatePath("/settings/marketplace");
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-sm uppercase tracking-[0.14em] text-parchment-dim">Marketplace</h1>

      <Panel title="Verificação de atualizações">
        <form action={saveAction} className="flex flex-col gap-4 p-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-parchment-muted">Intervalo de verificação (minutos)</span>
            <input
              name="pollIntervalMinutes"
              type="number"
              min={5}
              defaultValue={values.get("marketplace_poll_interval_minutes") ?? ""}
              disabled={!canEdit}
              placeholder={String(DEFAULT_POLL_INTERVAL_MINUTES)}
              className="w-32 rounded-md border border-brass bg-panel-raised px-3 py-2 text-parchment disabled:opacity-50"
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              name="autoUpdateEnabled"
              type="checkbox"
              defaultChecked={values.get("marketplace_auto_update_enabled") === "true"}
              disabled={!canEdit}
              className="accent-gold"
            />
            <span className="text-parchment-muted">Atualização automática (aplica sozinho quando o repositório de um módulo instalado tem commit novo)</span>
          </label>
          <p className="text-xs text-parchment-dim">
            Desligado por padrão: quando desativado, uma pendência avisa no painel/DM e você aplica manualmente na página do módulo.
          </p>

          {canEdit && (
            <button
              type="submit"
              className="w-fit rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gold-bright"
            >
              Salvar
            </button>
          )}
        </form>
      </Panel>
    </div>
  );
}
