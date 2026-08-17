/**
 * Cliente do Discord Gateway (WebSocket) — processo fino e separado de bin/bot.ts. So mantem a
 * conexao persistente, identifica, cuida de heartbeat/reconexao/resume, filtra MESSAGE_CREATE
 * relevante (mencao ou DM) e repassa pro bot via POST /internal/gateway-message. A logica de
 * IA/tools fica centralizada em bin/bot.ts (toolRegistry/agent-loop ja rodam la desde M9) —
 * dessa forma nao duplica a stack inteira num terceiro processo so pra manter um socket aberto.
 *
 * Usa o `WebSocket` global do Node (nativo desde Node 22, sem dependencia nova).
 *
 * Pre-requisito que so o usuario resolve: habilitar o intent privilegiado MESSAGE_CONTENT no
 * Discord Developer Portal do app (sem isso, `message.content` chega vazio nas mensagens).
 */
import { loadCoreConfig } from "../src/core/config/env.js";

const config = loadCoreConfig();

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";

const OP_DISPATCH = 0;
const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
const OP_RESUME = 6;
const OP_RECONNECT = 7;
const OP_INVALID_SESSION = 9;
const OP_HELLO = 10;
const OP_HEARTBEAT_ACK = 11;

const INTENT_GUILDS = 1 << 0;
const INTENT_GUILD_MESSAGES = 1 << 9;
const INTENT_DIRECT_MESSAGES = 1 << 12;
const INTENT_MESSAGE_CONTENT = 1 << 15;
const INTENTS = INTENT_GUILDS | INTENT_GUILD_MESSAGES | INTENT_DIRECT_MESSAGES | INTENT_MESSAGE_CONTENT;

// Codigos de close que o Discord manda quando o problema e' de configuracao (token/intent
// invalidos, versao errada) — reconectar sem corrigir isso so vai repetir o erro pra sempre.
const FATAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

interface GatewayPayload {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
}

interface DiscordUser {
  id: string;
  username?: string;
  bot?: boolean;
}

interface MessageCreateData {
  id: string;
  channel_id: string;
  guild_id?: string;
  content: string;
  author: DiscordUser;
  mentions?: DiscordUser[];
}

let ws: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatAckPending = false;
let lastSeq: number | null = null;
let sessionId: string | null = null;
let resumeGatewayUrl: string | null = null;
let botUserId: string | null = null;
let reconnectDelayMs = 1000;

function connect(url: string): void {
  ws = new WebSocket(url);
  ws.addEventListener("open", () => console.log("Gateway connected."));
  ws.addEventListener("message", (event) => {
    handleMessage(JSON.parse(event.data as string) as GatewayPayload);
  });
  ws.addEventListener("close", (event) => handleClose(event.code));
  ws.addEventListener("error", (event) => console.error("Gateway socket error:", event));
}

function send(payload: GatewayPayload): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function handleMessage(payload: GatewayPayload): void {
  if (payload.s !== null && payload.s !== undefined) {
    lastSeq = payload.s;
  }

  switch (payload.op) {
    case OP_HELLO: {
      const { heartbeat_interval: heartbeatIntervalMs } = payload.d as { heartbeat_interval: number };
      startHeartbeat(heartbeatIntervalMs);
      identifyOrResume();
      return;
    }
    case OP_HEARTBEAT_ACK:
      heartbeatAckPending = false;
      return;
    case OP_HEARTBEAT:
      sendHeartbeat();
      return;
    case OP_RECONNECT:
      ws?.close(4000, "reconnect requested by gateway");
      return;
    case OP_INVALID_SESSION:
      // Sessao invalida — mais simples e seguro e' sempre tratar como nao-resumivel (identify
      // do zero apos um pequeno atraso aleatorio, como a doc recomenda).
      sessionId = null;
      lastSeq = null;
      setTimeout(identifyOrResume, 1000 + Math.random() * 4000);
      return;
    case OP_DISPATCH:
      handleDispatch(payload.t ?? "", payload.d);
      return;
  }
}

function startHeartbeat(intervalMs: number): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  // Jitter no primeiro heartbeat, conforme a doc do Gateway.
  setTimeout(() => {
    sendHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (heartbeatAckPending) {
        console.warn("Heartbeat ACK perdido — conexao zumbi, reconectando.");
        ws?.close(4000, "zombie connection");
        return;
      }
      sendHeartbeat();
    }, intervalMs);
  }, intervalMs * Math.random());
}

function sendHeartbeat(): void {
  heartbeatAckPending = true;
  send({ op: OP_HEARTBEAT, d: lastSeq });
}

function identifyOrResume(): void {
  if (sessionId && lastSeq !== null) {
    send({ op: OP_RESUME, d: { token: config.discordBotToken, session_id: sessionId, seq: lastSeq } });
    return;
  }
  send({
    op: OP_IDENTIFY,
    d: {
      token: config.discordBotToken,
      intents: INTENTS,
      properties: { os: process.platform, browser: "sebas-bot", device: "sebas-bot" }
    }
  });
}

function handleDispatch(type: string, data: unknown): void {
  if (type === "READY") {
    const ready = data as { session_id: string; resume_gateway_url: string; user: DiscordUser };
    sessionId = ready.session_id;
    resumeGatewayUrl = ready.resume_gateway_url;
    botUserId = ready.user.id;
    reconnectDelayMs = 1000;
    console.log(`Gateway READY como ${ready.user.username ?? ready.user.id}.`);
    return;
  }
  if (type === "RESUMED") {
    console.log("Gateway sessao retomada.");
    return;
  }
  if (type === "MESSAGE_CREATE") {
    void handleMessageCreate(data as MessageCreateData);
  }
}

async function handleMessageCreate(message: MessageCreateData): Promise<void> {
  if (!botUserId || message.author.id === botUserId || message.author.bot) return;

  const isDm = !message.guild_id;
  const isMentioned = message.mentions?.some((user) => user.id === botUserId) ?? false;
  if (!isDm && !isMentioned) return;

  const content = message.content.replace(new RegExp(`<@!?${botUserId}>`, "g"), "").trim();
  if (!content) return;

  try {
    const response = await fetch(`http://127.0.0.1:${config.botPort}/internal/gateway-message`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.ADMIN_API_SECRET ?? ""}` },
      body: JSON.stringify({ channelId: message.channel_id, content })
    });
    if (!response.ok) {
      console.error(`Falha ao repassar mensagem pro bot: HTTP ${response.status}`);
    }
  } catch (error) {
    console.error("Falha ao repassar mensagem pro bot:", error);
  }
}

function handleClose(code: number): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  console.warn(`Gateway fechou com codigo ${code}.`);

  if (FATAL_CLOSE_CODES.has(code)) {
    console.error("Codigo de close fatal (config invalida) — nao vou tentar reconectar sozinho. Corrija token/intents e reinicie.");
    process.exit(1);
  }

  const delay = reconnectDelayMs;
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30_000);
  const nextUrl = resumeGatewayUrl && sessionId ? `${resumeGatewayUrl}/?v=10&encoding=json` : GATEWAY_URL;
  setTimeout(() => connect(nextUrl), delay);
}

connect(GATEWAY_URL);
console.log("sebas-gateway iniciado.");
