/** Contrato publico do Sebas para modulos. Espelha sebas-types.ts, que os modulos vendorizam
 * como um SDK de terceiro — o core e' quem implementa esse contrato de verdade (ver context-bridge.ts). */

export interface SebasModuleLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface SebasModuleStorage {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export interface SebasModuleConfig {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
}

export type SebasModuleFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{
  status: number;
  headers: Record<string, string>;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}>;

export interface SebasModuleDiscord {
  sendChannelMessage(channelId: string, content: { content?: string; embeds?: unknown[]; mentionRoleIds?: string[] }): Promise<void>;
  sendDm(discordUserId: string, content: { content?: string; embeds?: unknown[] }): Promise<void>;
  editInteractionResponse(applicationId: string, interactionToken: string, content: { content?: string; embeds?: unknown[] }): Promise<void>;
}

export interface SebasModuleAiRequest {
  systemPrompt?: string;
  userPrompt: string;
  jsonSchema?: Record<string, unknown>;
  jsonSchemaName?: string;
  maxOutputTokens?: number;
  temperature?: number;
  usePersona?: boolean;
}

export interface SebasModuleAiResult {
  ok: boolean;
  json?: unknown;
  text?: string;
  error?: string;
}

export interface SebasModuleAi {
  run(request: SebasModuleAiRequest): Promise<SebasModuleAiResult>;
}

export type SebasSqlColumnType = "text" | "integer" | "real";
export type SebasSqlValue = string | number | boolean | null;
export interface SebasSqlRow {
  [column: string]: SebasSqlValue;
}
export interface SebasSqlSelectOptions {
  where?: Record<string, SebasSqlValue>;
  orderDirection?: "asc" | "desc";
  cursor?: number;
  limit?: number;
}
export interface SebasModuleSql {
  createTable(table: string, columns: Record<string, SebasSqlColumnType>): Promise<void>;
  insert(table: string, row: SebasSqlRow): Promise<{ id: number }>;
  select(table: string, options?: SebasSqlSelectOptions): Promise<Array<SebasSqlRow & { id: number }>>;
  update(table: string, where: Record<string, SebasSqlValue>, patch: SebasSqlRow): Promise<{ changes: number }>;
  delete(table: string, where: Record<string, SebasSqlValue>): Promise<{ changes: number }>;
}

export interface SebasModuleContext {
  moduleId: string;
  logger: SebasModuleLogger;
  storage: SebasModuleStorage;
  config: SebasModuleConfig;
  sql: SebasModuleSql;
  fetch: SebasModuleFetch;
  discord: SebasModuleDiscord;
  ai: SebasModuleAi | null;
}

export interface SebasControllerRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}

export interface SebasControllerResponse {
  status: number;
  body: unknown;
}

export interface SebasModuleController {
  handleRequest(ctx: SebasModuleContext, req: SebasControllerRequest): Promise<SebasControllerResponse>;
  selfTest(ctx: SebasModuleContext): Promise<void>;
}

export interface SebasModuleChronos {
  run(ctx: SebasModuleContext): Promise<void>;
}

export interface SebasModuleDiscordCommandDefinition {
  name: string;
  description: string;
}

export interface SebasModuleDiscordCommands {
  commands: SebasModuleDiscordCommandDefinition[];
  handleCommand(ctx: SebasModuleContext, commandName: string, interaction: unknown): Promise<{ content: string } | void>;
}

/** Definicao de tool no formato de function-calling OpenAI-compatible (o que OpenCode Zen/DeepSeek
 * e o fine-tune do Qwen tambem falam) — mesmo schema que vai dentro de `tools` no request de chat. */
export interface SebasToolDefinition {
  name: string;
  description: string;
  /** JSON Schema de objeto (campo "parameters" do function-calling). */
  parameters: Record<string, unknown>;
}

export interface SebasToolCallResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface SebasModuleTools {
  tools: SebasToolDefinition[];
  callTool(ctx: SebasModuleContext, name: string, args: Record<string, unknown>): Promise<SebasToolCallResult>;
}

/** Permissoes declaradas no manifest (sebas.module.json) — o que o modulo PODE pedir. */
export interface ModulePermissions {
  adminScopes?: string[];
  providesScopes?: string[];
  network?: { domains: string[] };
  storage?: { kind?: "kv" | "sql"; maxMb: number };
  discordPermissions?: string[];
}

export type ModuleCapability = "controller" | "cron" | "ui" | "discordCommands" | "tools" | "aiProvider" | "storage" | "webhook";

export interface SebasModuleManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  version: string;
  sebasCompat: string;
  repoUrl: string;
  capabilities: ModuleCapability[];
  entryPoints: Record<string, string | undefined>;
  cron?: { schedule: string; timeoutMs?: number };
  discordCommands?: { commands: string[] };
  webhook?: { publicPath: string };
  permissions?: ModulePermissions;
  dependencies?: { aiProvider?: string };
  resources: { maxMemoryMb: number };
}

/** O que foi de fato concedido a um modulo instalado — subconjunto de ModulePermissions,
 * um item por valor concedido (ver migration 0004_module_marketplace.sql). */
export type ModuleGrantType = "adminScope" | "providesScope" | "networkDomain" | "storage" | "discordPermission" | "aiProviderDependency";

export interface PermissionDiffItem {
  grantType: ModuleGrantType;
  grantValue: string;
}
