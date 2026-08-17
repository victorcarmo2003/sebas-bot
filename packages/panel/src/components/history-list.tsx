import type { HistoryRow } from "@/lib/worker-api";

const STATUS_LABEL: Record<string, string> = {
  posted: "Postado",
  fallback: "Postado (fallback)"
};

export function HistoryList({
  items,
  showGuildId,
  canRepost,
  repostAction
}: {
  items: HistoryRow[];
  showGuildId: boolean;
  canRepost: boolean;
  repostAction: (formData: FormData) => Promise<void>;
}) {
  if (items.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-parchment-dim">Nenhum changelog postado ainda.</p>;
  }

  return (
    <div className="flex flex-col divide-y divide-brass-soft">
      {items.map((row) => {
        const isFallback = row.status === "fallback";
        return (
          <div key={row.id} className="flex items-center gap-3 px-4 py-3 text-sm">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isFallback ? "bg-amber" : "bg-gold"}`} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-parchment">{row.title}</p>
              <p className="mt-0.5 text-xs text-parchment-dim">
                {showGuildId && (
                  <>
                    guild <span className="font-mono">{row.guildId}</span> ·{" "}
                  </>
                )}
                {new Date(row.postedAt).toLocaleString("pt-BR")}
              </p>
            </div>
            <span
              className={
                isFallback
                  ? "shrink-0 rounded-full bg-amber-deep px-2 py-0.5 text-xs text-amber"
                  : "shrink-0 rounded-full bg-moss-deep px-2 py-0.5 text-xs text-moss"
              }
            >
              {STATUS_LABEL[row.status] ?? row.status}
            </span>
            {canRepost && row.versionNumber && (
              <form action={repostAction}>
                <input type="hidden" name="id" value={row.id} />
                <button type="submit" className="shrink-0 text-xs text-gold hover:text-gold-bright hover:underline">
                  Reprocessar
                </button>
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}
