"use client";

import { useState } from "react";
import { applyModuleUpdateAction, checkModuleUpdateAction } from "@/app/(dashboard)/modules/actions";

export function ModuleUpdatePanel({ moduleId, pinnedSha, canApply }: { moduleId: string; pinnedSha: string; canApply: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remoteSha, setRemoteSha] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  async function handleCheck() {
    setBusy(true);
    setError(null);
    const result = await checkModuleUpdateAction(moduleId);
    setBusy(false);
    setChecked(true);
    if ("error" in result && result.error) {
      setError(result.error);
      return;
    }
    setRemoteSha(result.hasUpdate ? result.remoteSha : null);
  }

  async function handleApply() {
    setBusy(true);
    setError(null);
    const result = await applyModuleUpdateAction(moduleId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Falha ao atualizar módulo.");
      return;
    }
    setRemoteSha(null);
    setChecked(false);
  }

  return (
    <div className="flex flex-col gap-2 border-t border-brass-soft pt-3">
      <p className="text-xs text-parchment-dim">
        sha instalado <span className="font-mono text-parchment-muted">{pinnedSha.slice(0, 7)}</span>
        {remoteSha && (
          <>
            {" "}
            · disponível <span className="font-mono text-gold">{remoteSha.slice(0, 7)}</span>
          </>
        )}
      </p>
      {error && <p className="text-xs text-wine">{error}</p>}
      <div className="flex gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={handleCheck}
          className="w-fit rounded-md border border-brass px-3 py-1.5 text-xs font-medium text-parchment-muted transition-colors hover:bg-panel-raised disabled:opacity-50"
        >
          {busy ? "Checando..." : "Checar atualização"}
        </button>
        {remoteSha && canApply && (
          <button
            type="button"
            disabled={busy}
            onClick={handleApply}
            className="w-fit rounded-md bg-gold px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-gold-bright disabled:opacity-50"
          >
            {busy ? "Atualizando..." : "Atualizar agora"}
          </button>
        )}
      </div>
      {checked && !remoteSha && !error && <p className="text-xs text-parchment-dim">Nenhuma atualização disponível.</p>}
    </div>
  );
}
