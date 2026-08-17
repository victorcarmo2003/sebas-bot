import { Panel } from "@/components/panel";
import { GithubTokenForm } from "@/components/github-token-form";
import { requireSession } from "@/lib/require-session";
import { getGithubStatus } from "@/lib/worker-api";

const ROLE_LABELS: Record<string, string> = {
  owner: "Dono",
  subadmin: "Subadmin"
};

export default async function AccountSettingsPage() {
  const session = await requireSession();
  const { hasToken } = await getGithubStatus(session.discordUserId);
  const canEdit = session.role === "owner";

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-sm uppercase tracking-[0.14em] text-parchment-dim">Conta</h1>

      <Panel title="Sessão atual">
        <div className="flex flex-col gap-2 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-parchment-muted">Discord user ID</span>
            <span className="font-mono text-xs text-parchment">{session.discordUserId}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-parchment-muted">Papel</span>
            <span className="text-parchment">{ROLE_LABELS[session.role] ?? session.role}</span>
          </div>
        </div>
      </Panel>

      <Panel title="Token do GitHub">
        <GithubTokenForm hasToken={hasToken} canEdit={canEdit} />
      </Panel>
    </div>
  );
}
