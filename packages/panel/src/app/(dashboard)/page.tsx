import Link from "next/link";
import { NotificationsPanel } from "@/components/notifications-panel";
import { Panel } from "@/components/panel";
import { requireSession } from "@/lib/require-session";
import {
  listAdmins,
  listGuilds,
  listHistory,
  listLogs,
  listNotifications,
  type HistoryRow,
  type LogRow
} from "@/lib/worker-api";

async function getHealth(): Promise<boolean> {
  const url = process.env.SEBAS_CORE_API_URL;
  if (!url) return false;
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/health`, { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

type TimelineEvent =
  | { kind: "post"; at: string; row: HistoryRow }
  | { kind: "log"; at: string; row: LogRow };

const DAY_MS = 24 * 60 * 60 * 1000;

// Fora do componente pra nao violar a regra de pureza de render (Date.now() e' impuro
// dentro de um Component/Hook segundo o eslint-plugin-react-hooks novo).
function countErrorsInLastDay(logs: LogRow[]): number {
  const now = Date.now();
  return logs.filter((row) => row.level === "error" && now - new Date(row.createdAt).getTime() < DAY_MS).length;
}

export default async function DashboardPage() {
  const session = await requireSession();
  const isOwner = session.role === "owner";
  const canViewGuilds = isOwner || session.permissions.includes("guilds:view");
  const canViewHistory = isOwner || session.permissions.includes("history:view");
  const canViewLogs = isOwner || session.permissions.includes("logs:view");
  const canViewAdmins = isOwner || session.permissions.includes("admins:manage");

  const [healthy, guilds, history, logs, notifications, admins] = await Promise.all([
    getHealth(),
    canViewGuilds ? listGuilds(session.discordUserId) : Promise.resolve({ items: [] }),
    canViewHistory ? listHistory(session.discordUserId) : Promise.resolve({ items: [], nextCursor: null }),
    canViewLogs ? listLogs(session.discordUserId, {}) : Promise.resolve({ items: [], nextCursor: null }),
    listNotifications(session.discordUserId),
    canViewAdmins ? listAdmins(session.discordUserId) : Promise.resolve({ items: [] })
  ]);

  const pendingCount = notifications.items.length;
  const errorsLast24h = countErrorsInLastDay(logs.items);

  const timeline: TimelineEvent[] = [
    ...history.items.map((row): TimelineEvent => ({ kind: "post", at: row.postedAt, row })),
    ...logs.items
      .filter((row) => row.level !== "info")
      .map((row): TimelineEvent => ({ kind: "log", at: row.createdAt, row }))
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 8);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-brass bg-panel px-4 py-2.5 text-sm">
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${healthy ? "bg-moss" : "bg-wine"}`} />
          <span className="text-parchment">{healthy ? "Bot online" : "Bot offline"}</span>
        </span>
        <span className="text-parchment-dim">
          {pendingCount > 0
            ? `${pendingCount} ${pendingCount === 1 ? "pendência" : "pendências"} exigem atenção`
            : "Nenhuma pendência"}
        </span>
      </div>

      <NotificationsPanel items={notifications.items} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {canViewGuilds && <MetricCard label="Guilds" value={guilds.items.length} href="/guilds" />}
        {canViewHistory && <MetricCard label="Posts" value={history.items.length} href="/history" />}
        {canViewLogs && (
          <MetricCard label="Erros 24h" value={errorsLast24h} href="/logs" tone={errorsLast24h > 0 ? "bad" : undefined} />
        )}
        {canViewAdmins && <MetricCard label="Admins" value={admins.items.length} href="/admins" />}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Panel title="Atividade recente" className="lg:col-span-2">
          {timeline.length === 0 ? (
            <p className="px-4 py-6 text-sm text-parchment-dim">Nada por aqui ainda.</p>
          ) : (
            <div className="flex flex-col divide-y divide-brass-soft">
              {timeline.map((event) => (
                <TimelineRow key={`${event.kind}-${event.row.id}`} event={event} />
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Atalhos">
          <div className="flex flex-col divide-y divide-brass-soft">
            {canViewGuilds && <ShortcutRow href="/guilds" label="Ver guilds" />}
            {canViewHistory && <ShortcutRow href="/history" label="Ver histórico" />}
            {canViewLogs && <ShortcutRow href="/logs" label="Ver logs" />}
            {isOwner && <ShortcutRow href="/modules" label="Ver módulos" />}
            {canViewAdmins && <ShortcutRow href="/admins" label="Gerenciar admins" />}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  href,
  tone
}: {
  label: string;
  value: number;
  href: string;
  tone?: "bad";
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-lg border border-brass bg-panel px-4 py-3 transition-colors hover:border-gold-dim"
    >
      <span className="text-[0.68rem] uppercase tracking-[0.12em] text-parchment-dim">{label}</span>
      <span className={`font-display text-2xl ${tone === "bad" ? "text-wine" : "text-parchment"}`}>{value}</span>
    </Link>
  );
}

function ShortcutRow({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="flex items-center justify-between px-4 py-2.5 text-sm text-parchment-muted transition-colors hover:bg-panel-raised hover:text-parchment">
      {label}
      <span className="text-gold">→</span>
    </Link>
  );
}

function TimelineRow({ event }: { event: TimelineEvent }) {
  if (event.kind === "post") {
    const row = event.row;
    const isFallback = row.status === "fallback";
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isFallback ? "bg-amber" : "bg-gold"}`} />
        <span className="flex-1 truncate text-parchment">{row.title}</span>
        <span className="shrink-0 text-xs text-parchment-dim">{new Date(row.postedAt).toLocaleString("pt-BR")}</span>
      </div>
    );
  }

  const row = event.row;
  const isError = row.level === "error";
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isError ? "bg-wine" : "bg-amber"}`} />
      <span className="flex-1 truncate text-parchment">{row.message}</span>
      <span className="shrink-0 text-xs text-parchment-dim">{new Date(row.createdAt).toLocaleString("pt-BR")}</span>
    </div>
  );
}
