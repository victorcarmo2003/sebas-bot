"use client";

import { useState } from "react";
import {
  clearModelCooldownAction,
  listOpenCodeModelsAction,
  saveModelPriorityAction,
  setAutoSwitchAction
} from "@/app/(dashboard)/actions";
import type { ModelPriorityItem, OpenCodeModel } from "@/lib/worker-api";

export function OpenCodeModelPriority({
  initialItems,
  initialAutoSwitch,
  canEdit
}: {
  initialItems: ModelPriorityItem[];
  initialAutoSwitch: boolean;
  canEdit: boolean;
}) {
  const [items, setItems] = useState<ModelPriorityItem[]>(initialItems);
  const [autoSwitch, setAutoSwitchState] = useState(initialAutoSwitch);
  // Date.now() e' impuro pra chamar durante o render — capturado uma vez via
  // inicializador preguicoso do useState, jeito aceito pelo lint de pureza do React.
  const [now] = useState(() => Date.now());
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addOptions, setAddOptions] = useState<OpenCodeModel[]>([]);
  const [addBusy, setAddBusy] = useState(false);

  async function handleToggleAutoSwitch(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.checked;
    setAutoSwitchState(next);
    setError(null);
    const result = await setAutoSwitchAction(next);
    if (!result.ok) {
      setAutoSwitchState(!next);
      setError(result.error ?? "Não foi possível atualizar a troca automática.");
    }
  }

  async function handleOpenAdd() {
    setAddOpen(true);
    setAddBusy(true);
    setError(null);
    const result = await listOpenCodeModelsAction();
    setAddBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    const existing = new Set(items.map((item) => item.modelId));
    setAddOptions(result.items.filter((model) => !existing.has(model.id)));
  }

  function handleAddModel(modelId: string) {
    setItems((prev) => [...prev, { modelId, position: prev.length, rateLimitedUntil: null }]);
    setAddOptions((prev) => prev.filter((model) => model.id !== modelId));
    setDirty(true);
    setSaved(false);
  }

  function handleRemoveModel(modelId: string) {
    setItems((prev) => prev.filter((item) => item.modelId !== modelId));
    setDirty(true);
    setSaved(false);
  }

  function handleDrop(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      return;
    }
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setDragIndex(null);
    setDirty(true);
    setSaved(false);
  }

  async function handleClearCooldown(modelId: string) {
    setError(null);
    const result = await clearModelCooldownAction(modelId);
    if (!result.ok) {
      setError(result.error ?? "Não foi possível remover o cooldown.");
      return;
    }
    setItems((prev) => prev.map((item) => (item.modelId === modelId ? { ...item, rateLimitedUntil: null } : item)));
  }

  async function handleSaveOrder() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const result = await saveModelPriorityAction(items.map((item) => item.modelId));
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Não foi possível salvar a ordem.");
      return;
    }
    setDirty(false);
    setSaved(true);
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={autoSwitch}
          disabled={!canEdit}
          onChange={handleToggleAutoSwitch}
          className="accent-gold"
        />
        <span className="text-parchment">Troca automática de modelo</span>
      </label>
      <p className="text-xs text-parchment-dim">
        Com a troca desligada, o Sebas usa sempre o primeiro modelo da lista, mesmo em cooldown.
      </p>

      <div className={autoSwitch ? "flex flex-col gap-2" : "flex flex-col gap-2 pointer-events-none opacity-50"}>
        {items.length === 0 && (
          <p className="rounded-md border border-brass-soft px-3 py-4 text-center text-sm text-parchment-dim">
            Nenhum modelo na lista de prioridade ainda.
          </p>
        )}
        {items.map((item, index) => (
          <ModelBlock
            key={item.modelId}
            item={item}
            index={index}
            now={now}
            canEdit={canEdit}
            onDragStart={() => setDragIndex(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => handleDrop(index)}
            onRemove={() => handleRemoveModel(item.modelId)}
            onClearCooldown={() => handleClearCooldown(item.modelId)}
          />
        ))}
      </div>

      {error && <p className="text-sm text-wine">{error}</p>}
      {saved && !dirty && <p className="text-sm text-moss">Ordem salva.</p>}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3 border-t border-brass-soft pt-3">
          <button
            type="button"
            onClick={handleOpenAdd}
            className="rounded-md border border-brass px-3 py-1.5 text-xs font-medium text-parchment-muted hover:bg-panel-raised"
          >
            Adicionar modelo
          </button>
          <button
            type="button"
            disabled={!dirty || busy}
            onClick={handleSaveOrder}
            className="rounded-md bg-gold px-4 py-1.5 text-sm font-medium text-ink hover:bg-gold-bright disabled:opacity-50"
          >
            {busy ? "Salvando..." : "Salvar ordem"}
          </button>
        </div>
      )}

      {addOpen && canEdit && (
        <div className="flex flex-col gap-2 rounded-md border border-brass-soft bg-ink p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-[0.12em] text-parchment-dim">Modelos gratuitos disponíveis</span>
            <button type="button" onClick={() => setAddOpen(false)} className="text-xs text-parchment-dim hover:text-parchment">
              Fechar
            </button>
          </div>
          {addBusy && <p className="text-sm text-parchment-dim">Carregando...</p>}
          {!addBusy && addOptions.length === 0 && (
            <p className="text-sm text-parchment-dim">Nenhum modelo novo disponível (ou a chave ainda não foi configurada).</p>
          )}
          <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {addOptions.map((model) => (
              <button
                key={model.id}
                type="button"
                onClick={() => handleAddModel(model.id)}
                className="flex items-center justify-between rounded-md border border-brass px-3 py-1.5 text-left text-sm text-parchment hover:bg-panel-raised"
              >
                <span className="font-mono text-xs">{model.id}</span>
                <span className="text-xs text-gold">Adicionar</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ModelBlock({
  item,
  index,
  now,
  canEdit,
  onDragStart,
  onDragOver,
  onDrop,
  onRemove,
  onClearCooldown
}: {
  item: ModelPriorityItem;
  index: number;
  now: number;
  canEdit: boolean;
  onDragStart: () => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: () => void;
  onRemove: () => void;
  onClearCooldown: () => void;
}) {
  const rateLimited = item.rateLimitedUntil !== null && new Date(item.rateLimitedUntil).getTime() > now;

  return (
    <div
      draggable={canEdit}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="flex items-center gap-3 rounded-md border border-brass bg-panel-raised px-3 py-2"
    >
      <span className="text-xs text-parchment-dim">{index + 1}º</span>
      <span className="flex-1 font-mono text-sm text-parchment">{item.modelId}</span>
      {rateLimited && (
        <span className="whitespace-nowrap rounded-full border border-amber/40 bg-amber-deep px-2.5 py-0.5 text-[0.68rem] text-amber">
          Rate limited até {new Date(item.rateLimitedUntil as string).toLocaleString("pt-BR")}
        </span>
      )}
      {rateLimited && canEdit && (
        <button
          type="button"
          onClick={onClearCooldown}
          className="whitespace-nowrap rounded-md border border-brass px-2.5 py-1 text-xs text-parchment-muted hover:bg-panel"
        >
          Remover cooldown
        </button>
      )}
      {canEdit && (
        <button type="button" onClick={onRemove} className="text-parchment-dim hover:text-wine" aria-label="Remover modelo da lista">
          ×
        </button>
      )}
    </div>
  );
}
