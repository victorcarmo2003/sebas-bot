import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { DatabaseSync } from "node:sqlite";
import type { SebasToolCallResult, SebasToolDefinition } from "../modules/types.js";
import type { ToolProvider } from "../tools/registry.js";

export interface McpServerRow {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command: string | null;
  args: string[];
  url: string | null;
  env: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface RawMcpServerRow {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command: string | null;
  args: string;
  url: string | null;
  env: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function toRow(row: RawMcpServerRow): McpServerRow {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport,
    command: row.command,
    args: JSON.parse(row.args),
    url: row.url,
    env: JSON.parse(row.env),
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listMcpServers(db: DatabaseSync): McpServerRow[] {
  return (db.prepare("SELECT * FROM mcp_servers ORDER BY created_at ASC").all() as unknown as RawMcpServerRow[]).map(toRow);
}

export interface CreateMcpServerInput {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export function createMcpServer(db: DatabaseSync, input: CreateMcpServerInput): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO mcp_servers (id, name, transport, command, args, url, env, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    input.id,
    input.name,
    input.transport,
    input.command ?? null,
    JSON.stringify(input.args ?? []),
    input.url ?? null,
    JSON.stringify(input.env ?? {}),
    now,
    now
  );
}

export function deleteMcpServer(db: DatabaseSync, id: string): void {
  db.prepare("DELETE FROM mcp_servers WHERE id = ?").run(id);
}

/**
 * Gerencia conexoes com servidores MCP externos, configurados em `mcp_servers`. Cada servidor
 * vira um ToolProvider (namespace "mcp:<id>") pro ToolRegistry.
 *
 * Risco conhecido, igual ao build de modulo em installer.ts: transporte "stdio" spawna um
 * processo arbitrario com privilegio total do host — nao ha sandbox aqui, so quem tem acesso
 * a "modules:manage" pode cadastrar servidores MCP, e' preciso confiar no comando cadastrado.
 */
export class McpClientManager {
  private readonly clients = new Map<string, Client>();

  async connect(config: McpServerRow): Promise<void> {
    if (this.clients.has(config.id)) {
      await this.disconnect(config.id);
    }
    const client = new Client({ name: "sebas-bot", version: "0.1.0" });
    const transport =
      config.transport === "stdio"
        ? new StdioClientTransport({ command: requireCommand(config), args: config.args, env: config.env })
        : new StreamableHTTPClientTransport(new URL(requireUrl(config)));
    await client.connect(transport);
    this.clients.set(config.id, client);
  }

  async disconnect(id: string): Promise<void> {
    const client = this.clients.get(id);
    if (!client) return;
    await client.close();
    this.clients.delete(id);
  }

  isConnected(id: string): boolean {
    return this.clients.has(id);
  }

  connectedServerIds(): string[] {
    return [...this.clients.keys()];
  }

  toolProvider(id: string): ToolProvider {
    return {
      namespace: `mcp:${id}`,
      listTools: async () => {
        const client = this.clients.get(id);
        if (!client) return [];
        const { tools } = await client.listTools();
        return tools.map(
          (tool): SebasToolDefinition => ({
            name: tool.name,
            description: tool.description ?? "",
            parameters: tool.inputSchema as Record<string, unknown>
          })
        );
      },
      callTool: async (name, args): Promise<SebasToolCallResult> => {
        const client = this.clients.get(id);
        if (!client) return { ok: false, error: `MCP server "${id}" is not connected.` };
        const result = await client.callTool({ name, arguments: args });
        const content: unknown[] = "content" in result && Array.isArray(result.content) ? result.content : [];
        const text = content
          .filter((item): item is { type: "text"; text: string } => Boolean(item) && (item as { type?: unknown }).type === "text")
          .map((item) => item.text)
          .join("\n");
        if ("isError" in result && result.isError) {
          return { ok: false, error: text || "MCP tool call failed." };
        }
        return { ok: true, result: text ? tryParseJson(text) : content };
      }
    };
  }
}

function requireCommand(config: McpServerRow): string {
  if (!config.command) throw new Error(`MCP server "${config.id}" has transport "stdio" but no command configured.`);
  return config.command;
}

function requireUrl(config: McpServerRow): string {
  if (!config.url) throw new Error(`MCP server "${config.id}" has transport "http" but no url configured.`);
  return config.url;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
