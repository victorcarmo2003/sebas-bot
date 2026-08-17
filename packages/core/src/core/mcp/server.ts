import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ToolRegistry } from "../tools/registry.js";

/**
 * Expoe as tools do registry (modulos + skills — NAO reexpoe tools consumidas de servidores MCP
 * externos, pra evitar loop) como um servidor MCP proprio, pra qualquer cliente MCP consumir.
 *
 * Roda num http.Server "cru" separado (nao dentro do Hono de bin/bot.ts): o SDK oficial e'
 * feito pra falar direto com IncomingMessage/ServerResponse do Node, e usar isso dentro do
 * adapter do Hono exigiria depender de detalhe interno nao documentado (c.env.incoming/outgoing)
 * so pra economizar uma porta — nao vale a fragilidade.
 */
export function startMcpServer(registry: ToolRegistry, port: number): void {
  const server = new Server({ name: "sebas-bot", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await registry.listQualifiedTools();
    return {
      tools: tools.map(({ qualifiedName, definition }) => ({
        name: qualifiedName,
        description: definition.description,
        inputSchema: definition.parameters as { type: "object"; [key: string]: unknown }
      }))
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const outcome = await registry.callQualifiedTool(request.params.name, (request.params.arguments ?? {}) as Record<string, unknown>);
    if (!outcome.ok) {
      return { content: [{ type: "text" as const, text: outcome.error ?? "Tool call failed." }], isError: true };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(outcome.result ?? {}) }] };
  });

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
  void server.connect(transport);

  const httpServer = createServer((req, res) => {
    void transport.handleRequest(req, res);
  });
  httpServer.listen(port, () => {
    console.log(`sebas-bot MCP server listening on port ${port}`);
  });
}
