import { revalidatePath } from "next/cache";
import { Panel } from "@/components/panel";
import { requireSession } from "@/lib/require-session";
import { createSubadmin, deleteSubadmin, listAdmins, updateSubadmin, type PermissionScope } from "@/lib/worker-api";

const ALL_SCOPES: PermissionScope[] = [
  "guilds:view",
  "guilds:edit",
  "history:view",
  "logs:view",
  "sources:manage",
  "admins:manage",
  "modules:manage"
];

function scopesFromForm(formData: FormData): PermissionScope[] {
  return ALL_SCOPES.filter((scope) => formData.get(`scope:${scope}`) === "on");
}

export default async function AdminsPage() {
  const session = await requireSession("admins:manage");
  const { items } = await listAdmins(session.discordUserId);

  async function createAction(formData: FormData) {
    "use server";
    const activeSession = await requireSession("admins:manage");
    const discordUserId = String(formData.get("discordUserId") ?? "").trim();
    const displayName = String(formData.get("displayName") ?? "").trim();
    if (!discordUserId) return;

    await createSubadmin(activeSession.discordUserId, {
      discordUserId,
      displayName: displayName || undefined,
      permissions: scopesFromForm(formData)
    });
    revalidatePath("/admins");
  }

  async function updateAction(formData: FormData) {
    "use server";
    const activeSession = await requireSession("admins:manage");
    const targetId = String(formData.get("targetId") ?? "");
    if (!targetId) return;

    await updateSubadmin(activeSession.discordUserId, targetId, {
      permissions: scopesFromForm(formData)
    });
    revalidatePath("/admins");
  }

  async function deleteAction(formData: FormData) {
    "use server";
    const activeSession = await requireSession("admins:manage");
    const targetId = String(formData.get("targetId") ?? "");
    if (!targetId) return;

    await deleteSubadmin(activeSession.discordUserId, targetId);
    revalidatePath("/admins");
  }

  const subadmins = items.filter((admin) => admin.role === "subadmin");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-sm uppercase tracking-[0.14em] text-parchment-dim">
        Admins <span className="text-parchment-dim">· {subadmins.length} subadmin(s)</span>
      </h1>

      <Panel title="Adicionar subadmin">
        <form action={createAction} className="flex flex-col gap-3 p-4">
          <div className="flex gap-3">
            <input
              name="discordUserId"
              placeholder="Discord user ID"
              required
              className="flex-1 rounded-md border border-brass bg-panel-raised px-3 py-2 font-mono text-sm text-parchment"
            />
            <input
              name="displayName"
              placeholder="Nome (opcional)"
              className="flex-1 rounded-md border border-brass bg-panel-raised px-3 py-2 text-sm text-parchment"
            />
          </div>
          <ScopePills />
          <button
            type="submit"
            className="w-fit rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gold-bright"
          >
            Adicionar
          </button>
        </form>
      </Panel>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {subadmins.map((admin) => (
          <div key={admin.discordUserId} className="flex flex-col gap-3 rounded-lg border border-brass bg-panel p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-sm text-parchment">{admin.discordUserId}</p>
                {admin.displayName && <p className="text-xs text-parchment-dim">{admin.displayName}</p>}
              </div>
              <form action={deleteAction}>
                <input type="hidden" name="targetId" value={admin.discordUserId} />
                <button type="submit" className="text-sm text-wine hover:underline">
                  Remover
                </button>
              </form>
            </div>
            <form action={updateAction} className="flex flex-col gap-3 border-t border-brass-soft pt-3">
              <input type="hidden" name="targetId" value={admin.discordUserId} />
              <ScopePills defaultScopes={admin.permissions} />
              <button
                type="submit"
                className="w-fit rounded-md border border-brass px-3 py-1.5 text-xs font-medium text-parchment-muted hover:bg-panel-raised"
              >
                Salvar permissões
              </button>
            </form>
          </div>
        ))}
        {subadmins.length === 0 && (
          <p className="rounded-lg border border-brass bg-panel px-4 py-6 text-center text-sm text-parchment-dim lg:col-span-2">
            Nenhum subadmin cadastrado ainda.
          </p>
        )}
      </div>
    </div>
  );
}

function ScopePills({ defaultScopes = [] }: { defaultScopes?: PermissionScope[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {ALL_SCOPES.map((scope) => (
        <label key={scope} className="group">
          <input
            type="checkbox"
            name={`scope:${scope}`}
            defaultChecked={defaultScopes.includes(scope)}
            className="peer sr-only"
          />
          <span className="block cursor-pointer select-none rounded-full border border-brass px-3 py-1 text-xs text-parchment-dim transition-colors peer-checked:border-gold-dim peer-checked:bg-gold peer-checked:text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-gold">
            {scope}
          </span>
        </label>
      ))}
    </div>
  );
}
