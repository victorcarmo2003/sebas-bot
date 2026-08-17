import type { AiChatRequest, AiChatResult, OpenCodeModel } from "./types.js";

const OPENCODE_BASE_URL = "https://opencode.ai/zen/v1";

// Modelos free costumam ser "reasoning models" e podem demorar bem mais que uma chamada de chat
// comum antes de responder. O teto real de tempo total fica por conta do caller (ver
// FORMAT_TIMEOUT_MS/TOPIC_TIMEOUT_MS no modulo de changelog); aqui so evitamos travar para sempre.
const FETCH_TIMEOUT_MS = 120_000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * A doc publica da OpenCode Zen nao formaliza o shape de resposta de /v1/models nem marca
 * "free" de forma estruturada - so a convencao observada de "Free" no nome/id do modelo.
 * Por isso a deteccao aqui e defensiva: usa pricing zerado quando presente, cai para o nome.
 */
export async function listOpenCodeModels(apiKey: string): Promise<OpenCodeModel[]> {
  const response = await fetchWithTimeout(`${OPENCODE_BASE_URL}/models`, {
    headers: { authorization: `Bearer ${apiKey}` }
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenCode Zen models request failed with ${response.status}: ${body.slice(0, 300)}`);
  }
  const data = await response.json();
  const items = extractModelList(data);
  return items.map((item) => normalizeModel(item)).filter((model): model is OpenCodeModel => model !== null);
}

export async function testOpenCodeKey(apiKey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await listOpenCodeModels(apiKey);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function runOpenCodeChat(apiKey: string, model: string, request: AiChatRequest): Promise<AiChatResult> {
  const messages = [
    ...(request.systemPrompt ? [{ role: "system", content: request.systemPrompt }] : []),
    { role: "user", content: request.userPrompt }
  ];
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: request.temperature ?? 0.2,
    max_tokens: request.maxOutputTokens ?? 1500
  };
  if (request.jsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: request.jsonSchemaName ?? "response",
        schema: request.jsonSchema,
        strict: true
      }
    };
  }

  try {
    const response = await fetchWithTimeout(`${OPENCODE_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { ok: false, error: `OpenCode Zen failed with ${response.status}: ${text.slice(0, 400)}`, providerId: "opencode" };
    }
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return { ok: false, error: "OpenCode Zen returned an unexpected response shape.", providerId: "opencode" };
    }
    if (request.jsonSchema) {
      try {
        return { ok: true, json: JSON.parse(extractJsonObject(content)), providerId: "opencode" };
      } catch {
        return { ok: false, error: "OpenCode Zen response was not valid JSON.", providerId: "opencode" };
      }
    }
    return { ok: true, text: content, providerId: "opencode" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), providerId: "opencode" };
  }
}

function extractModelList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).data)) {
    return (data as Record<string, unknown>).data as unknown[];
  }
  if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).models)) {
    return (data as Record<string, unknown>).models as unknown[];
  }
  return [];
}

function normalizeModel(item: unknown): OpenCodeModel | null {
  if (typeof item === "string") {
    return { id: item, free: isFreeId(item) };
  }
  if (item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string") {
    const record = item as { id: string; pricing?: { prompt?: unknown; input?: unknown; completion?: unknown; output?: unknown } };
    return { id: record.id, free: isFreeId(record.id) || isFreePricing(record.pricing) };
  }
  return null;
}

function isFreeId(id: string): boolean {
  return /free/i.test(id);
}

function isFreePricing(pricing: { prompt?: unknown; input?: unknown; completion?: unknown; output?: unknown } | undefined): boolean {
  if (!pricing) return false;
  const prompt = Number(pricing.prompt ?? pricing.input ?? Number.NaN);
  const completion = Number(pricing.completion ?? pricing.output ?? Number.NaN);
  return (Number.isFinite(prompt) && prompt === 0) || (Number.isFinite(completion) && completion === 0);
}

function extractJsonObject(text: string): string {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in response.");
  }
  return cleaned.slice(start, end + 1);
}
