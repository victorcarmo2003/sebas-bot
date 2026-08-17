import type { DatabaseSync } from "node:sqlite";
import { listAiProviderSettings } from "./settings-repo.js";
import { runOpenCodeChat } from "./opencode-client.js";
import { runOpenAiChat } from "./openai-client.js";
import type { AiProvider } from "./types.js";

/**
 * Resolve o provider de IA configurado, nessa ordem de prioridade: OpenCode Zen (gratis,
 * default recomendado) -> OpenAI (se o dono preferir pagar por um modelo proprio) -> null
 * (caller cai no fallback "local", sem IA, que ja existe no formatter do modulo).
 */
export function resolveActiveAiProvider(db: DatabaseSync): AiProvider | null {
  const settings = listAiProviderSettings(db);

  const opencode = settings.find((row) => row.providerId === "opencode");
  if (opencode?.status === "ok" && opencode.apiKey && opencode.selectedModel) {
    const apiKey = opencode.apiKey;
    const model = opencode.selectedModel;
    return {
      id: "opencode",
      run: (request) => runOpenCodeChat(apiKey, model, request)
    };
  }

  const openai = settings.find((row) => row.providerId === "openai");
  if (openai?.status === "ok" && openai.apiKey && openai.selectedModel) {
    const apiKey = openai.apiKey;
    const model = openai.selectedModel;
    return {
      id: "openai",
      run: (request) => runOpenAiChat(apiKey, model, request)
    };
  }

  return null;
}
