"use client";

import { useState } from "react";

// Editor de lista de strings (IDs de usuario/cargo do Discord, ou nomes de tool) com
// chips adicionar/remover no cliente. O resultado final vai num <input type="hidden">
// dentro do <form> que envolve este componente, entao o "Salvar" da secao inteira
// continua sendo um Server Action comum recebendo FormData — sem precisar de fetch
// proprio aqui.
export function IdListEditor({
  name,
  label,
  defaultValue,
  placeholder,
  disabled = false
}: {
  name: string;
  label: string;
  defaultValue: string[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [items, setItems] = useState<string[]>(defaultValue);
  const [draft, setDraft] = useState("");

  function addDraft() {
    const value = draft.trim();
    if (!value || items.includes(value)) {
      setDraft("");
      return;
    }
    setItems((prev) => [...prev, value]);
    setDraft("");
  }

  function removeItem(value: string) {
    setItems((prev) => prev.filter((item) => item !== value));
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-parchment-muted">{label}</span>
      <input type="hidden" name={name} value={items.join(",")} />

      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <span
            key={item}
            className="flex items-center gap-1.5 rounded-full border border-brass px-2.5 py-1 font-mono text-xs text-parchment-muted"
          >
            {item}
            {!disabled && (
              <button
                type="button"
                onClick={() => removeItem(item)}
                className="text-parchment-dim hover:text-wine"
                aria-label={`Remover ${item}`}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {items.length === 0 && <span className="text-xs text-parchment-dim">Nenhum item.</span>}
      </div>

      {!disabled && (
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addDraft();
              }
            }}
            placeholder={placeholder}
            className="flex-1 rounded-md border border-brass bg-panel-raised px-3 py-1.5 font-mono text-xs text-parchment"
          />
          <button
            type="button"
            onClick={addDraft}
            className="rounded-md border border-brass px-3 py-1.5 text-xs text-parchment-muted hover:bg-panel-raised"
          >
            Adicionar
          </button>
        </div>
      )}
    </div>
  );
}
