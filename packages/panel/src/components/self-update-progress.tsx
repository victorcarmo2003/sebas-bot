"use client";

import { useEffect, useState } from "react";
import { getSelfUpdateStatusAction, requestSelfUpdateAction } from "@/app/(dashboard)/actions";
import type { SelfUpdatePhase } from "@/lib/worker-api";

const PHASE_LABEL: Record<SelfUpdatePhase, string> = {
  idle: "",
  requested: "Pedido registrado...",
  pulling: "Puxando código novo...",
  installing: "Instalando dependências...",
  building: "Buildando...",
  "copying-static": "Copiando assets do painel...",
  restarting: "Reiniciando serviços...",
  done: "Atualizado!",
  error: "Falhou"
};

const PHASE_PERCENT: Record<SelfUpdatePhase, number> = {
  idle: 0,
  requested: 5,
  pulling: 15,
  installing: 35,
  building: 75,
  "copying-static": 90,
  restarting: 97,
  done: 100,
  error: 100
};

const ACTIVE_PHASES = new Set<SelfUpdatePhase>(["requested", "pulling", "installing", "building", "copying-static", "restarting"]);
const POLL_MS = 2000;

export function SelfUpdateProgress({ isOwner }: { isOwner: boolean }) {
  const [phase, setPhase] = useState<SelfUpdatePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dismissedDone, setDismissedDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const status = await getSelfUpdateStatusAction();
      if (cancelled) return;
      setPhase(status.phase);
      setError(status.error);
      if (status.phase !== "done") setDismissedDone(false);
    }
    void poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function handleUpdateNow() {
    setBusy(true);
    await requestSelfUpdateAction();
    setBusy(false);
  }

  if (phase === "idle") return null;
  if (phase === "done" && dismissedDone) return null;

  const isActive = ACTIVE_PHASES.has(phase);
  const percent = PHASE_PERCENT[phase];

  return (
    <div className={`flex flex-col gap-2 rounded-lg border px-4 py-3 ${phase === "error" ? "border-wine bg-panel-raised" : "border-brass bg-panel"}`}>
      <div className="flex items-center justify-between text-sm">
        <span className={phase === "error" ? "text-wine" : "text-parchment"}>
          Self-update do Sebas: {PHASE_LABEL[phase]}
          {phase === "error" && error ? ` — ${error}` : ""}
        </span>
        {phase === "done" && (
          <button type="button" onClick={() => setDismissedDone(true)} className="text-xs text-parchment-dim hover:text-parchment">
            Fechar
          </button>
        )}
        {phase === "error" && isOwner && (
          <button type="button" disabled={busy} onClick={handleUpdateNow} className="text-xs text-gold hover:text-gold-bright disabled:opacity-50">
            {busy ? "Tentando..." : "Tentar de novo"}
          </button>
        )}
      </div>
      {isActive && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-raised">
          <div className="h-full rounded-full bg-gold transition-all duration-500" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
}
