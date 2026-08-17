import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import nacl from "tweetnacl";
import { createAdminApiRouter } from "../src/core/admin-api/router.js";
import { loadCoreConfig } from "../src/core/config/env.js";
import { openDb } from "../src/core/db/client.js";
import { runMigrations } from "../src/core/db/migrate.js";
import { ModuleHost } from "../src/core/modules/host.js";
import { grantedPermissionsForInTreeModule } from "../src/core/modules/grants.js";
import { resolveEntryPoints } from "../src/core/modules/installer.js";
import type { SebasModuleManifest } from "../src/core/modules/types.js";

const config = loadCoreConfig();
runMigrations(config.dbPath);
const db = openDb(config.dbPath);

// Modulo in-tree: embutido no monorepo (packages/modules/changelog-roblox), builda junto do
// core, confia direto no proprio manifest (auto-grant, sem fluxo de aprovacao de marketplace).
// process.cwd() e nao import.meta.url de proposito: a profundidade de import.meta.url muda
// entre rodar via tsx (bin/bot.ts) e o build compilado (dist/bin/bot.js), mas o working
// directory do processo (systemd WorkingDirectory, ou packages/core em dev) e sempre a raiz
// do pacote core — mesma logica de db/migrate.ts pra MIGRATIONS_DIR.
const IN_TREE_MODULE_DIR = join(process.cwd(), "..", "modules", "changelog-roblox");
const inTreeManifest = JSON.parse(readFileSync(join(IN_TREE_MODULE_DIR, "sebas.module.json"), "utf8")) as SebasModuleManifest;
const inTreeModuleId = inTreeManifest.id;

const host = new ModuleHost(db, config);
host.start({
  moduleId: inTreeModuleId,
  entryPoints: resolveEntryPoints(IN_TREE_MODULE_DIR, inTreeManifest),
  granted: grantedPermissionsForInTreeModule(inTreeManifest)
});

const INTERACTION_PING = 1;
const INTERACTION_APPLICATION_COMMAND = 2;
const RESPONSE_PONG = 1;
const RESPONSE_DEFERRED_CHANNEL_MESSAGE = 5;
const MESSAGE_FLAG_EPHEMERAL = 1 << 6;

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, service: "sebas-bot" }));

app.route("/api/admin", createAdminApiRouter({ db, config, host, dataDir: dirname(config.dbPath), inTreeModuleId }));

app.post("/interactions", async (c) => {
  const body = await c.req.text();
  const signature = c.req.header("x-signature-ed25519");
  const timestamp = c.req.header("x-signature-timestamp");
  if (!verifySignature(signature, timestamp, body, config.discordPublicKey)) {
    console.warn("Invalid Discord signature.");
    return c.text("invalid request signature", 401);
  }

  let interaction: {
    type: number;
    data?: { name?: string };
    application_id: string;
    token: string;
  };
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
  const knownCommands = await host.listDiscordCommands(inTreeModuleId).catch(() => []);
  if (!commandName || !knownCommands.some((definition) => definition.name === commandName)) {
    return c.json({ type: 4, data: { content: "Comando desconhecido.", flags: MESSAGE_FLAG_EPHEMERAL } });
  }

  // Deferido: o modulo responde de verdade depois, via ctx.discord.editInteractionResponse
  // (PATCH assincrono no /webhooks/.../messages/@original) — ver discord-commands.ts do modulo.
  void host.handleDiscordCommand(inTreeModuleId, commandName, interaction).catch((error) => {
    console.error(`Discord command "${commandName}" failed:`, error);
  });
  return c.json({ type: RESPONSE_DEFERRED_CHANNEL_MESSAGE, data: { flags: MESSAGE_FLAG_EPHEMERAL } });
});

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
