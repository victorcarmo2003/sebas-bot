import { revalidatePath } from "next/cache";
import { Panel } from "@/components/panel";
import { requireSession } from "@/lib/require-session";
import { getBotParameters } from "@/lib/worker-api";
import { saveBotParameterAction } from "@/app/(dashboard)/actions";

const DEFAULT_COOLDOWN_HOURS = 24;

export default async function ParametersSettingsPage() {
  const session = await requireSession();
  const { items } = await getBotParameters(session.discordUserId);
  const canEdit = session.role === "owner";

  const values = new Map(items.map((item) => [item.key, item.value ?? ""]));

  async function saveAction(formData: FormData) {
    "use server";
    const personaOverride = String(formData.get("personaOverride") ?? "").trim();
    const defaultTemperature = String(formData.get("defaultTemperature") ?? "").trim();
    const defaultMaxTokens = String(formData.get("defaultMaxTokens") ?? "").trim();
    const rateLimitCooldownHours = String(formData.get("rateLimitCooldownHours") ?? "").trim();

    await Promise.all([
      saveBotParameterAction("persona_override", personaOverride),
      saveBotParameterAction("default_temperature", defaultTemperature),
      saveBotParameterAction("default_max_tokens", defaultMaxTokens),
      saveBotParameterAction("rate_limit_cooldown_hours", rateLimitCooldownHours)
    ]);
    revalidatePath("/settings/parameters");
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-sm uppercase tracking-[0.14em] text-parchment-dim">Parâmetros</h1>

      <Panel title="Comportamento geral do bot">
        <form action={saveAction} className="flex flex-col gap-4 p-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-parchment-muted">Persona / system prompt override</span>
            <textarea
              name="personaOverride"
              defaultValue={values.get("persona_override") ?? ""}
              disabled={!canEdit}
              rows={5}
              placeholder="Deixe em branco para usar a persona padrão do Sebas."
              className="rounded-md border border-brass bg-panel-raised px-3 py-2 text-sm text-parchment disabled:opacity-50"
            />
          </label>

          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-parchment-muted">Temperature padrão</span>
              <input
                name="defaultTemperature"
                type="number"
                step={0.1}
                min={0}
                max={2}
                defaultValue={values.get("default_temperature") ?? ""}
                disabled={!canEdit}
                placeholder="0.7"
                className="w-32 rounded-md border border-brass bg-panel-raised px-3 py-2 text-parchment disabled:opacity-50"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-parchment-muted">Max tokens padrão</span>
              <input
                name="defaultMaxTokens"
                type="number"
                min={1}
                defaultValue={values.get("default_max_tokens") ?? ""}
                disabled={!canEdit}
                placeholder="1024"
                className="w-32 rounded-md border border-brass bg-panel-raised px-3 py-2 text-parchment disabled:opacity-50"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-parchment-muted">Cooldown de rate limit (horas)</span>
              <input
                name="rateLimitCooldownHours"
                type="number"
                min={1}
                defaultValue={values.get("rate_limit_cooldown_hours") ?? ""}
                disabled={!canEdit}
                placeholder={String(DEFAULT_COOLDOWN_HOURS)}
                className="w-32 rounded-md border border-brass bg-panel-raised px-3 py-2 text-parchment disabled:opacity-50"
              />
            </label>
          </div>

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
