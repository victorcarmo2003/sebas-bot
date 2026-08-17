import type { DatabaseSync } from "node:sqlite";
import type { CoreConfig } from "../config/env.js";
import { listAiProviderSettings, listProviderModels } from "./settings-repo.js";
import { runOpenCodeChatWithFallback } from "./opencode-fallback.js";
import { runOpenAiChat } from "./openai-client.js";
import type { AiProvider } from "./types.js";

/**
 * Resolve o provider de IA configurado, nessa ordem de prioridade: OpenCode Zen (gratis,
 * default recomendado) -> OpenAI (se o dono preferir pagar por um modelo proprio) -> null
 * (caller cai no fallback "local", sem IA, que ja existe no formatter do modulo).
 */
export function resolveActiveAiProvider(db: DatabaseSync, config: CoreConfig): AiProvider | null {
  const settings = listAiProviderSettings(db);

  const opencode = settings.find((row) => row.providerId === "opencode");
  // selectedModel (fluxo legado) OU uma lista de prioridade ja configurada (migration 0007)
  // contam como "modelo configurado" — quem so usou a tela nova nunca chama selectAiProviderModel.
  const hasOpencodeModel = Boolean(opencode?.selectedModel) || (opencode ? listProviderModels(db, "opencode").length > 0 : false);
  if (opencode?.status === "ok" && opencode.apiKey && hasOpencodeModel) {
    const apiKey = opencode.apiKey;
    return {
      id: "opencode",
      run: (request) => runOpenCodeChatWithFallback(db, config, apiKey, request)
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
