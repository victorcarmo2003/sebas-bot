import { Panel } from "@/components/panel";
import { requireSession } from "@/lib/require-session";
import { getGuild, listHistory } from "@/lib/worker-api";

export default async function GuildOverviewPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const session = await requireSession("guilds:view");
  const canViewHistory = session.role === "owner" || session.permissions.includes("history:view");

  const [config, history] = await Promise.all([
    getGuild(session.discordUserId, guildId),
    canViewHistory ? listHistory(session.discordUserId, { guildId }) : Promise.resolve({ items: [], nextCursor: null })
  ]);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="rounded-lg border border-brass bg-panel p-4">
        <p className="text-[0.68rem] uppercase tracking-[0.12em] text-parchment-dim">Canal</p>
        <p className="mt-1 truncate font-mono text-sm text-parchment">{config.channelId}</p>
      </div>
      <div className="rounded-lg border border-brass bg-panel p-4">
        <p className="text-[0.68rem] uppercase tracking-[0.12em] text-parchment-dim">Menciona cargo</p>
        <p className="mt-1 text-sm text-parchment">
          {config.mentionRoleEnabled && config.mentionRoleId ? `Sim, <@&${config.mentionRoleId}>` : "Não"}
        </p>
      </div>
      <div className="rounded-lg border border-brass bg-panel p-4">
        <p className="text-[0.68rem] uppercase tracking-[0.12em] text-parchment-dim">Atualizado</p>
        <p className="mt-1 text-sm text-parchment">{new Date(config.updatedAt).toLocaleString("pt-BR")}</p>
      </div>

      {canViewHistory && (
        <Panel title="Últimos posts" className="sm:col-span-3">
          {history.items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-parchment-dim">Nenhum changelog postado ainda.</p>
          ) : (
            <div className="flex flex-col divide-y divide-brass-soft">
              {history.items.slice(0, 5).map((row) => (
                <div key={row.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${row.status === "fallback" ? "bg-amber" : "bg-gold"}`} />
                  <span className="flex-1 truncate text-parchment">{row.title}</span>
                  <span className="shrink-0 text-xs text-parchment-dim">{new Date(row.postedAt).toLocaleString("pt-BR")}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
