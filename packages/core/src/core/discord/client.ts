const DISCORD_API_BASE = "https://discord.com/api/v10";
const FETCH_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Discord API request to ${url} timed out after ${Math.round(FETCH_TIMEOUT_MS / 1000)}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function discordFetch(botToken: string, path: string, init: RequestInit): Promise<Response> {
  const response = await fetchWithTimeout(`${DISCORD_API_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bot ${botToken}`,
      "content-type": "application/json",
      ...init.headers
    }
  });
  await assertDiscordResponse(response);
  return response;
}

async function assertDiscordResponse(response: Response): Promise<void> {
  if (response.ok) return;
  const body = await response.text().catch(() => "");
  throw new Error(`Discord API failed with ${response.status}: ${body.slice(0, 500)}`);
}

export interface DiscordMessagePayload {
  content?: string;
  embeds?: unknown[];
  allowed_mentions?: { parse: string[] };
}

/** Mostra "Fulano esta digitando..." no canal por ~10s (limite do proprio Discord — precisa
 * repetir a chamada se o processamento demorar mais que isso). Usado na conversa passiva
 * (bin/gateway.ts -> /internal/gateway-message) pra dar feedback visivel enquanto o agent-loop
 * roda; o /sebas via slash command ja tem "Sebas esta pensando..." de graca via defer. */
export async function triggerTypingIndicator(botToken: string, channelId: string): Promise<void> {
  await discordFetch(botToken, `/channels/${channelId}/typing`, { method: "POST" });
}

export async function sendDiscordChannelMessage(botToken: string, channelId: string, message: DiscordMessagePayload): Promise<void> {
  await discordFetch(botToken, `/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify(message)
  });
}

export async function fetchDiscordBotIdentity(botToken: string): Promise<{ id: string; username: string }> {
  const response = await discordFetch(botToken, "/users/@me", { method: "GET" });
  const data = (await response.json()) as { id?: unknown; username?: unknown };
  if (typeof data.id !== "string" || typeof data.username !== "string") {
    throw new Error("Discord API returned an invalid bot identity.");
  }
  return { id: data.id, username: data.username };
}

export async function editDiscordInteractionOriginalResponse(
  applicationId: string,
  interactionToken: string,
  message: string | DiscordMessagePayload
): Promise<void> {
  const body =
    typeof message === "string"
      ? JSON.stringify({ content: message, allowed_mentions: { parse: [] } })
      : JSON.stringify(message);
  await fetchWithTimeout(`${DISCORD_API_BASE}/webhooks/${applicationId}/${interactionToken}/messages/@original`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body
  }).then(assertDiscordResponse);
}

export async function sendDiscordDirectMessage(botToken: string, discordUserId: string, content: string): Promise<void> {
  const dmChannel = await discordFetch(botToken, "/users/@me/channels", {
    method: "POST",
    body: JSON.stringify({ recipient_id: discordUserId })
  });
  const { id: channelId } = (await dmChannel.json()) as { id: string };
  await sendDiscordChannelMessage(botToken, channelId, { content, allowed_mentions: { parse: [] } });
}

export type VerifyFn = (message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array) => boolean;

export function verifyDiscordRequest(request: Request, body: string, publicKey: string, verify: VerifyFn): boolean {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  if (!signature || !timestamp || !publicKey) {
    return false;
  }
  try {
    return verify(new TextEncoder().encode(timestamp + body), hexToUint8Array(signature), hexToUint8Array(publicKey));
  } catch {
    return false;
  }
}

function hexToUint8Array(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid hex string.");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
