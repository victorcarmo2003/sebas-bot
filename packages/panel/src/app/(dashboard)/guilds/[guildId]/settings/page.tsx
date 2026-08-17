import { revalidatePath } from "next/cache";
import { Panel } from "@/components/panel";
import { requireSession } from "@/lib/require-session";
import { getGuild, saveGuild } from "@/lib/worker-api";

export default async function GuildSettingsPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const session = await requireSession("guilds:view");
  const canEdit = session.role === "owner" || session.permissions.includes("guilds:edit");

  const config = await getGuild(session.discordUserId, guildId);

  async function saveAction(formData: FormData) {
    "use server";
    const activeSession = await requireSession("guilds:edit");
    const channelId = String(formData.get("channelId") ?? "").trim();
    if (!channelId) return;

    await saveGuild(activeSession.discordUserId, guildId, {
      channelId,
      mentionRoleId: config.mentionRoleId,
      mentionRoleEnabled: config.mentionRoleEnabled
    });
    revalidatePath(`/guilds/${guildId}`);
  }

  return (
    <Panel title="Configurações" className="max-w-md">
      <form action={saveAction} className="flex flex-col gap-4 p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-parchment-muted">Canal do Discord (ID)</span>
          <input
            name="channelId"
            defaultValue={config.channelId}
            disabled={!canEdit}
            required
            className="rounded-md border border-brass bg-panel-raised px-3 py-2 font-mono text-parchment disabled:opacity-50"
          />
        </label>

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
  );
}
