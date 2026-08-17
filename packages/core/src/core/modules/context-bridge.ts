import type { DatabaseSync } from "node:sqlite";
import type { CoreConfig } from "../config/env.js";
import { resolveActiveAiProvider } from "../ai/registry.js";
import { editDiscordInteractionOriginalResponse, sendDiscordChannelMessage, sendDiscordDirectMessage } from "../discord/client.js";
import { logRun } from "../logging.js";
import type { SebasSqlColumnType, SebasSqlRow, SebasSqlSelectOptions, SebasSqlValue } from "./types.js";

/** O que um modulo de fato tem liberado — computado a partir de module_grants (marketplace) ou,
 * pros modulos in-tree, direto do manifest (auto-concedido, sem fluxo de aprovacao). */
export interface GrantedPermissions {
  networkDomains: Set<string>;
  discordPermissions: Set<string>;
  hasAiProvider: boolean;
  hasStorage: boolean;
}

export interface ContextBridgeDeps {
  db: DatabaseSync;
  config: CoreConfig;
  moduleId: string;
  granted: GrantedPermissions;
  /** true durante o self-test de instalacao: so storage.* e liberado, o resto rejeita. */
  installSandbox?: boolean;
}

const SQL_COLUMN_TYPES: Record<SebasSqlColumnType, string> = { text: "TEXT", integer: "INTEGER", real: "REAL" };
const IDENTIFIER_RE = /^[a-z][a-z0-9_]*$/;

// node:sqlite so aceita null/number/bigint/string/Uint8Array como parametro — SebasSqlValue
// (o SDK que os modulos veem) tambem permite boolean, entao precisa converter pra 0/1 aqui.
function toSqlInput(value: SebasSqlValue): string | number | bigint | null {
  return typeof value === "boolean" ? (value ? 1 : 0) : value;
}

export class PermissionDeniedError extends Error {}

export function createContextBridge(deps: ContextBridgeDeps) {
  const physicalTable = (table: string): string => {
    if (!IDENTIFIER_RE.test(table)) {
      throw new Error(`Invalid table name: ${table}`);
    }
    return `mod_${deps.moduleId.replace(/[^a-z0-9]/gi, "_")}_${table}`;
  };

  const requireGrantedFor = (capability: "network" | "discord" | "ai" | "storage") => {
    if (deps.installSandbox && capability !== "storage") {
      throw new PermissionDeniedError(`${capability} is not available during install self-test.`);
    }
  };

  async function call(fn: string, args: unknown[]): Promise<unknown> {
    switch (fn) {
      case "logger.info":
      case "logger.warn":
      case "logger.error": {
        const [message, meta] = args as [string, Record<string, unknown> | undefined];
        logRun(deps.db, {
          level: fn === "logger.info" ? "info" : fn === "logger.warn" ? "warn" : "error",
          context: "module",
          moduleId: deps.moduleId,
          message,
          meta
        });
        return undefined;
      }

      case "storage.get": {
        const [key] = args as [string];
        const row = deps.db.prepare("SELECT value FROM module_storage WHERE module_id = ? AND key = ?").get(deps.moduleId, key) as
          | { value: string }
          | undefined;
        return row ? JSON.parse(row.value) : null;
      }
      case "storage.set": {
        const [key, value] = args as [string, unknown];
        deps.db
          .prepare(
            `INSERT INTO module_storage (module_id, key, value, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(module_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
          )
          .run(deps.moduleId, key, JSON.stringify(value), new Date().toISOString());
        return undefined;
      }
      case "storage.delete": {
        const [key] = args as [string];
        deps.db.prepare("DELETE FROM module_storage WHERE module_id = ? AND key = ?").run(deps.moduleId, key);
        return undefined;
      }
      case "storage.list": {
        const [prefix] = args as [string | undefined];
        const rows = deps.db
          .prepare("SELECT key FROM module_storage WHERE module_id = ? AND key LIKE ?")
          .all(deps.moduleId, `${prefix ?? ""}%`) as Array<{ key: string }>;
        return rows.map((row) => row.key);
      }

      case "config.get": {
        const [key] = args as [string];
        const row = deps.db.prepare("SELECT value FROM module_config WHERE module_id = ? AND key = ?").get(deps.moduleId, key) as
          | { value: string }
          | undefined;
        return row ? JSON.parse(row.value) : null;
      }
      case "config.set": {
        const [key, value] = args as [string, unknown];
        deps.db
          .prepare(
            `INSERT INTO module_config (module_id, key, value, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(module_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
          )
          .run(deps.moduleId, key, JSON.stringify(value), new Date().toISOString());
        return undefined;
      }

      case "sql.createTable": {
        requireGrantedFor("storage");
        const [table, columns] = args as [string, Record<string, SebasSqlColumnType>];
        const columnDefs = Object.entries(columns)
          .map(([name, type]) => {
            if (!IDENTIFIER_RE.test(name)) throw new Error(`Invalid column name: ${name}`);
            return `"${name}" ${SQL_COLUMN_TYPES[type]}`;
          })
          .join(", ");
        deps.db.exec(`CREATE TABLE IF NOT EXISTS "${physicalTable(table)}" (id INTEGER PRIMARY KEY AUTOINCREMENT, ${columnDefs})`);
        return undefined;
      }
      case "sql.insert": {
        requireGrantedFor("storage");
        const [table, row] = args as [string, SebasSqlRow];
        const columns = Object.keys(row);
        const placeholders = columns.map(() => "?").join(", ");
        const result = deps.db
          .prepare(`INSERT INTO "${physicalTable(table)}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`)
          .run(...columns.map((c) => toSqlInput(row[c])));
        return { id: Number(result.lastInsertRowid) };
      }
      case "sql.select": {
        requireGrantedFor("storage");
        const [table, options] = args as [string, SebasSqlSelectOptions | undefined];
        const conditions: string[] = [];
        const params: SebasSqlValue[] = [];
        for (const [column, value] of Object.entries(options?.where ?? {})) {
          if (!IDENTIFIER_RE.test(column)) throw new Error(`Invalid column name: ${column}`);
          conditions.push(`"${column}" = ?`);
          params.push(value);
        }
        if (options?.cursor !== undefined) {
          conditions.push("id > ?");
          params.push(options.cursor);
        }
        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const order = options?.orderDirection === "desc" ? "DESC" : "ASC";
        const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500);
        return deps.db
          .prepare(`SELECT * FROM "${physicalTable(table)}" ${where} ORDER BY id ${order} LIMIT ?`)
          .all(...params.map(toSqlInput), limit);
      }
      case "sql.update": {
        requireGrantedFor("storage");
        const [table, where, patch] = args as [string, Record<string, SebasSqlValue>, SebasSqlRow];
        const whereEntries = Object.entries(where);
        const patchEntries = Object.entries(patch);
        for (const [column] of [...whereEntries, ...patchEntries]) {
          if (!IDENTIFIER_RE.test(column)) throw new Error(`Invalid column name: ${column}`);
        }
        const setClause = patchEntries.map(([column]) => `"${column}" = ?`).join(", ");
        const whereClause = whereEntries.map(([column]) => `"${column}" = ?`).join(" AND ");
        const result = deps.db
          .prepare(`UPDATE "${physicalTable(table)}" SET ${setClause} WHERE ${whereClause}`)
          .run(...patchEntries.map(([, value]) => toSqlInput(value)), ...whereEntries.map(([, value]) => toSqlInput(value)));
        return { changes: result.changes };
      }
      case "sql.delete": {
        requireGrantedFor("storage");
        const [table, where] = args as [string, Record<string, SebasSqlValue>];
        const whereEntries = Object.entries(where);
        for (const [column] of whereEntries) {
          if (!IDENTIFIER_RE.test(column)) throw new Error(`Invalid column name: ${column}`);
        }
        const whereClause = whereEntries.map(([column]) => `"${column}" = ?`).join(" AND ");
        const result = deps.db
          .prepare(`DELETE FROM "${physicalTable(table)}" WHERE ${whereClause}`)
          .run(...whereEntries.map(([, value]) => toSqlInput(value)));
        return { changes: result.changes };
      }

      case "fetch": {
        requireGrantedFor("network");
        const [url, init] = args as [string, { method?: string; headers?: Record<string, string>; body?: string } | undefined];
        const hostname = new URL(url).hostname;
        if (!deps.granted.networkDomains.has(hostname)) {
          throw new PermissionDeniedError(`Module "${deps.moduleId}" is not allowed to reach "${hostname}".`);
        }
        const response = await fetch(url, init);
        const bodyText = await response.text();
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });
        // Plain, structured-clonable data only — this crosses a worker_threads postMessage
        // boundary, and functions (like the text()/json() the module actually calls) can't
        // survive that. context-in-worker.ts rebuilds those wrapper functions on its side.
        return { status: response.status, headers, bodyText };
      }

      case "discord.sendChannelMessage": {
        requireGrantedFor("discord");
        if (!deps.granted.discordPermissions.has("send-messages")) {
          throw new PermissionDeniedError(`Module "${deps.moduleId}" does not have the "send-messages" grant.`);
        }
        const [channelId, content] = args as [string, { content?: string; embeds?: unknown[]; mentionRoleIds?: string[] }];
        await sendDiscordChannelMessage(deps.config.discordBotToken, channelId, buildDiscordMessage(content));
        return undefined;
      }
      case "discord.sendDm": {
        requireGrantedFor("discord");
        if (!deps.granted.discordPermissions.has("send-messages")) {
          throw new PermissionDeniedError(`Module "${deps.moduleId}" does not have the "send-messages" grant.`);
        }
        const [discordUserId, content] = args as [string, { content?: string; embeds?: unknown[] }];
        await sendDiscordDirectMessage(deps.config.discordBotToken, discordUserId, content.content ?? "");
        return undefined;
      }
      case "discord.editInteractionResponse": {
        requireGrantedFor("discord");
        if (!deps.granted.discordPermissions.has("edit-interactions")) {
          throw new PermissionDeniedError(`Module "${deps.moduleId}" does not have the "edit-interactions" grant.`);
        }
        const [applicationId, interactionToken, content] = args as [string, string, { content?: string; embeds?: unknown[] }];
        await editDiscordInteractionOriginalResponse(applicationId, interactionToken, content);
        return undefined;
      }

      case "ai.run": {
        requireGrantedFor("ai");
        if (!deps.granted.hasAiProvider) {
          return { ok: false, error: `Module "${deps.moduleId}" does not have an AI provider dependency granted.` };
        }
        const provider = resolveActiveAiProvider(deps.db, deps.config);
        if (!provider) {
          return { ok: false, error: "No AI provider is configured yet." };
        }
        const [request] = args as [Parameters<typeof provider.run>[0]];
        return provider.run(request);
      }

      default:
        throw new Error(`Unknown context call: ${fn}`);
    }
  }

  return { call };
}

function buildDiscordMessage(content: { content?: string; embeds?: unknown[]; mentionRoleIds?: string[] }) {
  return {
    content: content.content,
    embeds: content.embeds,
    allowed_mentions: content.mentionRoleIds?.length ? { parse: [], roles: content.mentionRoleIds } : { parse: [] }
  };
}
