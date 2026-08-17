import { Panel } from "@/components/panel";
import { OpenCodeKeyForm } from "@/components/opencode-key-form";
import { OpenCodeModelPriority } from "@/components/opencode-model-priority";
import { requireSession } from "@/lib/require-session";
import { getAiStatus, listModelPriority } from "@/lib/worker-api";

export default async function OpenCodeSettingsPage() {
  const session = await requireSession();
  const canEdit = session.role === "owner";

  const [{ opencode }, priority] = await Promise.all([
    getAiStatus(session.discordUserId),
    listModelPriority(session.discordUserId)
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-sm uppercase tracking-[0.14em] text-parchment-dim">OpenCode</h1>

      <Panel title="Conta OpenCode">
        <OpenCodeKeyForm status={opencode} canEdit={canEdit} />
      </Panel>

      <Panel title="Prioridade de modelos e fallback automático">
        <OpenCodeModelPriority initialItems={priority.items} initialAutoSwitch={opencode.autoSwitchEnabled} canEdit={canEdit} />
      </Panel>
    </div>
  );
}
