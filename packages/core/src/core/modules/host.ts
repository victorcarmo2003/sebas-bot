import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type { DatabaseSync } from "node:sqlite";
import type { CoreConfig } from "../config/env.js";
import { createContextBridge, type GrantedPermissions } from "./context-bridge.js";
import type { HostToWorkerMessage, WorkerRunnerData, WorkerToHostMessage } from "./worker-protocol.js";
import type {
  SebasControllerRequest,
  SebasControllerResponse,
  SebasModuleDiscordCommandDefinition,
  SebasToolCallResult,
  SebasToolDefinition
} from "./types.js";

// tsx propaga o loader de .ts pra worker_threads no mesmo processo, entao em dev isso resolve
// pra runner.ts; no build compilado (dist/), resolve pro runner.js irmao. Ver runner.ts.
const RUNNER_URL = new URL("./runner.js", import.meta.url);

interface RunningModule {
  worker: Worker;
  granted: GrantedPermissions;
  installSandbox: boolean;
}

export interface StartModuleParams {
  moduleId: string;
  entryPoints: WorkerRunnerData["entryPoints"];
  granted: GrantedPermissions;
  /** true so durante o self-test de instalacao — nenhuma permissao de rede/discord/ai liberada. */
  installSandbox?: boolean;
}

/** Dono do ciclo de vida das worker_threads de cada modulo rodando (in-tree ou instalado via
 * marketplace) e do roteamento das chamadas de SebasModuleContext de volta pro contexto real. */
export class ModuleHost {
  private readonly running = new Map<string, RunningModule>();
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly config: CoreConfig
  ) {}

  start(params: StartModuleParams): void {
    if (this.running.has(params.moduleId)) {
      this.stop(params.moduleId);
    }

    const workerData: WorkerRunnerData = { moduleId: params.moduleId, entryPoints: params.entryPoints };
    const worker = new Worker(RUNNER_URL, { workerData });
    const bridge = createContextBridge({
      db: this.db,
      config: this.config,
      moduleId: params.moduleId,
      granted: params.granted,
      installSandbox: params.installSandbox
    });

    worker.on("message", (message: WorkerToHostMessage) => {
      void this.handleWorkerMessage(params.moduleId, bridge, message);
    });
    worker.on("error", (error) => {
      console.error(`Module "${params.moduleId}" worker crashed:`, error);
    });

    this.running.set(params.moduleId, { worker, granted: params.granted, installSandbox: Boolean(params.installSandbox) });
  }

  stop(moduleId: string): void {
    const running = this.running.get(moduleId);
    if (!running) return;
    void running.worker.terminate();
    this.running.delete(moduleId);
  }

  isRunning(moduleId: string): boolean {
    return this.running.has(moduleId);
  }

  listRunningModuleIds(): string[] {
    return [...this.running.keys()];
  }

  async runSelfTest(moduleId: string): Promise<void> {
    await this.call(moduleId, { type: "invoke-selftest", callId: randomUUID() });
  }

  async handleControllerRequest(moduleId: string, req: SebasControllerRequest): Promise<SebasControllerResponse> {
    return (await this.call(moduleId, { type: "invoke-controller", callId: randomUUID(), req })) as SebasControllerResponse;
  }

  async runChronos(moduleId: string): Promise<void> {
    await this.call(moduleId, { type: "invoke-chronos", callId: randomUUID() });
  }

  async handleDiscordCommand(moduleId: string, commandName: string, interaction: unknown): Promise<{ content: string } | null> {
    return (await this.call(moduleId, { type: "invoke-discord-command", callId: randomUUID(), commandName, interaction })) as {
      content: string;
    } | null;
  }

  async listDiscordCommands(moduleId: string): Promise<SebasModuleDiscordCommandDefinition[]> {
    return (await this.call(moduleId, { type: "list-discord-commands", callId: randomUUID() })) as SebasModuleDiscordCommandDefinition[];
  }

  async listTools(moduleId: string): Promise<SebasToolDefinition[]> {
    return (await this.call(moduleId, { type: "list-tools", callId: randomUUID() })) as SebasToolDefinition[];
  }

  async callTool(moduleId: string, toolName: string, args: Record<string, unknown>): Promise<SebasToolCallResult> {
    return (await this.call(moduleId, { type: "invoke-tool", callId: randomUUID(), toolName, args })) as SebasToolCallResult;
  }

  private call(moduleId: string, message: Extract<HostToWorkerMessage, { type: string }>): Promise<unknown> {
    const running = this.running.get(moduleId);
    if (!running) {
      return Promise.reject(new Error(`Module "${moduleId}" is not running.`));
    }
    return new Promise((resolve, reject) => {
      this.pending.set(message.callId, { resolve, reject });
      running.worker.postMessage(message);
    });
  }

  private async handleWorkerMessage(
    moduleId: string,
    bridge: ReturnType<typeof createContextBridge>,
    message: WorkerToHostMessage
  ): Promise<void> {
    if (message.type === "invoke-result") {
      const waiter = this.pending.get(message.callId);
      if (!waiter) return;
      this.pending.delete(message.callId);
      if (message.ok) {
        waiter.resolve(message.result);
      } else {
        waiter.reject(new Error(message.error));
      }
      return;
    }

    // ctx-call: o modulo, dentro da worker, chamou algo do SebasModuleContext. So o host tem
    // acesso real ao db/rede/discord — executa aqui, com enforcement de permissao, e responde.
    const running = this.running.get(moduleId);
    if (!running) return;
    const reply = (payload: HostToWorkerMessage) => running.worker.postMessage(payload);
    try {
      const result = await bridge.call(message.fn, message.args);
      reply({ type: "ctx-reply", callId: message.callId, ok: true, result });
    } catch (error) {
      reply({ type: "ctx-reply", callId: message.callId, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
}
