import type { SebasToolDefinition } from "../modules/types.js";

export type AiChatRole = "system" | "user" | "assistant" | "tool";

export interface AiToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AiChatMessage {
  role: AiChatRole;
  /** Vazio em mensagens "assistant" que so tem toolCalls (sem texto). */
  content: string;
  /** So em role "assistant": as tool calls que o modelo pediu nesse turno. */
  toolCalls?: AiToolCall[];
  /** So em role "tool": qual toolCall.id essa mensagem responde. */
  toolCallId?: string;
}

export interface AiChatRequest {
  systemPrompt?: string;
  /** Obrigatorio a nao ser que `messages` seja passado (agent-loop usa `messages`, ignora este campo). */
  userPrompt?: string;
  /** Historico completo (system/user/assistant/tool) — quando presente, substitui
   * systemPrompt/userPrompt. Usado pelo agent-loop pra manter o ciclo de tool calling. */
  messages?: AiChatMessage[];
  jsonSchema?: Record<string, unknown>;
  jsonSchemaName?: string;
  maxOutputTokens?: number;
  temperature?: number;
  /** Tools no formato OpenAI-compatible — quando presente, o provider manda `tools`/`tool_choice`. */
  tools?: SebasToolDefinition[];
}

export interface AiChatResult {
  ok: boolean;
  json?: unknown;
  text?: string;
  /** Presente quando o modelo pediu pra chamar tool(s) em vez de (ou alem de) responder texto. */
  toolCalls?: AiToolCall[];
  error?: string;
  providerId: string;
  /** true quando o erro veio de HTTP 429 — sinaliza pro fallback engine (opencode-fallback.ts)
   * que vale a pena tentar o proximo modelo da lista, em vez de repetir o mesmo erro. */
  rateLimited?: boolean;
}

export interface AiProvider {
  id: string;
  run(request: AiChatRequest): Promise<AiChatResult>;
}

export interface OpenCodeModel {
  id: string;
  free: boolean;
}
