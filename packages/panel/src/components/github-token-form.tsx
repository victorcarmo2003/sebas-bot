"use client";

import { useState } from "react";
import { saveGithubTokenAction } from "@/app/(dashboard)/actions";

// Versao persistente do fluxo que hoje so existe dentro do modal de notificacao
// (GithubTokenSetupForm em notifications-panel.tsx) — chama a mesma action sem
// notificationId, o que a action ja suporta (parametro opcional).
export function GithubTokenForm({ hasToken, canEdit }: { hasToken: boolean; canEdit: boolean }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const result = await saveGithubTokenAction(token.trim());
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Não foi possível validar o token.");
      return;
    }
    setToken("");
    setSaved(true);
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2 text-sm">
        <span className={`h-1.5 w-1.5 rounded-full ${hasToken ? "bg-moss" : "bg-parchment-dim"}`} />
        <span className="text-parchment-muted">{hasToken ? "Token configurado" : "Nenhum token configurado"}</span>
      </div>

      {canEdit ? (
        <>
          <p className="text-sm text-parchment-muted">
            Crie um token em{" "}
            <a
              href="https://github.com/settings/tokens/new?description=sebas-bot&scopes=public_repo"
              target="_blank"
              rel="noreferrer"
              className="text-gold hover:text-gold-bright hover:underline"
            >
              github.com/settings/tokens/new
            </a>{" "}
            (escopo <code className="font-mono text-xs">public_repo</code> basta) e cole abaixo para atualizar.
          </p>
          <input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="ghp_..."
            className="rounded-md border border-brass bg-panel-raised px-3 py-2 font-mono text-sm text-parchment"
          />
          {error && <p className="text-sm text-wine">{error}</p>}
          {saved && <p className="text-sm text-moss">Token salvo.</p>}
          <button
            type="button"
            disabled={!token.trim() || busy}
            onClick={handleSave}
            className="w-fit rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink hover:bg-gold-bright disabled:opacity-50"
          >
            {busy ? "Salvando..." : hasToken ? "Atualizar token" : "Salvar token"}
          </button>
        </>
      ) : (
        <p className="text-sm text-parchment-dim">Só o dono pode configurar o token do GitHub.</p>
      )}
    </div>
  );
}
