import { randomUUID } from "node:crypto";
import { parentPort } from "node:worker_threads";
import type {
  SebasModuleAi,
  SebasModuleConfig,
  SebasModuleContext,
  SebasModuleDiscord,
  SebasModuleFetch,
  SebasModuleLogger,
  SebasModuleSql,
  SebasModuleStorage
} from "./types.js";
import type { HostToWorkerMessage, WorkerToHostMessage } from "./worker-protocol.js";

if (!parentPort) {
  throw new Error("context-in-worker.ts must run inside a worker_thread.");
}
const port = parentPort;

const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

export function handleCtxReply(message: Extract<HostToWorkerMessage, { type: "ctx-reply" }>): boolean {
  const waiter = pending.get(message.callId);
  if (!waiter) return false;
  pending.delete(message.callId);
  if (message.ok) {
    waiter.resolve(message.result);
  } else {
    waiter.reject(new Error(message.error));
  }
  return true;
}

function callHost<T>(fn: string, args: unknown[]): Promise<T> {
  const callId = randomUUID();
  const message: WorkerToHostMessage = { type: "ctx-call", callId, fn, args };
  return new Promise<T>((resolve, reject) => {
    pending.set(callId, { resolve: resolve as (value: unknown) => void, reject });
    port.postMessage(message);
  });
}

export function createWorkerContext(moduleId: string): SebasModuleContext {
  const logger: SebasModuleLogger = {
    info: (message, meta) => void callHost("logger.info", [message, meta]).catch(() => undefined),
    warn: (message, meta) => void callHost("logger.warn", [message, meta]).catch(() => undefined),
    error: (message, meta) => void callHost("logger.error", [message, meta]).catch(() => undefined)
  };

  const storage: SebasModuleStorage = {
    get: (key) => callHost("storage.get", [key]),
    set: (key, value) => callHost("storage.set", [key, value]),
    delete: (key) => callHost("storage.delete", [key]),
    list: (prefix) => callHost("storage.list", [prefix])
  };

  const config: SebasModuleConfig = {
    get: (key) => callHost("config.get", [key]),
    set: (key, value) => callHost("config.set", [key, value])
  };

  const sql: SebasModuleSql = {
    createTable: (table, columns) => callHost("sql.createTable", [table, columns]),
    insert: (table, row) => callHost("sql.insert", [table, row]),
    select: (table, options) => callHost("sql.select", [table, options]),
    update: (table, where, patch) => callHost("sql.update", [table, where, patch]),
    delete: (table, where) => callHost("sql.delete", [table, where])
  };

  // O host devolve so dado plano (status/headers/bodyText) porque funcoes nao sobrevivem ao
  // postMessage — text()/json() sao reconstruidas aqui, do lado de dentro da worker.
  const moduleFetch: SebasModuleFetch = async (url, init) => {
    const raw = await callHost<{ status: number; headers: Record<string, string>; bodyText: string }>("fetch", [url, init]);
    return {
      status: raw.status,
      headers: raw.headers,
      text: async () => raw.bodyText,
      json: async () => JSON.parse(raw.bodyText)
    };
  };

  const discord: SebasModuleDiscord = {
    sendChannelMessage: (channelId, content) => callHost("discord.sendChannelMessage", [channelId, content]),
    sendDm: (discordUserId, content) => callHost("discord.sendDm", [discordUserId, content]),
    editInteractionResponse: (applicationId, interactionToken, content) =>
      callHost("discord.editInteractionResponse", [applicationId, interactionToken, content])
  };

  const ai: SebasModuleAi = {
    run: (request) => callHost("ai.run", [request])
  };

  return { moduleId, logger, storage, config, sql, fetch: moduleFetch, discord, ai };
}
