// Registra os slash commands do core (/sebas) e do modulo in-tree (changelog-roblox) na
// aplicacao do Discord. Roda manualmente (npm run commands:register), nao faz parte do
// runtime do bot/worker.
//
// LIMITACAO CONHECIDA: discord-commands.ts do modulo so exporta { name, description } por
// comando — sem schema de "options" (ex.: o parametro "canal" de /setup, "version" de /teste).
// O payload aqui registra os comandos sem parametros; pra usa-los de verdade no Discord,
// sebas-types.ts / discord-commands.ts do modulo precisam declarar tambem os options do
// slash command (tipo, nome, required) pra esse script montar o payload completo.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const config = {
  applicationId: requiredEnv("DISCORD_APPLICATION_ID"),
  botToken: requiredEnv("DISCORD_BOT_TOKEN")
};

const moduleDir = join(process.cwd(), "..", "modules", "changelog-roblox");
const manifest = JSON.parse(readFileSync(join(moduleDir, "sebas.module.json"), "utf8"));
const discordCommandsEntry = manifest.entryPoints.discordCommands;

const modulePayload = discordCommandsEntry
  ? (await import(join(moduleDir, discordCommandsEntry))).default.commands.map((command) => ({
      name: command.name,
      description: command.description,
      type: 1
    }))
  : [];
if (!discordCommandsEntry) {
  console.log(`Module "${manifest.id}" declares no discordCommands entrypoint — skipping its commands.`);
}

// Comando do proprio core (bin/bot.ts, nao de modulo): conversa livre via agent-loop.
const corePayload = [
  {
    name: "sebas",
    description: "Conversa com o Sebas — ele decide quais tools chamar pra te ajudar.",
    type: 1,
    options: [
      {
        name: "mensagem",
        description: "O que voce quer pedir pro Sebas.",
        type: 3,
        required: true
      }
    ]
  }
];

const payload = [...corePayload, ...modulePayload];

const response = await fetch(`https://discord.com/api/v10/applications/${config.applicationId}/commands`, {
  method: "PUT",
  headers: {
    authorization: `Bot ${config.botToken}`,
    "content-type": "application/json"
  },
  body: JSON.stringify(payload)
});

if (!response.ok) {
  const body = await response.text().catch(() => "");
  throw new Error(`Discord command registration failed with ${response.status}: ${body.slice(0, 500)}`);
}

console.log(`Registered ${payload.length} command(s):`, payload.map((c) => c.name).join(", "));

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
