import { exec, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { DatabaseSync } from "node:sqlite";
import { diffAgainstGrantedItems, grantsRequestedByManifest, loadActiveGrantItems, permissionsFromGrantItems } from "./grants.js";
import type { ModuleHost } from "./host.js";
import { createModuleInstall, getModuleInstall, recordModuleEvent, toModuleDetail } from "./marketplace-repo.js";
import type { PermissionDiffItem, SebasModuleManifest } from "./types.js";
import { sandboxCommand } from "../security/sandbox.js";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export async function runGitCommand(args: string[], cwd: string, writableDir: string): Promise<{ stdout: string }> {
  const sandboxed = await sandboxCommand("git", args, writableDir);
  return execFileAsync(sandboxed.command, sandboxed.args, { cwd });
}

export async function runNpmCommand(args: string[], cwd: string, writableDir: string): Promise<void> {
  const sandboxed = await sandboxCommand("npm", args, writableDir);
  if (sandboxed.command !== "npm") {
    // bwrap aplicado (so em Linux) - argv puro e seguro, git/npm nao tem o problema de .cmd la.
    await execFileAsync(sandboxed.command, sandboxed.args, { cwd });
    return;
  }
  // Sem bwrap: npm e' .cmd no Windows, execFile sem shell nao acha o binario — exec() com shell
  // resolve nos dois SOs. Args aqui sao sempre literais fixos, nunca dado do usuario/repoUrl.
  await execAsync(["npm", ...args].join(" "), { cwd });
}

// Versao de compatibilidade que o core anuncia pro marketplace (sebasCompat no manifest, ex.
// "^1.0.0") — desacoplada da versao interna do pacote (@sebas-bot/core em package.json), que
// segue seu proprio ciclo de release. So o major precisa bater.
const CORE_MARKETPLACE_VERSION = "1.0.0";

export function installedModulesDir(dataDir: string): string {
  return join(dataDir, "installed-modules");
}

export interface InstallModuleResult {
  ok: boolean;
  moduleId?: string;
  manifest?: SebasModuleManifest;
  permissionDiff?: PermissionDiffItem[];
  errors: string[];
}

/**
 * Clona o repo, valida o manifest, builda e roda o self-test em sandbox (so ctx.storage,
 * zero rede/discord/ai — ver ContextBridgeDeps.installSandbox) ANTES de qualquer grant.
 * Builda com o gerenciador de pacote do proprio repo do modulo (npm install && npm run build) —
 * isso roda codigo do repo clonado. git clone/npm install/npm run build passam por
 * sandboxCommand() (bubblewrap quando disponivel — so a scratch dir fica gravavel, resto do
 * host so leitura) + `npm install --ignore-scripts` (bloqueia postinstall arbitrario). Nao
 * elimina o risco (o proprio `npm run build`/tsc do modulo ainda roda como codigo dele, e sem
 * bwrap no host isso roda sem isolamento nenhum), so reduz o raio de dano — ver MILESTONES.md M9.
 */
export async function installModule(
  db: DatabaseSync,
  host: ModuleHost,
  dataDir: string,
  repoUrl: string,
  actorDiscordId: string
): Promise<InstallModuleResult> {
  const errors: string[] = [];
  const workDir = join(installedModulesDir(dataDir), `_install_${Date.now()}`);

  try {
    await runGitCommand(["clone", "--depth", "1", repoUrl, workDir], workDir, workDir);
    const { stdout: shaOut } = await runGitCommand(["rev-parse", "HEAD"], workDir, workDir);
    const pinnedSha = shaOut.trim();

    const manifestPath = join(workDir, "sebas.module.json");
    if (!existsSync(manifestPath)) {
      errors.push("Repositorio nao tem sebas.module.json na raiz.");
      return { ok: false, errors };
    }
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as SebasModuleManifest;

    if (manifest.schemaVersion !== 1) {
      errors.push(`schemaVersion ${manifest.schemaVersion} nao suportado (esperado 1).`);
    }
    if (!isCompatible(manifest.sebasCompat)) {
      errors.push(`Modulo requer sebasCompat ${manifest.sebasCompat}, core anuncia ${CORE_MARKETPLACE_VERSION}.`);
    }
    if (errors.length > 0) {
      return { ok: false, manifest, errors };
    }

    // --ignore-scripts bloqueia postinstall/preinstall arbitrarios do pacote (o vetor mais
    // comum de RCE via supply chain) — modulo que dependa de build nativo via postinstall
    // quebra aqui, e' limitacao conhecida, aceitavel frente ao risco que fecha.
    await runNpmCommand(["install", "--ignore-scripts"], workDir, workDir);
    await runNpmCommand(["run", "build"], workDir, workDir);

    const finalDir = join(installedModulesDir(dataDir), manifest.id);
    await rm(finalDir, { recursive: true, force: true });
    await rename(workDir, finalDir);

    const entryPoints = resolveEntryPoints(finalDir, manifest);

    createModuleInstall(db, { id: manifest.id, repoUrl, pinnedSha, manifest });

    host.start({
      moduleId: manifest.id,
      entryPoints,
      granted: permissionsFromGrantItems([]),
      installSandbox: true
    });
    try {
      await host.runSelfTest(manifest.id);
    } finally {
      host.stop(manifest.id);
    }

    const alreadyGranted = loadActiveGrantItems(db, manifest.id);
    const requested = grantsRequestedByManifest(manifest);
    const permissionDiff = diffAgainstGrantedItems(requested, alreadyGranted);

    recordModuleEvent(db, manifest.id, "install", actorDiscordId, { repoUrl, pinnedSha, permissionDiff });

    return { ok: true, moduleId: manifest.id, manifest, permissionDiff, errors: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(message);
    return { ok: false, errors };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function isCompatible(sebasCompat: string): boolean {
  const match = /^\^?(\d+)\./.exec(sebasCompat);
  if (!match) return false;
  const requestedMajor = Number(match[1]);
  const coreMajor = Number(CORE_MARKETPLACE_VERSION.split(".")[0]);
  return requestedMajor === coreMajor;
}

export function resolveEntryPoints(moduleDir: string, manifest: SebasModuleManifest): {
  controller?: string;
  chronos?: string;
  discordCommands?: string;
  tools?: string;
  permissionGate?: string;
} {
  const toAbsolute = (relative: string | undefined) => (relative ? resolve(moduleDir, relative) : undefined);
  return {
    controller: toAbsolute(manifest.entryPoints.controller),
    chronos: toAbsolute(manifest.entryPoints.chronos),
    discordCommands: toAbsolute(manifest.entryPoints.discordCommands),
    tools: toAbsolute(manifest.entryPoints.tools),
    permissionGate: toAbsolute(manifest.entryPoints.permissionGate)
  };
}

export function loadInstalledManifest(db: DatabaseSync, moduleId: string): SebasModuleManifest | null {
  const row = getModuleInstall(db, moduleId);
  return row ? toModuleDetail(db, row).manifest : null;
}
