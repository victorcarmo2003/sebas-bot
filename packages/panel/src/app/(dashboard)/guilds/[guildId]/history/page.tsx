import Link from "next/link";
import { revalidatePath } from "next/cache";
import { HistoryList } from "@/components/history-list";
import { Panel } from "@/components/panel";
import { requireSession } from "@/lib/require-session";
import { listHistory, repostHistoryItem } from "@/lib/worker-api";

export default async function GuildHistoryPage({
  params,
  searchParams
}: {
  params: Promise<{ guildId: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { guildId } = await params;
  const { cursor } = await searchParams;
  const session = await requireSession("history:view");
  const canRepost = session.role === "owner" || session.permissions.includes("guilds:edit");

  const page = await listHistory(session.discordUserId, {
    guildId,
    cursor: cursor ? Number(cursor) : undefined
  });

  async function repostAction(formData: FormData) {
    "use server";
    const activeSession = await requireSession("history:view");
    if (activeSession.role !== "owner" && !activeSession.permissions.includes("guilds:edit")) return;
    const id = Number(formData.get("id"));
    if (!Number.isFinite(id)) return;
    await repostHistoryItem(activeSession.discordUserId, id);
    revalidatePath(`/guilds/${guildId}/history`);
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Changelogs postados">
        <HistoryList items={page.items} showGuildId={false} canRepost={canRepost} repostAction={repostAction} />
      </Panel>

      {page.nextCursor !== null && (
        <Link
          href={`/guilds/${guildId}/history?cursor=${page.nextCursor}`}
          className="w-fit text-sm text-gold hover:text-gold-bright hover:underline"
        >
          Próxima página →
        </Link>
      )}
    </div>
  );
}
