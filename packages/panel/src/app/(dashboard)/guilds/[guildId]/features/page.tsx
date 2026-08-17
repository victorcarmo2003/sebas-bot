import { revalidatePath } from "next/cache";
import { Panel } from "@/components/panel";
import { requireSession } from "@/lib/require-session";
import { getGuild, saveGuild } from "@/lib/worker-api";

export default async function GuildFeaturesPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const session = await requireSession("guilds:view");
  const canEdit = session.role === "owner" || session.permissions.includes("guilds:edit");

  const config = await getGuild(session.discordUserId, guildId);

  async function saveAction(formData: FormData) {
    "use server";
    const activeSession = await requireSession("guilds:edit");
    const mentionRoleId = String(formData.get("mentionRoleId") ?? "").trim();
    const mentionRoleEnabled = formData.get("mentionRoleEnabled") === "on";

    await saveGuild(activeSession.discordUserId, guildId, {
      channelId: config.channelId,
      mentionRoleId: mentionRoleId || null,
      mentionRoleEnabled
    });
    revalidatePath(`/guilds/${guildId}`);
  }

  return (
    <Panel title="Changelog do Roblox" className="max-w-md">
      <form action={saveAction} className="flex flex-col gap-4 p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-parchment-muted">Cargo a mencionar (ID)</span>
          <input
            name="mentionRoleId"
            defaultValue={config.mentionRoleId ?? ""}
            disabled={!canEdit}
            placeholder="Opcional — deixe vazio para não mencionar ninguém"
            className="rounded-md border border-brass bg-panel-raised px-3 py-2 font-mono text-parchment disabled:opacity-50"
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-parchment-muted">
          <input
            type="checkbox"
            name="mentionRoleEnabled"
            defaultChecked={config.mentionRoleEnabled}
            disabled={!canEdit}
            className="rounded border-brass bg-panel-raised accent-gold"
          />
          Mencionar esse cargo em cada post
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
