import Link from "next/link";
import { requireSession } from "@/lib/require-session";
import { listGuilds } from "@/lib/worker-api";

export default async function GuildsPage() {
  const session = await requireSession("guilds:view");
  const { items } = await listGuilds(session.discordUserId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-sm uppercase tracking-[0.14em] text-parchment-dim">
          Guilds <span className="text-parchment-dim">· {items.length}</span>
        </h1>
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-brass bg-panel px-4 py-6 text-center text-sm text-parchment-dim">
          Nenhuma guild configurada ainda.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((entry) => (
            <Link
              key={entry.guildId}
              href={`/guilds/${entry.guildId}`}
              className="flex flex-col gap-3 rounded-lg border border-brass bg-panel p-4 transition-colors hover:border-gold-dim"
            >
              <div>
                <p className="text-[0.68rem] uppercase tracking-[0.12em] text-parchment-dim">Guild</p>
                <p className="mt-0.5 truncate font-mono text-sm text-parchment">{entry.guildId}</p>
              </div>
              <div className="border-t border-brass-soft pt-3">
                <p className="text-[0.68rem] uppercase tracking-[0.12em] text-parchment-dim">Canal</p>
                <p className="mt-0.5 truncate font-mono text-sm text-parchment-muted">{entry.config.channelId}</p>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-parchment-dim">
                  Atualizado {new Date(entry.config.updatedAt).toLocaleDateString("pt-BR")}
                </span>
                <span className="text-gold">Editar →</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
