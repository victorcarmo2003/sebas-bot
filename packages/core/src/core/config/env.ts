import "dotenv/config";

export interface CoreConfig {
  discordBotToken: string;
  discordPublicKey: string;
  discordApplicationId: string;
  dbPath: string;
  botPort: number;
  mcpPort: number;
  ownerDiscordId: string;
  panelUrl: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

export function loadCoreConfig(): CoreConfig {
  return {
    discordBotToken: required("DISCORD_BOT_TOKEN"),
    discordPublicKey: required("DISCORD_PUBLIC_KEY"),
    discordApplicationId: required("DISCORD_APPLICATION_ID"),
    dbPath: process.env.DB_PATH || "data/sebas.db",
    botPort: Number.parseInt(process.env.BOT_PORT || "8080", 10),
    mcpPort: Number.parseInt(process.env.MCP_PORT || "8090", 10),
    ownerDiscordId: required("OWNER_DISCORD_ID"),
    panelUrl: process.env.PANEL_URL || "http://127.0.0.1:3000"
  };
}
