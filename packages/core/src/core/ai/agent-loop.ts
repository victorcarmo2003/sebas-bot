import type { ToolRegistry } from "../tools/registry.js";
import type { AiChatMessage, AiProvider } from "./types.js";

const DEFAULT_MAX_ITERATIONS = 6;

export interface AgentLoopInput {
  systemPrompt?: string;
  userPrompt: string;
  maxIterations?: number;
}

export interface AgentLoopResult {
  ok: boolean;
  text?: string;
  error?: string;
  /** Transcript completo (inclui as chamadas de tool e os resultados) — util pra log/debug. */
  messages: AiChatMessage[];
}

/**
 * Loop multi-turno de tool calling: chama o provider com as tools do registry; se ele pedir
 * pra chamar alguma, executa via registry e devolve o resultado como mensagem "tool", repete.
 * Para quando o modelo devolve texto final (sem tool call) ou apos maxIterations (defensivo —
 * um modelo mal comportado nao trava o processo pra sempre).
 */
export async function runAgentLoop(provider: AiProvider, registry: ToolRegistry, input: AgentLoopInput): Promise<AgentLoopResult> {
  const qualifiedTools = await registry.listQualifiedTools();
  // A IA ve e chama pelo nome QUALIFICADO (ex. "module:changelog-roblox:buscar_changelog"),
  // pra dar pro loop rotear a chamada de volta via registry.callQualifiedTool sem ambiguidade.
  const tools = qualifiedTools.map((tool) => ({ ...tool.definition, name: tool.qualifiedName }));

  const messages: AiChatMessage[] = [
    ...(input.systemPrompt ? [{ role: "system" as const, content: input.systemPrompt }] : []),
    { role: "user" as const, content: input.userPrompt }
  ];

  const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const result = await provider.run({ messages, tools });
    if (!result.ok) {
      return { ok: false, error: result.error, messages };
    }

    if (result.toolCalls && result.toolCalls.length > 0) {
      messages.push({ role: "assistant", content: "", toolCalls: result.toolCalls });
      for (const call of result.toolCalls) {
        const outcome = await registry.callQualifiedTool(call.name, call.arguments);
        messages.push({
          role: "tool",
          toolCallId: call.id,
          content: JSON.stringify(outcome.ok ? (outcome.result ?? {}) : { error: outcome.error })
        });
      }
      continue;
    }

    const finalText = result.text ?? "";
    messages.push({ role: "assistant", content: finalText });
    return { ok: true, text: finalText, messages };
  }

  return { ok: false, error: `Agent loop exceeded ${maxIterations} iterations without a final answer.`, messages };
}
