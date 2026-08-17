import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface SelfUpdateCandidate {
  currentSha: string;
  remoteSha: string;
}

/**
 * repoRoot e' o checkout do proprio sebas-bot rodando (dirname(dirname(process.cwd())) a partir
 * de packages/core, ver bin/worker.ts). So leitura (rev-parse local + ls-remote na origin
 * configurada) — nunca escreve nada, por isso funciona mesmo sob ProtectSystem=strict sem
 * ReadWritePaths pro checkout.
 */
export async function checkSelfUpdateAvailable(repoRoot: string): Promise<SelfUpdateCandidate | null> {
  try {
    const [{ stdout: localOut }, { stdout: remoteOut }] = await Promise.all([
      execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot }),
      execFileAsync("git", ["ls-remote", "origin", "HEAD"], { cwd: repoRoot })
    ]);
    const currentSha = localOut.trim();
    const remoteSha = remoteOut.split(/\s+/)[0]?.trim();
    if (!remoteSha || !/^[0-9a-f]{7,40}$/i.test(remoteSha)) return null;
    return remoteSha !== currentSha ? { currentSha, remoteSha } : null;
  } catch {
    return null;
  }
}
