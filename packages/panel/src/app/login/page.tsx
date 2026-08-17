import { signIn } from "@/auth";
import { SebasSeal } from "@/components/sebas-seal";

export default function LoginPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-ink px-4">
      <div className="w-full max-w-sm rounded-xl border border-brass bg-panel p-8 text-center shadow-2xl">
        <div className="flex justify-center">
          <SebasSeal size={56} />
        </div>
        <h1 className="mt-5 font-display text-2xl text-parchment">Sebas</h1>
        <p className="mt-2 text-sm text-parchment-muted">
          Entre com sua conta Discord para administrar o servidor.
        </p>
        <form
          className="mt-7"
          action={async () => {
            "use server";
            await signIn("discord", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-lg bg-gold px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-gold-bright"
          >
            Entrar com Discord
          </button>
        </form>
      </div>
    </div>
  );
}
