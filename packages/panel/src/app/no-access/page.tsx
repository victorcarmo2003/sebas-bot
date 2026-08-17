import { auth, signOut } from "@/auth";
import { SebasSeal } from "@/components/sebas-seal";

export default async function NoAccessPage() {
  const session = await auth();

  return (
    <div className="flex flex-1 items-center justify-center bg-ink px-4">
      <div className="w-full max-w-sm rounded-xl border border-brass bg-panel p-8 text-center shadow-2xl">
        <div className="flex justify-center">
          <SebasSeal size={44} />
        </div>
        <h1 className="mt-5 font-display text-xl text-parchment">Sem acesso</h1>
        <p className="mt-2 text-sm text-parchment-muted">
          A conta {session?.discordUserId ? <span className="font-mono text-parchment">{session.discordUserId}</span> : null}{" "}
          não tem permissão neste painel. Peça para o dono te adicionar como subadmin.
        </p>
        <form
          className="mt-6"
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-lg border border-brass px-4 py-2.5 text-sm font-medium text-parchment-muted transition-colors hover:bg-panel-raised"
          >
            Sair
          </button>
        </form>
      </div>
    </div>
  );
}
