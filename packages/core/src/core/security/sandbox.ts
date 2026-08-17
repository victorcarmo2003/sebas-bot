import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let bwrapChecked = false;
let bwrapAvailable = false;
let warnedNoSandbox = false;

async function hasBubblewrap(): Promise<boolean> {
  if (bwrapChecked) return bwrapAvailable;
  bwrapChecked = true;
  if (process.platform !== "linux") {
    bwrapAvailable = false;
  } else {
    try {
      await execFileAsync("bwrap", ["--version"]);
      bwrapAvailable = true;
    } catch {
      bwrapAvailable = false;
    }
  }
  if (!bwrapAvailable && !warnedNoSandbox) {
    warnedNoSandbox = true;
    console.warn(
      "bubblewrap (bwrap) not available — module builds and MCP stdio servers will run WITHOUT filesystem sandboxing. " +
        "Install bubblewrap on the deploy VM (`apt install bubblewrap`) for real isolation."
    );
  }
  return bwrapAvailable;
}

/**
 * Prefixo bwrap generico: root inteiro read-only, so `writableDir` fica gravavel, /tmp vira
 * tmpfs fresco, PID namespace proprio, morre se o processo pai morrer. NAO isola rede — quem
 * chama isto (installer.ts pro build de modulo, mcp/client.ts pro spawn de servidor stdio)
 * precisa de rede pra funcionar (npm install, protocolo MCP). O ganho aqui e' isolamento de
 * filesystem/capabilities, nao de rede — nao impede o comando de rodar codigo malicioso dentro
 * do que ele consegue ler, so limita o raio de dano de escrita/leitura fora de `writableDir`.
 */
function bwrapArgs(writableDir: string): string[] {
  return [
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
    "--bind",
    writableDir,
    writableDir,
    "--unshare-pid",
    "--die-with-parent",
    "--chdir",
    writableDir
  ];
}

export interface SandboxedCommand {
  command: string;
  args: string[];
}

/**
 * Devolve o command/args de verdade pra rodar, prefixados com bwrap quando disponivel. `command`
 * roda dentro do sandbox com `writableDir` como unico caminho gravavel (cria se nao existir).
 * Sem bwrap, devolve o command/args originais sem mudanca nenhuma (roda direto, sem isolamento).
 */
export async function sandboxCommand(command: string, args: string[], writableDir: string): Promise<SandboxedCommand> {
  mkdirSync(writableDir, { recursive: true });
  if (!(await hasBubblewrap())) {
    return { command, args };
  }
  return { command: "bwrap", args: [...bwrapArgs(writableDir), "--", command, ...args] };
}
