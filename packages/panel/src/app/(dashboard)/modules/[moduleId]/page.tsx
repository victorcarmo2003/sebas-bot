import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Panel } from "@/components/panel";
import { requireSession } from "@/lib/require-session";
import {
  approveModule,
  disableModule,
  enableModule,
  getChangelogModuleSettings,
  getModuleDetail,
  rejectModule,
  saveChangelogModuleSettings,
  uninstallModule,
  type PermissionDiffItem
} from "@/lib/worker-api";

const DEFAULT_RSS_URL = "https://robloxapi.github.io/ref/updates/index.xml";
const DEFAULT_MAX_ITEMS = 3;

const GRANT_LABELS: Record<PermissionDiffItem["grantType"], string> = {
  adminScope: "Escopo de admin",
  providesScope: "Escopo fornecido",
  networkDomain: "Domínio de rede",
  storage: "Armazenamento",
  discordPermission: "Permissão do Discord",
  aiProviderDependency: "Depende de provedor de IA"
};

const STATE_LABELS: Record<string, string> = {
  enabled: "Habilitado",
  disabled: "Desabilitado",
  installed: "Instalado, aguardando habilitar",
  pending_review: "Aguardando revisão do dono",
  update_pending_approval: "Atualização aguardando revisão",
  validating: "Validando",
  validation_failed: "Falha na validação"
};

export default async function ModuleDetailPage({ params }: { params: Promise<{ moduleId: string }> }) {
  const { moduleId } = await params;
  const session = await requireSession("modules:manage");

  if (moduleId === "changelog-roblox") {
    return <ChangelogRobloxSettings discordUserId={session.discordUserId} canEdit={session.role === "owner" || session.permissions.includes("sources:manage")} />;
  }

  const module = await getModuleDetail(session.discordUserId, moduleId);
  const isOwner = session.role === "owner";
  const isPendingReview = module.state === "pending_review" || module.state === "update_pending_approval";

  async function approveAction() {
    "use server";
    const activeSession = await requireSession("modules:manage");
    if (activeSession.role !== "owner") return;
    await approveModule(activeSession.discordUserId, moduleId);
    revalidatePath(`/modules/${moduleId}`);
  }

  async function rejectAction() {
    "use server";
    const activeSession = await requireSession("modules:manage");
    if (activeSession.role !== "owner") return;
    await rejectModule(activeSession.discordUserId, moduleId);
    redirect("/modules");
  }

  async function enableAction() {
    "use server";
    const activeSession = await requireSession("modules:manage");
    await enableModule(activeSession.discordUserId, moduleId);
    revalidatePath(`/modules/${moduleId}`);
  }

  async function disableAction() {
    "use server";
    const activeSession = await requireSession("modules:manage");
    await disableModule(activeSession.discordUserId, moduleId);
    revalidatePath(`/modules/${moduleId}`);
  }

  async function uninstallAction() {
    "use server";
    const activeSession = await requireSession("modules:manage");
    if (activeSession.role !== "owner") return;
    await uninstallModule(activeSession.discordUserId, moduleId);
    redirect("/modules");
  }

  return (
    <div className="flex flex-col gap-4">
      <Link href="/modules" className="text-sm text-parchment-dim hover:text-parchment">
        ← Módulos
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl text-parchment">{module.manifest.name}</h1>
          <p className="mt-1 font-mono text-xs text-parchment-dim">
            {module.id} · v{module.installedVersion} · sha {module.pinnedSha.slice(0, 7)}
          </p>
        </div>
        <span className="rounded-full border border-brass px-3 py-1 text-xs text-parchment-dim">
          {STATE_LABELS[module.state] ?? module.state}
        </span>
      </div>

      {module.lastError && (
        <p className="rounded-md border border-wine bg-panel-raised px-3 py-2 text-xs text-wine">{module.lastError}</p>
      )}

      <Panel title="Manifesto">
        <div className="flex flex-col gap-3 p-4 text-sm">
          {module.manifest.description && <p className="text-parchment-muted">{module.manifest.description}</p>}
          <p className="font-mono text-xs text-parchment-dim">{module.repoUrl}</p>
          <div className="flex flex-wrap gap-2">
            {module.manifest.capabilities.map((cap) => (
              <span key={cap} className="rounded-full border border-brass-soft px-2.5 py-0.5 text-xs text-parchment-dim">
                {cap}
              </span>
            ))}
          </div>
        </div>
      </Panel>

      {isPendingReview ? (
        <Panel title="Permissões solicitadas">
          <div className="flex flex-col gap-3 p-4">
            {module.pendingPermissionDiff.length === 0 ? (
              <p className="text-sm text-parchment-dim">Este módulo não pede nenhuma permissão especial.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {module.pendingPermissionDiff.map((item, index) => (
                  <li key={index} className="flex items-center gap-2 text-sm">
                    <span className="rounded-full border border-gold-dim px-2 py-0.5 text-[0.68rem] text-gold">
                      {GRANT_LABELS[item.grantType]}
                    </span>
                    <span className="font-mono text-xs text-parchment-muted">{item.grantValue}</span>
                  </li>
                ))}
              </ul>
            )}

            {isOwner ? (
              <div className="flex gap-3 border-t border-brass-soft pt-3">
                <form action={approveAction}>
                  <button
                    type="submit"
                    className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gold-bright"
                  >
                    Aprovar e instalar
                  </button>
                </form>
                <form action={rejectAction}>
                  <button type="submit" className="rounded-md border border-wine px-4 py-2 text-sm text-wine hover:bg-panel-raised">
                    Rejeitar
                  </button>
                </form>
              </div>
            ) : (
              <p className="border-t border-brass-soft pt-3 text-xs text-parchment-dim">Só o dono pode aprovar ou rejeitar módulos.</p>
            )}
          </div>
        </Panel>
      ) : (
        <>
          <Panel title="Permissões concedidas">
            <div className="p-4">
              {module.grants.length === 0 ? (
                <p className="text-sm text-parchment-dim">Nenhuma permissão concedida.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {module.grants.map((grant) => (
                    <li key={grant.id} className="flex items-center gap-2 text-sm">
                      <span className="rounded-full border border-brass-soft px-2 py-0.5 text-[0.68rem] text-parchment-dim">
                        {GRANT_LABELS[grant.grantType]}
                      </span>
                      <span className="font-mono text-xs text-parchment-muted">{grant.grantValue}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>

          <div className="flex gap-3">
            {module.state === "enabled" ? (
              <form action={disableAction}>
                <button type="submit" className="rounded-md border border-brass px-4 py-2 text-sm text-parchment-muted hover:bg-panel-raised">
                  Desabilitar
                </button>
              </form>
            ) : (
              <form action={enableAction}>
                <button
                  type="submit"
                  className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gold-bright"
                >
                  Habilitar
                </button>
              </form>
            )}
            {isOwner && module.state !== "enabled" && (
              <form action={uninstallAction}>
                <button type="submit" className="rounded-md border border-wine px-4 py-2 text-sm text-wine hover:bg-panel-raised">
                  Desinstalar
                </button>
              </form>
            )}
          </div>
        </>
      )}

      <Panel title="Eventos recentes">
        <ul className="divide-y divide-brass-soft">
          {module.events.length === 0 && <li className="px-4 py-3 text-sm text-parchment-dim">Nenhum evento ainda.</li>}
          {module.events.map((event) => (
            <li key={event.id} className="flex items-center justify-between px-4 py-2 text-xs">
              <span className="font-mono text-parchment-muted">{event.eventType}</span>
              <span className="text-parchment-dim">{new Date(event.createdAt).toLocaleString("pt-BR")}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

async function ChangelogRobloxSettings({ discordUserId, canEdit }: { discordUserId: string; canEdit: boolean }) {
  const [settings, detail] = await Promise.all([
    getChangelogModuleSettings(discordUserId),
    getModuleDetail(discordUserId, "changelog-roblox")
  ]);
  const isEnabled = detail.state === "enabled";

  async function saveAction(formData: FormData) {
    "use server";
    const activeSession = await requireSession("sources:manage");
    const rssUrl = String(formData.get("rssUrl") ?? "").trim();
    const maxItemsRaw = String(formData.get("maxItemsPerPoll") ?? "").trim();
    const maxItemsPerPoll = maxItemsRaw ? Number.parseInt(maxItemsRaw, 10) : null;

    await saveChangelogModuleSettings(activeSession.discordUserId, {
      rssUrl: rssUrl || null,
      maxItemsPerPoll: maxItemsPerPoll && Number.isFinite(maxItemsPerPoll) ? maxItemsPerPoll : null
    });
    revalidatePath("/modules/changelog-roblox");
  }

  async function toggleAction() {
    "use server";
    const activeSession = await requireSession("modules:manage");
    if (isEnabled) {
      await disableModule(activeSession.discordUserId, "changelog-roblox");
    } else {
      await enableModule(activeSession.discordUserId, "changelog-roblox");
    }
    revalidatePath("/modules/changelog-roblox");
  }

  return (
    <div className="flex flex-col gap-4">
      <Link href="/modules" className="text-sm text-parchment-dim hover:text-parchment">
        ← Módulos
      </Link>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${isEnabled ? "bg-moss" : "bg-parchment-dim"}`} />
          <span className="text-sm text-parchment-muted">{isEnabled ? "Habilitado" : "Desabilitado"}</span>
        </div>
        <form action={toggleAction}>
          <button
            type="submit"
            className={
              isEnabled
                ? "rounded-md border border-brass px-4 py-2 text-sm text-parchment-muted hover:bg-panel-raised"
                : "rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gold-bright"
            }
          >
            {isEnabled ? "Desabilitar" : "Habilitar"}
          </button>
        </form>
      </div>

      <Panel title="Changelog do Roblox — configurações" className="max-w-md">
        <form action={saveAction} className="flex flex-col gap-4 p-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-parchment-muted">URL do feed RSS</span>
            <input
              name="rssUrl"
              defaultValue={settings.rssUrl ?? ""}
              disabled={!canEdit}
              placeholder={DEFAULT_RSS_URL}
              className="rounded-md border border-brass bg-panel-raised px-3 py-2 font-mono text-xs text-parchment disabled:opacity-50"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-parchment-muted">Máximo de itens por checagem</span>
            <input
              name="maxItemsPerPoll"
              type="number"
              min={1}
              defaultValue={settings.maxItemsPerPoll ?? ""}
              disabled={!canEdit}
              placeholder={String(DEFAULT_MAX_ITEMS)}
              className="w-32 rounded-md border border-brass bg-panel-raised px-3 py-2 text-parchment disabled:opacity-50"
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
    </div>
  );
}
