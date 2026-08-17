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

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

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
 * isso roda scripts arbitrarios do repo clonado com privilegio total do processo host. Isolar
 * essa etapa (nao so a execucao em runtime) exigiria sandboxing de build/SO, fora do escopo
 * do worker_threads sandbox que cobre execucao (ver context-bridge.ts) — fica como risco
 * conhecido, documentado no MILESTONES.md.
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
    await execFileAsync("git", ["clone", "--depth", "1", repoUrl, workDir]);
    const { stdout: shaOut } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: workDir });
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

    // npm e' .cmd no Windows — execFile sem shell nao roda, e com shell:true o Node avisa
    // (DEP0190) que um args[] deixa de ser escapado. Aqui os comandos sao strings fixas, sem
    // interpolar nada do repoUrl/manifest, entao exec() (shell por natureza) e' o jeito certo.
    await execAsync("npm install", { cwd: workDir });
    await execAsync("npm run build", { cwd: workDir });

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
} {
  const toAbsolute = (relative: string | undefined) => (relative ? resolve(moduleDir, relative) : undefined);
  return {
    controller: toAbsolute(manifest.entryPoints.controller),
    chronos: toAbsolute(manifest.entryPoints.chronos),
    discordCommands: toAbsolute(manifest.entryPoints.discordCommands)
  };
}

export function loadInstalledManifest(db: DatabaseSync, moduleId: string): SebasModuleManifest | null {
  const row = getModuleInstall(db, moduleId);
  return row ? toModuleDetail(db, row).manifest : null;
}
