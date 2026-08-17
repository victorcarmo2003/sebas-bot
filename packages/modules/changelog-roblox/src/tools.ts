import type { SebasModuleContext, SebasToolCallResult } from "./sebas-types.js";
import { loadGuildConfig } from "./guild-storage.js";
import { getPosted, listPosted } from "./history.js";
import { enrichRobloxUpdate, fetchRobloxUpdateByVersion } from "./roblox-rss.js";
import { loadModuleSettings } from "./settings.js";
import { DEFAULT_RSS_URL } from "./types.js";

async function historicoChangelog(ctx: SebasModuleContext, args: Record<string, unknown>): Promise<SebasToolCallResult> {
  const guildId = typeof args.guildId === "string" ? args.guildId : undefined;
  const limit = typeof args.limit === "number" ? args.limit : undefined;
  const page = await listPosted(ctx, { guildId, limit });
  return { ok: true, result: page };
}

async function configuracaoGuild(ctx: SebasModuleContext, args: Record<string, unknown>): Promise<SebasToolCallResult> {
  const guildId = typeof args.guildId === "string" ? args.guildId : "";
  if (!guildId) return { ok: false, error: "guildId is required." };
  const config = await loadGuildConfig(ctx, guildId);
  return config ? { ok: true, result: config } : { ok: false, error: `No configuration found for guild "${guildId}".` };
}

async function buscarChangelogPorVersao(ctx: SebasModuleContext, args: Record<string, unknown>): Promise<SebasToolCallResult> {
  const version = typeof args.version === "string" ? args.version : undefined;
  try {
    const settings = await loadModuleSettings(ctx);
    const update = await fetchRobloxUpdateByVersion(ctx, settings.rssUrl || DEFAULT_RSS_URL, version);
    const enriched = await enrichRobloxUpdate(ctx, update);
    return { ok: true, result: enriched };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function detalheChangelogPostado(ctx: SebasModuleContext, args: Record<string, unknown>): Promise<SebasToolCallResult> {
  const id = typeof args.id === "number" ? args.id : Number(args.id);
  if (!Number.isFinite(id)) return { ok: false, error: "id must be a number." };
  const row = await getPosted(ctx, id);
  return row ? { ok: true, result: row } : { ok: false, error: `No posted changelog with id ${id}.` };
}

export default {
  tools: [
    {
      name: "historico_changelog",
      description: "Lista os changelogs do Roblox ja postados, opcionalmente filtrado por servidor.",
      parameters: {
        type: "object",
        properties: {
          guildId: { type: "string", description: "ID do servidor Discord (opcional, lista de todos se omitido)." },
          limit: { type: "number", description: "Quantidade maxima de itens (padrao 25, maximo 100)." }
        },
        additionalProperties: false
      }
    },
    {
      name: "configuracao_guild",
      description: "Consulta o canal e configuracao de mencao de cargo do changelog automatico num servidor.",
      parameters: {
        type: "object",
        properties: { guildId: { type: "string", description: "ID do servidor Discord." } },
        required: ["guildId"],
        additionalProperties: false
      }
    },
    {
      name: "buscar_changelog_por_versao",
      description: "Busca o changelog do Roblox de uma versao especifica (ou o mais recente, se omitido).",
      parameters: {
        type: "object",
        properties: { version: { type: "string", description: "Numero da versao (ex. 725). Omitir pra pegar o mais recente." } },
        additionalProperties: false
      }
    },
    {
      name: "detalhe_changelog_postado",
      description: "Busca os detalhes de um changelog ja postado, pelo id retornado por historico_changelog.",
      parameters: {
        type: "object",
        properties: { id: { type: "number", description: "id do registro (ver historico_changelog)." } },
        required: ["id"],
        additionalProperties: false
      }
    }
  ],
  async callTool(ctx: SebasModuleContext, name: string, args: Record<string, unknown>): Promise<SebasToolCallResult> {
    switch (name) {
      case "historico_changelog":
        return historicoChangelog(ctx, args);
      case "configuracao_guild":
        return configuracaoGuild(ctx, args);
      case "buscar_changelog_por_versao":
        return buscarChangelogPorVersao(ctx, args);
      case "detalhe_changelog_postado":
        return detalheChangelogPostado(ctx, args);
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  }
};
