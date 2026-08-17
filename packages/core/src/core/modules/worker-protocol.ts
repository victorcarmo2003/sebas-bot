/** Mensagens trocadas entre o host (thread principal) e o runner (dentro da worker_thread de
 * cada modulo). Duas direcoes: host -> worker manda "invoke" (rodar um entrypoint), worker -> host
 * manda "ctx-call" (o modulo chamando algo do SebasModuleContext, que so o host pode executar de verdade). */

import type { PermissionGateRequest, PermissionGateResult, SebasControllerRequest, SebasControllerResponse } from "./types.js";

export interface WorkerRunnerData {
  moduleId: string;
  entryPoints: {
    controller?: string;
    chronos?: string;
    discordCommands?: string;
    tools?: string;
    permissionGate?: string;
  };
}

export type HostToWorkerMessage =
  | { type: "invoke-selftest"; callId: string }
  | { type: "invoke-controller"; callId: string; req: SebasControllerRequest }
  | { type: "invoke-chronos"; callId: string }
  | { type: "invoke-discord-command"; callId: string; commandName: string; interaction: unknown }
  | { type: "list-discord-commands"; callId: string }
  | { type: "invoke-tool"; callId: string; toolName: string; args: Record<string, unknown> }
  | { type: "list-tools"; callId: string }
  | { type: "invoke-permission-gate"; callId: string; req: PermissionGateRequest }
  | { type: "ctx-reply"; callId: string; ok: true; result: unknown }
  | { type: "ctx-reply"; callId: string; ok: false; error: string };

export type WorkerToHostMessage =
  | { type: "invoke-result"; callId: string; ok: true; result: unknown }
  | { type: "invoke-result"; callId: string; ok: false; error: string }
  | { type: "ctx-call"; callId: string; fn: string; args: unknown[] };

export type { PermissionGateRequest, PermissionGateResult, SebasControllerRequest, SebasControllerResponse };
