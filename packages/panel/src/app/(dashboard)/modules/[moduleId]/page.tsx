import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Panel } from "@/components/panel";
import { IdListEditor } from "@/components/id-list-editor";
import { ModuleUpdatePanel } from "@/components/module-update-panel";
import { requireSession } from "@/lib/require-session";
import {
  approveModule,
  disableModule,
  enableModule,
  getChangelogModuleSettings,
  getModuleDetail,
  getPermissionsModuleSettings,
  rejectModule,
  saveChangelogModuleSettings,
  savePermissionsModuleSettings,
  uninstallModule,
  type PermissionDiffItem,
  type PermissionMode,
  type PermissionsModuleSettings,
  type PermissionSurface,
  type PermissionSurfaceConfig
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

  if (moduleId === "permissions") {
    return <PermissionsSettings discordUserId={session.discordUserId} />;
  }

  const moduleDetail = await getModuleDetail(session.discordUserId, moduleId);
  const isOwner = session.role === "owner";
  const isPendingReview = moduleDetail.state === "pending_review" || moduleDetail.state === "update_pending_approval";

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
          <h1 className="font-display text-xl text-parchment">{moduleDetail.manifest.name}</h1>
          <p className="mt-1 font-mono text-xs text-parchment-dim">
            {moduleDetail.id} · v{moduleDetail.installedVersion} · sha {moduleDetail.pinnedSha.slice(0, 7)}
          </p>
        </div>
        <span className="rounded-full border border-brass px-3 py-1 text-xs text-parchment-dim">
          {STATE_LABELS[moduleDetail.state] ?? moduleDetail.state}
        </span>
      </div>

      {moduleDetail.lastError && (
        <p className="rounded-md border border-wine bg-panel-raised px-3 py-2 text-xs text-wine">{moduleDetail.lastError}</p>
      )}

      <Panel title="Manifesto">
        <div className="flex flex-col gap-3 p-4 text-sm">
          {moduleDetail.manifest.description && <p className="text-parchment-muted">{moduleDetail.manifest.description}</p>}
          <p className="font-mono text-xs text-parchment-dim">{moduleDetail.repoUrl}</p>
          <div className="flex flex-wrap gap-2">
            {moduleDetail.manifest.capabilities.map((cap) => (
              <span key={cap} className="rounded-full border border-brass-soft px-2.5 py-0.5 text-xs text-parchment-dim">
                {cap}
              </span>
            ))}
          </div>
          <ModuleUpdatePanel moduleId={moduleDetail.id} pinnedSha={moduleDetail.pinnedSha} canApply={isOwner} />
        </div>
      </Panel>

      {isPendingReview ? (
        <Panel title="Permissões solicitadas">
          <div className="flex flex-col gap-3 p-4">
            {moduleDetail.pendingPermissionDiff.length === 0 ? (
              <p className="text-sm text-parchment-dim">Este módulo não pede nenhuma permissão especial.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {moduleDetail.pendingPermissionDiff.map((item, index) => (
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
              {moduleDetail.grants.length === 0 ? (
                <p className="text-sm text-parchment-dim">Nenhuma permissão concedida.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {moduleDetail.grants.map((grant) => (
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
            {moduleDetail.state === "enabled" ? (
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
            {isOwner && moduleDetail.state !== "enabled" && (
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
          {moduleDetail.events.length === 0 && <li className="px-4 py-3 text-sm text-parchment-dim">Nenhum evento ainda.</li>}
          {moduleDetail.events.map((event) => (
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

const SURFACE_LABELS: Record<PermissionSurface, string> = {
  dm: "DM",
  mention: "Menção",
  action: "Ação"
};

const MODE_LABELS: Record<PermissionMode, string> = {
  everyone: "Todos podem",
  whitelist: "Somente lista (whitelist)",
  blacklist: "Todos, exceto a lista (blacklist)"
};

const EMPTY_SURFACE: PermissionSurfaceConfig = { mode: "everyone", userIds: [], roleIds: [] };
const EMPTY_PERMISSIONS_SETTINGS: PermissionsModuleSettings = {
  dm: EMPTY_SURFACE,
  mention: EMPTY_SURFACE,
  action: EMPTY_SURFACE,
  enabledTools: []
};

function parseIds(formData: FormData, name: string): string[] {
  return String(formData.get(name) ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

async function PermissionsSettings({ discordUserId }: { discordUserId: string }) {
  // O módulo "permissions" pode nao estar instalado ainda no core — cai pro shape vazio
  // (modo "everyone" em tudo) em vez de quebrar a pagina.
  const settings = await getPermissionsModuleSettings(discordUserId).catch(() => EMPTY_PERMISSIONS_SETTINGS);

  async function saveSurfaceAction(surface: PermissionSurface, formData: FormData) {
    "use server";
    const activeSession = await requireSession("modules:manage");
    const current = await getPermissionsModuleSettings(activeSession.discordUserId).catch(() => EMPTY_PERMISSIONS_SETTINGS);

    const mode = String(formData.get("mode") ?? "everyone") as PermissionMode;
    const nextSurface: PermissionSurfaceConfig = {
      mode,
      userIds: parseIds(formData, "userIds"),
      roleIds: parseIds(formData, "roleIds")
    };

    await savePermissionsModuleSettings(activeSession.discordUserId, { ...current, [surface]: nextSurface });
    revalidatePath("/modules/permissions");
  }

  async function saveDmAction(formData: FormData) {
    "use server";
    await saveSurfaceAction("dm", formData);
  }

  async function saveMentionAction(formData: FormData) {
    "use server";
    await saveSurfaceAction("mention", formData);
  }

  async function saveActionAction(formData: FormData) {
    "use server";
    await saveSurfaceAction("action", formData);
  }

  async function saveToolsAction(formData: FormData) {
    "use server";
    const activeSession = await requireSession("modules:manage");
    const current = await getPermissionsModuleSettings(activeSession.discordUserId).catch(() => EMPTY_PERMISSIONS_SETTINGS);
    const enabledTools = parseIds(formData, "enabledTools");

    await savePermissionsModuleSettings(activeSession.discordUserId, { ...current, enabledTools });
    revalidatePath("/modules/permissions");
  }

  const surfaceActions: Record<PermissionSurface, (formData: FormData) => Promise<void>> = {
    dm: saveDmAction,
    mention: saveMentionAction,
    action: saveActionAction
  };

  return (
    <div className="flex flex-col gap-4">
      <Link href="/modules" className="text-sm text-parchment-dim hover:text-parchment">
        ← Módulos
      </Link>

      <div>
        <h1 className="font-display text-xl text-parchment">Permissões</h1>
        <p className="mt-1 text-xs text-parchment-dim">
          Quem pode falar com o Sebas e o que ele pode executar. O dono sempre tem acesso total, independente destas regras.
        </p>
      </div>

      {(["dm", "mention", "action"] as PermissionSurface[]).map((surface) => (
        <Panel key={surface} title={SURFACE_LABELS[surface]}>
          <form action={surfaceActions[surface]} className="flex flex-col gap-4 p-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-parchment-muted">Modo</span>
              <select
                name="mode"
                defaultValue={settings[surface].mode}
                className="w-fit rounded-md border border-brass bg-panel-raised px-3 py-2 text-sm text-parchment"
              >
                {(["everyone", "whitelist", "blacklist"] as PermissionMode[]).map((mode) => (
                  <option key={mode} value={mode}>
                    {MODE_LABELS[mode]}
                  </option>
                ))}
              </select>
            </label>

            <IdListEditor name="userIds" label="Usuários (Discord user ID)" defaultValue={settings[surface].userIds} placeholder="123456789012345678" />
            <IdListEditor name="roleIds" label="Cargos (Discord role ID)" defaultValue={settings[surface].roleIds} placeholder="987654321098765432" />

            <button
              type="submit"
              className="w-fit rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gold-bright"
            >
              Salvar
            </button>
          </form>
        </Panel>
      ))}

      <Panel title="Allowlist global de tools">
        <form action={saveToolsAction} className="flex flex-col gap-4 p-4">
          <p className="text-xs text-parchment-dim">
            Nomes qualificados de tool que o Sebas pode executar, independente de quem pergunta. Não há um registro
            dinâmico de tools exposto pelo core ainda — a lista é digitada aqui manualmente.
          </p>
          <IdListEditor name="enabledTools" label="Tools habilitadas" defaultValue={settings.enabledTools} placeholder="ex: web_search" />
          <button
            type="submit"
            className="w-fit rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gold-bright"
          >
            Salvar
          </button>
        </form>
      </Panel>
    </div>
  );
}
