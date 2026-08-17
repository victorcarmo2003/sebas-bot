import Link from "next/link";
import { Panel } from "@/components/panel";
import { requireSession } from "@/lib/require-session";
import { discoverModules } from "@/lib/worker-api";
import { installModuleAction } from "../actions";

export default async function ModuleMarketplacePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await requireSession("modules:manage");
  if (session.role !== "owner") {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/modules" className="text-sm text-parchment-dim hover:text-parchment">
          ← Módulos
        </Link>
        <p className="text-sm text-parchment-dim">Só o dono pode instalar módulos novos.</p>
      </div>
    );
  }

  const { q } = await searchParams;
  const query = q ?? "";
  const result = await discoverModules(session.discordUserId, query);

  return (
    <div className="flex flex-col gap-4">
      <Link href="/modules" className="text-sm text-parchment-dim hover:text-parchment">
        ← Módulos
      </Link>

      <h1 className="text-sm uppercase tracking-[0.14em] text-parchment-dim">Marketplace</h1>

      <Panel title="Buscar no GitHub">
        <form action="/modules/marketplace" className="flex gap-3 p-4">
          <input
            name="q"
            defaultValue={query}
            placeholder="palavra-chave (opcional) — busca sebas.module.json em repositórios públicos"
            className="flex-1 rounded-md border border-brass bg-panel-raised px-3 py-2 text-sm text-parchment"
          />
          <button
            type="submit"
            className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gold-bright"
          >
            Buscar
          </button>
        </form>
      </Panel>

      {!result.ok && (
        <p className="rounded-md border border-wine bg-panel-raised px-3 py-2 text-xs text-wine">{result.error}</p>
      )}

      {result.ok && result.items.length === 0 && (
        <p className="rounded-lg border border-brass bg-panel px-4 py-6 text-center text-sm text-parchment-dim">
          Nenhum módulo encontrado{query ? ` para "${query}"` : ""} ainda. O ecossistema Sebas é novo — repositórios com
          sebas.module.json aparecem aqui assim que forem publicados no GitHub.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {result.items.map((item) => (
          <div key={item.repoFullName} className="flex flex-col gap-3 rounded-lg border border-brass bg-panel p-5">
            <div>
              <p className="text-[0.68rem] uppercase tracking-[0.12em] text-parchment-dim">Repositório</p>
              <p className="mt-0.5 font-display text-lg text-parchment">{item.repoFullName}</p>
            </div>
            <a
              href={item.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs text-parchment-dim hover:text-parchment hover:underline"
            >
              ver sebas.module.json ↗
            </a>
            <div className="border-t border-brass-soft pt-3">
              {item.alreadyInstalled ? (
                <span className="text-xs text-parchment-dim">Já instalado</span>
              ) : (
                <form action={installModuleAction}>
                  <input type="hidden" name="repoUrl" value={item.repoUrl} />
                  <button
                    type="submit"
                    className="w-fit rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gold-bright"
                  >
                    Clonar e validar
                  </button>
                </form>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
