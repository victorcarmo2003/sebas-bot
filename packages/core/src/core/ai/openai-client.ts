import { buildMessages, buildToolsParam, parseToolCalls } from "./openai-compat.js";
import type { AiChatRequest, AiChatResult } from "./types.js";

const FETCH_TIMEOUT_MS = 30_000;

export async function runOpenAiChat(apiKey: string, model: string, request: AiChatRequest): Promise<AiChatResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const tools = buildToolsParam(request);
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxOutputTokens ?? 1500,
        messages: buildMessages(request),
        ...(tools ? { tools, tool_choice: "auto" } : {}),
        ...(request.jsonSchema
          ? {
              response_format: {
                type: "json_schema",
                json_schema: { name: request.jsonSchemaName ?? "response", schema: request.jsonSchema, strict: true }
              }
            }
          : {})
      })
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { ok: false, error: `OpenAI failed with ${response.status}: ${text.slice(0, 400)}`, providerId: "openai" };
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown; tool_calls?: Array<{ id?: unknown; function?: { name?: unknown; arguments?: unknown } }> } }>;
    };
    const message = data.choices?.[0]?.message;
    const toolCalls = message ? parseToolCalls(message) : undefined;
    if (toolCalls) {
      return { ok: true, toolCalls, providerId: "openai" };
    }

    const content = message?.content;
    if (typeof content !== "string") {
      return { ok: false, error: "OpenAI returned an unexpected response shape.", providerId: "openai" };
    }
    if (request.jsonSchema) {
      try {
        return { ok: true, json: JSON.parse(content), providerId: "openai" };
      } catch {
        return { ok: false, error: "OpenAI response was not valid JSON.", providerId: "openai" };
      }
    }
    return { ok: true, text: content, providerId: "openai" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), providerId: "openai" };
  } finally {
    clearTimeout(timeoutId);
  }
}
