import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import nacl from "tweetnacl";
import { createAdminApiRouter } from "../src/core/admin-api/router.js";
import { runAgentLoop } from "../src/core/ai/agent-loop.js";
import { resolveActiveAiProvider } from "../src/core/ai/registry.js";
import { loadCoreConfig } from "../src/core/config/env.js";
import { openDb } from "../src/core/db/client.js";
import { runMigrations } from "../src/core/db/migrate.js";
import { editDiscordInteractionOriginalResponse, sendDiscordChannelMessage, triggerTypingIndicator } from "../src/core/discord/client.js";
import { McpClientManager, listMcpServers } from "../src/core/mcp/client.js";
import { startMcpServer } from "../src/core/mcp/server.js";
import { grantedPermissionsForInTreeModule } from "../src/core/modules/grants.js";
import { ModuleHost } from "../src/core/modules/host.js";
import { resolveEntryPoints } from "../src/core/modules/installer.js";
import { ensureInTreeModuleRegistered } from "../src/core/modules/marketplace-repo.js";
import type { PermissionGateRequest, PermissionGateResult, SebasModuleManifest } from "../src/core/modules/types.js";
import { moduleToolProviders, ToolRegistry } from "../src/core/tools/registry.js";
import { skillsToolProvider } from "../src/core/tools/skills.js";

const config = loadCoreConfig();
runMigrations(config.dbPath);
const db = openDb(config.dbPath);

interface InTreeModuleSpec {
  dir: string;
  manifest: SebasModuleManifest;
  id: string;
}

// Modulos in-tree: embutidos no monorepo (packages/modules/<nome>), buildam junto do core,
// confiam direto no proprio manifest (auto-grant, sem fluxo de aprovacao de marketplace).
// process.cwd() e nao import.meta.url de proposito: a profundidade de import.meta.url muda
// entre rodar via tsx (bin/bot.ts) e o build compilado (dist/bin/bot.js), mas o working
// directory do processo (systemd WorkingDirectory, ou packages/core em dev) e sempre a raiz
// do pacote core — mesma logica de db/migrate.ts pra MIGRATIONS_DIR.
function loadInTreeModule(dirName: string): InTreeModuleSpec {
  const dir = join(process.cwd(), "..", "modules", dirName);
  const manifest = JSON.parse(readFileSync(join(dir, "sebas.module.json"), "utf8")) as SebasModuleManifest;
  return { dir, manifest, id: manifest.id };
}

const IN_TREE_MODULES: InTreeModuleSpec[] = [loadInTreeModule("changelog-roblox"), loadInTreeModule("permissions")];

const host = new ModuleHost(db, config);
// Registra cada modulo in-tree em module_installs (idempotente) pra painel/admin API tratarem
// eles igual a um modulo instalado — sem isso, GET /modules/:id sempre dava 404. Se o dono
// desabilitou pelo painel antes do ultimo restart, respeita isso (nao inicia de novo sozinho).
for (const mod of IN_TREE_MODULES) {
  const install = ensureInTreeModuleRegistered(db, mod.manifest);
  if (install.state !== "disabled") {
    host.start({
      moduleId: mod.id,
      entryPoints: resolveEntryPoints(mod.dir, mod.manifest),
      granted: grantedPermissionsForInTreeModule(mod.manifest)
    });
  }
}

const inTreeModuleIds = IN_TREE_MODULES.map((mod) => mod.id);
// Compat: changelog-roblox continua acessivel sem prefixo de moduleId (/settings, /guilds,
// /history) — e' o unico modulo in-tree que o painel ja consumia antes desse plano.
const legacyControllerModuleId = "changelog-roblox";
// Modulo novo (Workstream 3): decide quem pode falar/usar tools com o Sebas.
const permissionsModuleId = IN_TREE_MODULES.find((mod) => mod.manifest.id === "permissions")?.id ?? "permissions";

const mcpClientManager = new McpClientManager(dirname(config.dbPath));
for (const server of listMcpServers(db)) {
  if (!server.enabled) continue;
  mcpClientManager.connect(server).catch((error) => {
    console.error(`Failed to connect to MCP server "${server.id}" at startup:`, error);
  });
}

const toolRegistry = new ToolRegistry(() => [
  ...moduleToolProviders(host),
  skillsToolProvider,
  ...mcpClientManager.connectedServerIds().map((id) => mcpClientManager.toolProvider(id))
]);

startMcpServer(toolRegistry, config.mcpPort);

const INTERACTION_PING = 1;
const INTERACTION_APPLICATION_COMMAND = 2;
const RESPONSE_PONG = 1;
const RESPONSE_DEFERRED_CHANNEL_MESSAGE = 5;
const MESSAGE_FLAG_EPHEMERAL = 1 << 6;

// Comando do proprio core (nao de um modulo): conversa com o Sebas usando o agent-loop de
// tool-calling contra o toolRegistry cheio (modulos + skills + MCP externo).
const CORE_CHAT_COMMAND_NAME = "sebas";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, service: "sebas-bot" }));

app.route(
  "/api/admin",
  createAdminApiRouter({
    db,
    config,
    host,
    dataDir: dirname(config.dbPath),
    inTreeModuleIds,
    legacyControllerModuleId,
    toolRegistry,
    mcpClientManager
  })
);

interface DiscordUserRef {
  id: string;
}

interface DiscordInteraction {
  type: number;
  data?: { name?: string; options?: Array<{ name: string; type: number; value?: string }> };
  application_id: string;
  token: string;
  guild_id?: string;
  /** So presente em interacao dentro de guild — DM usa `user` no lugar. */
  member?: { user: DiscordUserRef; roles: string[] };
  /** So presente em interacao de DM. */
  user?: DiscordUserRef;
}

app.post("/interactions", async (c) => {
  const body = await c.req.text();
  const signature = c.req.header("x-signature-ed25519");
  const timestamp = c.req.header("x-signature-timestamp");
  if (!verifySignature(signature, timestamp, body, config.discordPublicKey)) {
    console.warn("Invalid Discord signature.");
    return c.text("invalid request signature", 401);
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(body);
  } catch {
    return c.text("invalid interaction body", 400);
  }

  if (interaction.type === INTERACTION_PING) {
    return c.json({ type: RESPONSE_PONG });
  }
  if (interaction.type !== INTERACTION_APPLICATION_COMMAND) {
    return c.json({ type: 4, data: { content: "Interacao nao suportada.", flags: MESSAGE_FLAG_EPHEMERAL } });
  }

  const commandName = interaction.data?.name;

  if (commandName === CORE_CHAT_COMMAND_NAME) {
    void handleSebasChatCommand(interaction).catch((error) => {
      console.error(`"${CORE_CHAT_COMMAND_NAME}" command failed:`, error);
    });
    return c.json({ type: RESPONSE_DEFERRED_CHANNEL_MESSAGE, data: { flags: MESSAGE_FLAG_EPHEMERAL } });
  }

  // Cada modulo in-tree pode declarar seus proprios discordCommands (hoje so o changelog-roblox
  // expoe algum) — agrega todos pra achar quem e' dono do comando recebido.
  const commandsByModule = await Promise.all(
    inTreeModuleIds.map(async (moduleId) => ({ moduleId, commands: await host.listDiscordCommands(moduleId).catch(() => []) }))
  );
  const owner = commandsByModule.find((entry) => entry.commands.some((definition) => definition.name === commandName));
  if (!commandName || !owner) {
    return c.json({ type: 4, data: { content: "Comando desconhecido.", flags: MESSAGE_FLAG_EPHEMERAL } });
  }

  // Deferido: o modulo responde de verdade depois, via ctx.discord.editInteractionResponse
  // (PATCH assincrono no /webhooks/.../messages/@original) — ver discord-commands.ts do modulo.
  void host.handleDiscordCommand(owner.moduleId, commandName, interaction).catch((error) => {
    console.error(`Discord command "${commandName}" failed:`, error);
  });
  return c.json({ type: RESPONSE_DEFERRED_CHANNEL_MESSAGE, data: { flags: MESSAGE_FLAG_EPHEMERAL } });
});

// Rota interna, nao exposta ao Discord — bin/gateway.ts fala com o bot por aqui quando ve uma
// mencao ou DM real (conversa passiva, sem slash command). Mesmo secret da admin API porque
// os dois processos rodam na mesma maquina/confianca; nao e' pensado pra ser exposto externamente.
app.post("/internal/gateway-message", async (c) => {
  const auth = c.req.header("authorization");
  if (!process.env.ADMIN_API_SECRET || auth !== `Bearer ${process.env.ADMIN_API_SECRET}`) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const body = await c.req.json();
  if (!body.channelId || typeof body.content !== "string" || typeof body.authorId !== "string") {
    return c.json({ error: "channelId, content and authorId are required" }, 400);
  }
  const guildId: string | null = typeof body.guildId === "string" ? body.guildId : null;
  const roleIds: string[] = Array.isArray(body.roleIds) ? body.roleIds.filter((id: unknown): id is string => typeof id === "string") : [];
  void handleGatewayMessage(body.channelId, body.content, body.authorId, guildId, roleIds).catch((error) => {
    console.error("gateway-message handling failed:", error);
  });
  return c.json({ ok: true });
});

/** Consulta o modulo de permissoes pra decidir se esse usuario pode falar com o Sebas nessa
 * superficie e quais tools ele pode usar. Fail-safe OBRIGATORIO: se o modulo estiver
 * ausente/desabilitado/travado, nunca abre o bot geral — so o dono continua passando. */
async function resolvePermissionGate(
  discordUserId: string,
  guildId: string | null,
  roleIds: string[],
  surface: PermissionGateRequest["surface"]
): Promise<PermissionGateResult> {
  const isOwner = discordUserId === config.ownerDiscordId;
  try {
    return await host.checkPermissionGate(permissionsModuleId, { discordUserId, guildId, roleIds, surface, isOwner });
  } catch (error) {
    console.error("Permission gate check failed, falling back to owner-only:", error);
    return { canRespond: isOwner, allowedTools: isOwner ? "all" : [] };
  }
}

/** Roda o agent-loop com a persona do Sebas. Devolve null quando nao ha provider de IA
 * configurado (chamador decide se isso vira mensagem visivel ou fica em silencio). */
async function runSebasReply(userMessage: string, allowedTools: PermissionGateResult["allowedTools"]): Promise<string | null> {
  const provider = resolveActiveAiProvider(db, config);
  if (!provider) return null;

  const persona = await skillsToolProvider.callTool("load_skill", { name: "sebas-persona" });
  const systemPrompt = persona.ok ? (persona.result as { content: string }).content : undefined;

  const result = await runAgentLoop(provider, toolRegistry, { systemPrompt, userPrompt: userMessage, allowedTools });
  return result.ok ? result.text || "Não tenho uma resposta pra isso." : `Não consegui responder: ${result.error}`;
}

async function handleSebasChatCommand(interaction: DiscordInteraction): Promise<void> {
  const userMessage = interaction.data?.options?.find((option) => option.name === "mensagem")?.value ?? "";
  const discordUserId = interaction.member?.user.id ?? interaction.user?.id ?? "";
  const guildId = interaction.guild_id ?? null;
  const roleIds = interaction.member?.roles ?? [];

  const gate = await resolvePermissionGate(discordUserId, guildId, roleIds, "slash_command");
  if (!gate.canRespond) {
    // Interacao ja foi deferida (RESPONSE_DEFERRED_CHANNEL_MESSAGE) — precisa de um followup ou
    // fica "pensando..." pra sempre no cliente do Discord; a mensagem e' ephemeral (so o autor ve).
    await editDiscordInteractionOriginalResponse(config.discordApplicationId, interaction.token, "Você não tem permissão para conversar com o Sebas.");
    return;
  }

  const reply = await runSebasReply(userMessage, gate.allowedTools);
  await editDiscordInteractionOriginalResponse(
    config.discordApplicationId,
    interaction.token,
    (reply ?? "Ainda não tenho um provedor de IA configurado. Configure no painel primeiro.").slice(0, 1900)
  );
}

async function handleGatewayMessage(
  channelId: string,
  content: string,
  authorId: string,
  guildId: string | null,
  roleIds: string[]
): Promise<void> {
  const surface: PermissionGateRequest["surface"] = guildId ? "mention" : "dm";
  const gate = await resolvePermissionGate(authorId, guildId, roleIds, surface);
  if (!gate.canRespond) return; // Silencio total — canal compartilhado, nao da pra avisar "sem permissao" sem expor a lista pra todo mundo.

  // "Fulano esta digitando..." enquanto o agent-loop roda — unico feedback visivel que da pra
  // dar aqui (nao tem defer/thinking automatico como o slash command). O indicador do Discord
  // dura so ~10s, entao reforca a cada 8s ate a resposta ficar pronta.
  const stopTyping = startTypingLoop(channelId);
  try {
    // Sem provider configurado, fica em silencio aqui — diferente do /sebas (resposta so pro
    // autor, ephemeral), isso e' canal compartilhado; nao faz sentido avisar "configure a IA"
    // toda vez que alguem menciona o bot.
    const reply = await runSebasReply(content, gate.allowedTools);
    if (!reply) return;
    await sendDiscordChannelMessage(config.discordBotToken, channelId, { content: reply.slice(0, 1900) });
  } finally {
    stopTyping();
  }
}

function startTypingLoop(channelId: string): () => void {
  const trigger = () => void triggerTypingIndicator(config.discordBotToken, channelId).catch(() => undefined);
  trigger();
  const interval = setInterval(trigger, 8_000);
  return () => clearInterval(interval);
}

function verifySignature(signature: string | undefined, timestamp: string | undefined, body: string, publicKey: string): boolean {
  if (!signature || !timestamp) return false;
  try {
    return nacl.sign.detached.verify(new TextEncoder().encode(timestamp + body), hexToUint8Array(signature), hexToUint8Array(publicKey));
  } catch {
    return false;
  }
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

serve({ fetch: app.fetch, port: config.botPort }, (info) => {
  console.log(`sebas-bot listening on port ${info.port}`);
});
