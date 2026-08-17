import { existsSync } from "node:fs";
import { readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { disableModule, enableModule } from "./lifecycle.js";
import type { ModuleHost } from "./host.js";
import { installedModulesDir, runGitCommand, runNpmCommand } from "./installer.js";
import { getModuleInstall, IN_TREE_PINNED_SHA, listModuleInstalls, recordModuleEvent, setModuleInstallState } from "./marketplace-repo.js";
import type { SebasModuleManifest } from "./types.js";

export interface ModuleUpdateCandidate {
  moduleId: string;
  repoUrl: string;
  currentSha: string;
  remoteSha: string;
}

/** `git ls-remote` na branch default do repo — sem clone, so pra saber o HEAD atual. Reusa o
 * mesmo sandboxCommand do install (via runGitCommand), passando dataDir como writableDir porque
 * o comando nao escreve nada de verdade (so le stdout). */
async function fetchRemoteHeadSha(repoUrl: string, dataDir: string): Promise<string | null> {
  try {
    const { stdout } = await runGitCommand(["ls-remote", repoUrl, "HEAD"], dataDir, dataDir);
    const sha = stdout.split(/\s+/)[0]?.trim();
    return sha && /^[0-9a-f]{7,40}$/i.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/** Compara pinned_sha (banco) contra o HEAD remoto de cada modulo instalado via marketplace
 * (ignora in-tree — IN_TREE_PINNED_SHA — que nao vem de clone nenhum) e ainda habilitado.
 * So leitura de rede + banco, nao mexe em nenhum ModuleHost. */
export async function checkForUpdates(db: DatabaseSync, dataDir: string): Promise<ModuleUpdateCandidate[]> {
  const rows = listModuleInstalls(db).filter((row) => row.pinned_sha !== IN_TREE_PINNED_SHA && row.state === "enabled");

  const results = await Promise.all(
    rows.map(async (row) => {
      const remoteSha = await fetchRemoteHeadSha(row.repo_url, dataDir);
      return remoteSha && remoteSha !== row.pinned_sha
        ? ({ moduleId: row.id, repoUrl: row.repo_url, currentSha: row.pinned_sha, remoteSha } satisfies ModuleUpdateCandidate)
        : null;
    })
  );

  return results.filter((item): item is ModuleUpdateCandidate => item !== null);
}

export interface UpdateModuleResult {
  ok: boolean;
  error?: string;
  fromSha?: string;
  toSha?: string;
}

/**
 * Clona de novo (repoUrl ja confiado — o modulo ja passou pelo install/approve antes), builda,
 * roda self-test em sandbox (mesma pegada de installModule), troca o diretorio e re-habilita
 * com os MESMOS grants que ja estavam ativos (nunca amplia permissao sozinho so' porque o
 * manifest novo pede mais coisa — isso ficaria pra um fluxo de re-aprovacao futuro, nao existe
 * ainda). Desabilita antes de trocar os arquivos no disco (o worker_thread antigo nao pode
 * seguir rodando contra um dist/ que sumiu no meio do processo).
 */
export async function updateModule(
  db: DatabaseSync,
  host: ModuleHost,
  dataDir: string,
  moduleId: string,
  actorDiscordId: string
): Promise<UpdateModuleResult> {
  const row = getModuleInstall(db, moduleId);
  if (!row) return { ok: false, error: `Module "${moduleId}" not found.` };
  if (row.pinned_sha === IN_TREE_PINNED_SHA) return { ok: false, error: "In-tree modules update via git pull do monorepo, not this flow." };

  const wasEnabled = row.state === "enabled";
  const workDir = join(installedModulesDir(dataDir), `_update_${moduleId}_${Date.now()}`);
  let disabledAlready = false;

  try {
    await runGitCommand(["clone", "--depth", "1", row.repo_url, workDir], workDir, workDir);
    const { stdout: shaOut } = await runGitCommand(["rev-parse", "HEAD"], workDir, workDir);
    const newSha = shaOut.trim();

    const manifestPath = join(workDir, "sebas.module.json");
    if (!existsSync(manifestPath)) {
      return { ok: false, error: "Repositorio nao tem sebas.module.json na raiz." };
    }
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as SebasModuleManifest;
    if (manifest.id !== moduleId) {
      return { ok: false, error: `Manifest id "${manifest.id}" nao bate com o modulo instalado "${moduleId}".` };
    }

    await runNpmCommand(["install", "--ignore-scripts"], workDir, workDir);
    await runNpmCommand(["run", "build"], workDir, workDir);

    if (wasEnabled) {
      disableModule(db, host, moduleId, actorDiscordId);
      disabledAlready = true;
    }

    const finalDir = join(installedModulesDir(dataDir), moduleId);
    await rm(finalDir, { recursive: true, force: true });
    await rename(workDir, finalDir);

    db.prepare(
      "UPDATE module_installs SET pinned_sha = ?, installed_version = ?, manifest = ?, updated_at = ? WHERE id = ?"
    ).run(newSha, manifest.version, JSON.stringify(manifest), new Date().toISOString(), moduleId);
    setModuleInstallState(db, moduleId, "disabled");
    recordModuleEvent(db, moduleId, "update", actorDiscordId, { fromSha: row.pinned_sha, toSha: newSha });

    if (wasEnabled) enableModule(db, host, dataDir, moduleId, actorDiscordId);

    return { ok: true, fromSha: row.pinned_sha, toSha: newSha };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // So mexe no state se ja tinha desabilitado de verdade (host parado) — nesse ponto "disabled"
    // e' o que reflete a realidade. Se falhou antes disso (clone/build), o modulo antigo nunca
    // foi tocado, entao o state no banco (row.state) ja esta certo, nao mexe nele.
    if (disabledAlready) setModuleInstallState(db, moduleId, "disabled", message);
    else setModuleInstallState(db, moduleId, row.state, message);
    return { ok: false, error: message };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
