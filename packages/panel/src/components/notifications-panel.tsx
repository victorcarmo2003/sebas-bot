"use client";

import { useState } from "react";
import {
  listOpenCodeModelsAction,
  resolveNotificationAction,
  saveGithubTokenAction,
  saveOpenCodeKeyAction,
  selectOpenCodeModelAction
} from "@/app/(dashboard)/actions";
import type { OpenCodeModel } from "@/lib/worker-api";
import type { PendingAction } from "@/lib/worker-api";

const SEVERITY_STYLE: Record<PendingAction["severity"], string> = {
  info: "border-brass bg-panel",
  warning: "border-amber/40 bg-amber-deep",
  critical: "border-wine-border bg-wine-deep"
};

// Pendencias com um desses actionKind abrem um formulario de verdade no modal (ver
// NotificationModal abaixo) — o resto so tem "marcar como resolvido". O item da lista mostra
// "Configurar →" pras primeiras, deixando claro que tem algo pra fazer, nao so ler.
const CONFIGURABLE_ACTION_KINDS = new Set(["ai_provider_setup", "github_token_setup"]);

export function NotificationsPanel({ items }: { items: PendingAction[] }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const active = items.find((item) => item.id === openId) ?? null;

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-parchment-muted">Pendências</h2>
      <div className="flex flex-col gap-2">
        {items.map((item) => {
          const configurable = item.actionKind !== null && CONFIGURABLE_ACTION_KINDS.has(item.actionKind);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setOpenId(item.id)}
              className={`group flex items-center justify-between gap-3 rounded-lg border p-4 text-left transition-colors hover:border-gold-dim ${SEVERITY_STYLE[item.severity]}`}
            >
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-parchment">{item.title}</span>
                <span className="text-xs text-parchment-muted">{item.message}</span>
              </div>
              <span
                className={`shrink-0 whitespace-nowrap text-xs font-medium transition-colors ${
                  configurable ? "text-gold group-hover:text-gold-bright" : "text-parchment-dim group-hover:text-parchment-muted"
                }`}
              >
                {configurable ? "Configurar →" : "Ver →"}
              </span>
            </button>
          );
        })}
      </div>

      {active && <NotificationModal action={active} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function NotificationModal({ action, onClose }: { action: PendingAction; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-brass bg-panel p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h3 className="font-display text-lg text-parchment">{action.title}</h3>
          <button type="button" onClick={onClose} className="text-parchment-dim hover:text-parchment">
            Fechar
          </button>
        </div>

        {action.actionKind === "ai_provider_setup" ? (
          <OpenCodeSetupForm notificationId={action.id} onDone={onClose} />
        ) : action.actionKind === "github_token_setup" ? (
          <GithubTokenSetupForm notificationId={action.id} onDone={onClose} />
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-parchment-muted">{action.message}</p>
            <button
              type="button"
              onClick={async () => {
                await resolveNotificationAction(action.id);
                onClose();
              }}
              className="w-fit rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink hover:bg-gold-bright"
            >
              Marcar como resolvido
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function OpenCodeSetupForm({ notificationId, onDone }: { notificationId: number; onDone: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [step, setStep] = useState<"key" | "model">("key");
  const [models, setModels] = useState<OpenCodeModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSaveKey() {
    setBusy(true);
    setError(null);
    const result = await saveOpenCodeKeyAction(apiKey.trim());
    if (!result.ok) {
      setError(result.error ?? "Não foi possível validar a chave.");
      setBusy(false);
      return;
    }

    const modelsResult = await listOpenCodeModelsAction();
    setBusy(false);
    if ("error" in modelsResult) {
      setError(modelsResult.error);
      return;
    }
    setModels(modelsResult.items);
    setStep("model");
  }

  async function handleSelectModel() {
    if (!selectedModel) return;
    setBusy(true);
    setError(null);
    const result = await selectOpenCodeModelAction(selectedModel, notificationId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Não foi possível selecionar o modelo.");
      return;
    }
    onDone();
  }

  if (step === "key") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-parchment-muted">
          Crie uma conta gratuita em{" "}
          <a href="https://opencode.ai/auth" target="_blank" rel="noreferrer" className="text-gold hover:text-gold-bright hover:underline">
            opencode.ai/auth
          </a>{" "}
          (sem cartão) e cole a API key abaixo.
        </p>
        <input
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="sk-..."
          className="rounded-md border border-brass bg-ink px-3 py-2 font-mono text-sm text-parchment"
        />
        {error && <p className="text-sm text-wine">{error}</p>}
        <button
          type="button"
          disabled={!apiKey.trim() || busy}
          onClick={handleSaveKey}
          className="w-fit rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink hover:bg-gold-bright disabled:opacity-50"
        >
          {busy ? "Validando..." : "Validar e continuar"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-parchment-muted">
        Escolha um modelo gratuito. A OpenCode Zen troca esses modelos periodicamente; se um deixar de
        ser grátis, o Sebas avisa de novo por aqui.
      </p>
      <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
        {models.map((model) => (
          <label
            key={model.id}
            className="flex items-center gap-2 rounded-md border border-brass px-3 py-2 text-sm text-parchment hover:bg-panel-raised"
          >
            <input
              type="radio"
              name="model"
              value={model.id}
              checked={selectedModel === model.id}
              onChange={() => setSelectedModel(model.id)}
              className="accent-gold"
            />
            <span className="font-mono">{model.id}</span>
          </label>
        ))}
        {models.length === 0 && <p className="text-sm text-parchment-dim">Nenhum modelo gratuito encontrado agora.</p>}
      </div>
      {error && <p className="text-sm text-wine">{error}</p>}
      <button
        type="button"
        disabled={!selectedModel || busy}
        onClick={handleSelectModel}
        className="w-fit rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink hover:bg-gold-bright disabled:opacity-50"
      >
        {busy ? "Salvando..." : "Confirmar modelo"}
      </button>
    </div>
  );
}

function GithubTokenSetupForm({ notificationId, onDone }: { notificationId: number; onDone: () => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setBusy(true);
    setError(null);
    const result = await saveGithubTokenAction(token.trim(), notificationId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Não foi possível validar o token.");
      return;
    }
    onDone();
  }

  return (
    <div className="flex flex-col gap-4">
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
        (escopo <code className="font-mono text-xs">public_repo</code> basta pra buscar módulos/servidores MCP públicos) e cole abaixo.
      </p>
      <input
        value={token}
        onChange={(event) => setToken(event.target.value)}
        placeholder="ghp_..."
        className="rounded-md border border-brass bg-ink px-3 py-2 font-mono text-sm text-parchment"
      />
      {error && <p className="text-sm text-wine">{error}</p>}
      <button
        type="button"
        disabled={!token.trim() || busy}
        onClick={handleSave}
        className="w-fit rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink hover:bg-gold-bright disabled:opacity-50"
      >
        {busy ? "Validando..." : "Salvar token"}
      </button>
    </div>
  );
}
