import Link from "next/link";
import { Panel } from "@/components/panel";
import { requireSession } from "@/lib/require-session";
import { listModules } from "@/lib/worker-api";
import { installModuleAction } from "./actions";

const STATE_LABELS: Record<string, string> = {
  enabled: "Habilitado",
  disabled: "Desabilitado",
  installed: "Instalado",
  pending_review: "Aguardando revisão",
  update_pending_approval: "Atualização pendente",
  validating: "Validando",
  validation_failed: "Falha na validação",
  update_failed: "Falha na atualização"
};

const STATE_DOT: Record<string, string> = {
  enabled: "bg-moss",
  pending_review: "bg-amber",
  update_pending_approval: "bg-amber",
  installed: "bg-parchment-dim",
  disabled: "bg-parchment-dim",
  validating: "bg-amber",
  validation_failed: "bg-wine",
  update_failed: "bg-wine"
};

export default async function ModulesPage({ searchParams }: { searchParams: Promise<{ installError?: string }> }) {
  const session = await requireSession("modules:manage");
  const { installError } = await searchParams;
  const { items } = await listModules(session.discordUserId);
  const isOwner = session.role === "owner";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-sm uppercase tracking-[0.14em] text-parchment-dim">
          Módulos <span className="text-parchment-dim">· {items.length}</span>
        </h1>
        {isOwner && (
          <Link
            href="/modules/marketplace"
            className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gold-bright"
          >
            Explorar marketplace
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((module) => (
          <Link
            key={module.id}
            href={`/modules/${module.id}`}
            className="flex flex-col gap-3 rounded-lg border border-brass bg-panel p-5 transition-colors hover:border-gold-dim"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[0.68rem] uppercase tracking-[0.12em] text-parchment-dim">
                  Módulo {module.source === "git" && <span className="text-gold-dim">· git</span>}
                </p>
                <p className="mt-0.5 font-display text-lg text-parchment">{module.displayName}</p>
              </div>
              <span className="flex items-center gap-1.5 rounded-full border border-brass px-2.5 py-1 text-xs">
                <span className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[module.state] ?? "bg-parchment-dim"}`} />
                <span className="text-parchment-dim">{STATE_LABELS[module.state] ?? module.state}</span>
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-brass-soft pt-3">
              <p className="font-mono text-xs text-parchment-dim">{module.id}</p>
              <span className="text-xs text-gold">Ver →</span>
            </div>
          </Link>
        ))}
      </div>

      {isOwner && (
        <Panel title="Instalar por URL (repositórios privados ou fora da busca)">
          <form action={installModuleAction} className="flex flex-col gap-3 p-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-parchment-muted">URL do repositório (https, precisa conter sebas.module.json)</span>
              <input
                name="repoUrl"
                required
                placeholder="https://github.com/usuario/meu-modulo-sebas"
                className="rounded-md border border-brass bg-panel-raised px-3 py-2 font-mono text-xs text-parchment"
              />
            </label>
            {installError && (
              <p className="rounded-md border border-wine bg-panel-raised px-3 py-2 text-xs text-wine">{installError}</p>
            )}
            <button
              type="submit"
              className="w-fit rounded-md border border-brass px-4 py-2 text-sm text-parchment-muted hover:bg-panel-raised"
            >
              Clonar e validar
            </button>
          </form>
        </Panel>
      )}
    </div>
  );
}
