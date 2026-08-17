import type { SebasToolCallResult, SebasToolDefinition } from "../modules/types.js";
import type { ModuleHost } from "../modules/host.js";

/** Uma fonte de tools — modulo, servidor MCP ou skills — todas expostas sob o mesmo formato
 * OpenAI-compatible (SebasToolDefinition). O registry so agrega e qualifica os nomes; quem
 * sabe executar de verdade e' o provider. */
export interface ToolProvider {
  /** Prefixo do nome qualificado, ex. "module:changelog-roblox", "mcp:my-server", "skill". */
  namespace: string;
  listTools(): Promise<SebasToolDefinition[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<SebasToolCallResult>;
}

export interface QualifiedTool {
  qualifiedName: string;
  definition: SebasToolDefinition;
}

/** Agrega tools de todas as fontes sob nomes unicos (namespace:tool). Providers sao resolvidos
 * via callback (nao lista fixa) porque modulos habilitados/servidores MCP mudam em runtime
 * (enable/disable, install/uninstall) — cada listagem/chamada pega o conjunto atual. */
export class ToolRegistry {
  constructor(private readonly getProviders: () => ToolProvider[]) {}

  async listQualifiedTools(): Promise<QualifiedTool[]> {
    const providers = this.getProviders();
    const perProvider = await Promise.all(
      providers.map(async (provider) => {
        const tools = await provider.listTools().catch((error) => {
          console.warn(`Failed to list tools from "${provider.namespace}":`, error);
          return [] as SebasToolDefinition[];
        });
        return tools.map((definition) => ({ qualifiedName: `${provider.namespace}:${definition.name}`, definition }));
      })
    );
    return perProvider.flat();
  }

  async callQualifiedTool(qualifiedName: string, args: Record<string, unknown>): Promise<SebasToolCallResult> {
    const separatorIndex = qualifiedName.lastIndexOf(":");
    if (separatorIndex === -1) {
      return { ok: false, error: `Invalid qualified tool name: ${qualifiedName}` };
    }
    const namespace = qualifiedName.slice(0, separatorIndex);
    const toolName = qualifiedName.slice(separatorIndex + 1);
    const provider = this.getProviders().find((candidate) => candidate.namespace === namespace);
    if (!provider) {
      return { ok: false, error: `Unknown tool namespace: ${namespace}` };
    }
    try {
      return await provider.callTool(toolName, args);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export function moduleToolProvider(host: ModuleHost, moduleId: string): ToolProvider {
  return {
    namespace: `module:${moduleId}`,
    listTools: () => host.listTools(moduleId),
    callTool: (name, args) => host.callTool(moduleId, name, args)
  };
}

/** Providers de todos os modulos habilitados no momento da chamada — usar como parte do
 * `getProviders` do ToolRegistry (junto com skills/MCP quando existirem). */
export function moduleToolProviders(host: ModuleHost): ToolProvider[] {
  return host.listRunningModuleIds().map((moduleId) => moduleToolProvider(host, moduleId));
}
