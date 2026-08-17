import Link from "next/link";
import { Panel } from "@/components/panel";
import { requireSession } from "@/lib/require-session";
import { listLogs } from "@/lib/worker-api";

const LEVELS = ["error", "warn", "info"] as const;

const LEVEL_TONE: Record<string, string> = {
  error: "text-wine",
  warn: "text-amber",
  info: "text-parchment-dim"
};

function buildHref(level?: string, context?: string): string {
  const params = new URLSearchParams();
  if (level) params.set("level", level);
  if (context) params.set("context", context);
  const query = params.toString();
  return `/logs${query ? `?${query}` : ""}`;
}

export default async function LogsPage({
  searchParams
}: {
  searchParams: Promise<{ cursor?: string; level?: string; context?: string }>;
}) {
  const { cursor, level, context } = await searchParams;
  const session = await requireSession("logs:view");

  const page = await listLogs(session.discordUserId, {
    cursor: cursor ? Number(cursor) : undefined,
    level,
    context
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-sm uppercase tracking-[0.14em] text-parchment-dim">Logs de execução</h1>

        <div className="flex items-center gap-1.5">
          <LevelPill href={buildHref(undefined, context)} active={!level} label="Todos" />
          {LEVELS.map((lvl) => (
            <LevelPill key={lvl} href={buildHref(lvl, context)} active={level === lvl} label={lvl} tone={LEVEL_TONE[lvl]} />
          ))}
        </div>
      </div>

      <form className="flex gap-2 text-sm">
        {level && <input type="hidden" name="level" value={level} />}
        <input
          name="context"
          placeholder="filtrar por contexto (ex: scheduled-poll)"
          defaultValue={context ?? ""}
          className="flex-1 rounded-md border border-brass bg-panel px-3 py-1.5 font-mono text-xs text-parchment"
        />
        <button type="submit" className="rounded-md border border-brass px-3 py-1.5 text-xs text-parchment-muted hover:bg-panel-raised">
          Filtrar
        </button>
      </form>

      <Panel title={`${page.items.length} registro(s)`}>
        {page.items.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-parchment-dim">Nenhum log encontrado.</p>
        ) : (
          <div className="flex flex-col divide-y divide-brass-soft font-mono text-xs">
            {page.items.map((log) => (
              <div key={log.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`uppercase ${LEVEL_TONE[log.level] ?? "text-parchment-dim"}`}>[{log.level}]</span>
                  <span className="text-parchment-dim">{log.context}</span>
                  <span className="text-parchment-dim">{new Date(log.createdAt).toLocaleString("pt-BR")}</span>
                  {log.guildId && <span className="text-parchment-dim">guild:{log.guildId}</span>}
                </div>
                <p className="mt-1 font-sans text-sm text-parchment">{log.message}</p>
                {log.meta ? (
                  <pre className="mt-2 overflow-x-auto rounded bg-ink p-2 text-parchment-muted">
                    {JSON.stringify(log.meta, null, 2)}
                  </pre>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Panel>

      {page.nextCursor !== null && (
        <Link
          href={`/logs?cursor=${page.nextCursor}${level ? `&level=${level}` : ""}${context ? `&context=${context}` : ""}`}
          className="w-fit text-sm text-gold hover:text-gold-bright hover:underline"
        >
          Próxima página →
        </Link>
      )}
    </div>
  );
}

function LevelPill({ href, active, label, tone }: { href: string; active: boolean; label: string; tone?: string }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-xs uppercase tracking-wide transition-colors ${
        active
          ? "border-gold-dim bg-panel-raised text-parchment"
          : `border-brass text-parchment-dim hover:bg-panel-raised ${tone ?? ""}`
      }`}
    >
      {label}
    </Link>
  );
}
