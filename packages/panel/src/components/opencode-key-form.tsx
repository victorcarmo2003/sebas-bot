"use client";

import { useState } from "react";
import { saveOpenCodeKeyAction } from "@/app/(dashboard)/actions";
import type { AiProviderStatus } from "@/lib/worker-api";

const STATUS_LABEL: Record<AiProviderStatus["status"], string> = {
  unconfigured: "Não configurado",
  ok: "OK",
  error: "Erro"
};

const STATUS_DOT: Record<AiProviderStatus["status"], string> = {
  unconfigured: "bg-parchment-dim",
  ok: "bg-moss",
  error: "bg-wine"
};

// Versao persistente do primeiro passo de OpenCodeSetupForm (notifications-panel.tsx) —
// aqui so cuida da chave; a escolha/ordem de modelos vira do opencode-model-priority.tsx.
export function OpenCodeKeyForm({ status, canEdit }: { status: AiProviderStatus; canEdit: boolean }) {
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const result = await saveOpenCodeKeyAction(apiKey.trim());
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Não foi possível validar a chave.");
      return;
    }
    setApiKey("");
    setSaved(true);
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <span className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status.status]}`} />
          <span className="text-parchment-muted">{STATUS_LABEL[status.status]}</span>
        </span>
        {status.selectedModel && (
          <span className="text-parchment-dim">
            Modelo ativo: <span className="font-mono text-xs text-parchment-muted">{status.selectedModel}</span>
          </span>
        )}
      </div>
      {status.lastError && <p className="text-xs text-wine">{status.lastError}</p>}

      {canEdit ? (
        <>
          <p className="text-sm text-parchment-muted">
            Crie uma conta gratuita em{" "}
            <a href="https://opencode.ai/auth" target="_blank" rel="noreferrer" className="text-gold hover:text-gold-bright hover:underline">
              opencode.ai/auth
            </a>{" "}
            (sem cartão) e cole a API key abaixo para atualizar.
          </p>
          <input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="sk-..."
            className="rounded-md border border-brass bg-panel-raised px-3 py-2 font-mono text-sm text-parchment"
          />
          {error && <p className="text-sm text-wine">{error}</p>}
          {saved && <p className="text-sm text-moss">Chave salva.</p>}
          <button
            type="button"
            disabled={!apiKey.trim() || busy}
            onClick={handleSave}
            className="w-fit rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink hover:bg-gold-bright disabled:opacity-50"
          >
            {busy ? "Validando..." : status.hasApiKey ? "Atualizar chave" : "Salvar chave"}
          </button>
        </>
      ) : (
        <p className="text-sm text-parchment-dim">Só o dono pode configurar o provedor de IA.</p>
      )}
    </div>
  );
}
