/** Monta o corpo de request/parseia a resposta no formato de chat/tool-calling OpenAI-compatible
 * — compartilhado entre opencode-client.ts e openai-client.ts porque os dois falam o mesmo
 * dialeto (OpenCode Zen e' um proxy pra modelos que expoe API estilo OpenAI). */
import type { AiChatRequest, AiToolCall } from "./types.js";

export interface OpenAiCompatMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export function buildMessages(request: AiChatRequest): OpenAiCompatMessage[] {
  if (request.messages) {
    return request.messages.map((message) => {
      if (message.role === "assistant" && message.toolCalls) {
        return {
          role: "assistant",
          content: message.content || null,
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: "function" as const,
            function: { name: call.name, arguments: JSON.stringify(call.arguments) }
          }))
        };
      }
      if (message.role === "tool") {
        return { role: "tool", content: message.content, tool_call_id: message.toolCallId };
      }
      return { role: message.role, content: message.content };
    });
  }
  return [
    ...(request.systemPrompt ? [{ role: "system", content: request.systemPrompt }] : []),
    { role: "user", content: request.userPrompt ?? "" }
  ];
}

export function buildToolsParam(request: AiChatRequest): unknown[] | undefined {
  if (!request.tools || request.tools.length === 0) return undefined;
  return request.tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters }
  }));
}

export function parseToolCalls(message: {
  tool_calls?: Array<{ id?: unknown; function?: { name?: unknown; arguments?: unknown } }>;
}): AiToolCall[] | undefined {
  if (!message.tool_calls || message.tool_calls.length === 0) return undefined;
  const calls: AiToolCall[] = [];
  for (const raw of message.tool_calls) {
    if (typeof raw.id !== "string" || typeof raw.function?.name !== "string") continue;
    let args: Record<string, unknown> = {};
    if (typeof raw.function.arguments === "string") {
      try {
        args = JSON.parse(raw.function.arguments);
      } catch {
        // Argumentos malformados do modelo — trata como tool call sem parametros em vez de
        // derrubar a resposta inteira; o handler da tool decide se reclama de parametro faltando.
      }
    }
    calls.push({ id: raw.id, name: raw.function.name, arguments: args });
  }
  return calls.length > 0 ? calls : undefined;
}
