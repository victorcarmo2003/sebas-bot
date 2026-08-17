/** Entrypoint da worker_thread de um modulo. O host faz `new Worker("runner.js", { workerData })`
 * — este arquivo roda isolado, importa dinamicamente os JS compilados do modulo (por caminho
 * absoluto, vindos de workerData.entryPoints) e despacha os comandos que o host manda. */
import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { createWorkerContext, handleCtxReply } from "./context-in-worker.js";
import type { HostToWorkerMessage, WorkerRunnerData, WorkerToHostMessage } from "./worker-protocol.js";
import type {
  SebasControllerRequest,
  SebasModuleChronos,
  SebasModuleController,
  SebasModuleDiscordCommands,
  SebasModulePermissionGate,
  SebasModuleTools
} from "./types.js";

if (!parentPort) {
  throw new Error("runner.ts must run inside a worker_thread.");
}
const port = parentPort;
const data = workerData as WorkerRunnerData;
const ctx = createWorkerContext(data.moduleId);

async function loadDefault<T>(path: string | undefined): Promise<T | null> {
  if (!path) return null;
  // pathToFileURL: import() dinamico exige URL file:// em ESM — um path absoluto do Windows
  // (ex. "D:\...") nao e' aceito direto pelo loader (ver ERR_UNSUPPORTED_ESM_URL_SCHEME).
  const mod = (await import(pathToFileURL(path).href)) as { default: T };
  return mod.default;
}

const controllerPromise = loadDefault<SebasModuleController>(data.entryPoints.controller);
const chronosPromise = loadDefault<SebasModuleChronos>(data.entryPoints.chronos);
const discordCommandsPromise = loadDefault<SebasModuleDiscordCommands>(data.entryPoints.discordCommands);
const toolsPromise = loadDefault<SebasModuleTools>(data.entryPoints.tools);
const permissionGatePromise = loadDefault<SebasModulePermissionGate>(data.entryPoints.permissionGate);

function reply(callId: string, ok: true, result: unknown): void;
function reply(callId: string, ok: false, error: string): void;
function reply(callId: string, ok: boolean, resultOrError: unknown): void {
  const message: WorkerToHostMessage = ok
    ? { type: "invoke-result", callId, ok: true, result: resultOrError }
    : { type: "invoke-result", callId, ok: false, error: String(resultOrError) };
  port.postMessage(message);
}

port.on("message", (message: HostToWorkerMessage) => {
  void handleMessage(message);
});

async function handleMessage(message: HostToWorkerMessage): Promise<void> {
  if (message.type === "ctx-reply") {
    handleCtxReply(message);
    return;
  }

  try {
    switch (message.type) {
      case "invoke-selftest": {
        const controller = await controllerPromise;
        if (!controller) throw new Error("Module has no controller entrypoint.");
        await controller.selfTest(ctx);
        reply(message.callId, true, undefined);
        return;
      }
      case "invoke-controller": {
        const controller = await controllerPromise;
        if (!controller) throw new Error("Module has no controller entrypoint.");
        const response = await controller.handleRequest(ctx, message.req as SebasControllerRequest);
        reply(message.callId, true, response);
        return;
      }
      case "invoke-chronos": {
        const chronos = await chronosPromise;
        if (!chronos) throw new Error("Module has no chronos entrypoint.");
        await chronos.run(ctx);
        reply(message.callId, true, undefined);
        return;
      }
      case "invoke-discord-command": {
        const discordCommands = await discordCommandsPromise;
        if (!discordCommands) throw new Error("Module has no discordCommands entrypoint.");
        const result = await discordCommands.handleCommand(ctx, message.commandName, message.interaction);
        reply(message.callId, true, result ?? null);
        return;
      }
      case "list-discord-commands": {
        const discordCommands = await discordCommandsPromise;
        reply(message.callId, true, discordCommands?.commands ?? []);
        return;
      }
      case "invoke-tool": {
        const tools = await toolsPromise;
        if (!tools) throw new Error("Module has no tools entrypoint.");
        const result = await tools.callTool(ctx, message.toolName, message.args);
        reply(message.callId, true, result);
        return;
      }
      case "list-tools": {
        const tools = await toolsPromise;
        reply(message.callId, true, tools?.tools ?? []);
        return;
      }
      case "invoke-permission-gate": {
        const gate = await permissionGatePromise;
        if (!gate) throw new Error("Module has no permissionGate entrypoint.");
        const result = await gate.checkGate(ctx, message.req);
        reply(message.callId, true, result);
        return;
      }
    }
  } catch (error) {
    reply(message.callId, false, error instanceof Error ? error.message : String(error));
  }
}
