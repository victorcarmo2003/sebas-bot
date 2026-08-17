"use client";

import { useState } from "react";
import { requestSelfUpdateAction } from "@/app/(dashboard)/actions";

export function SelfUpdateTriggerButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setMessage(null);
    const result = await requestSelfUpdateAction();
    setBusy(false);
    setMessage(result.ok ? "Aplicando — acompanhe na tela principal." : result.error ?? "Falha ao pedir atualização.");
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={handleClick}
        className="w-fit rounded-md border border-brass px-3 py-1.5 text-xs font-medium text-parchment-muted transition-colors hover:bg-panel-raised disabled:opacity-50"
      >
        {busy ? "Checando..." : "Checar e atualizar agora"}
      </button>
      {message && <p className="text-xs text-parchment-dim">{message}</p>}
    </div>
  );
}
