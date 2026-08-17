import { existsSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type SelfUpdatePhase = "idle" | "requested" | "pulling" | "installing" | "building" | "copying-static" | "restarting" | "done" | "error";

export interface SelfUpdateStatus {
  phase: SelfUpdatePhase;
  error: string | null;
  /** Ultima aplicacao bem-sucedida — persiste entre ciclos, independente do phase atual
   * (ver self-update-last-applied.json, escrito so uma vez por ciclo, no "done"). null se o
   * self-update nunca rodou de verdade ainda nesta maquina. */
  lastAppliedSha: string | null;
  lastAppliedAt: string | null;
}

const IDLE_FIELDS = { phase: "idle" as const, error: null };

function statusPath(dataDir: string): string {
  return join(dataDir, "self-update-status.json");
}

function lastAppliedPath(dataDir: string): string {
  return join(dataDir, "self-update-last-applied.json");
}

function markerPath(dataDir: string): string {
  return join(dataDir, "self-update-requested");
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Le o arquivo de status (fase corrente) + o de ultima aplicacao (persistente), ambos escritos
 * pelo script root fora do checkout — so leitura, ProtectSystem=strict permite ler qualquer
 * caminho, so bloqueia escrita fora de ReadWritePaths (que inclui o dataDir). */
export async function readSelfUpdateStatus(dataDir: string): Promise<SelfUpdateStatus> {
  const [statusFile, lastApplied] = await Promise.all([
    readJsonFile<{ phase?: string; error?: string | null }>(statusPath(dataDir)),
    readJsonFile<{ sha?: string; at?: string }>(lastAppliedPath(dataDir))
  ]);

  const phase = typeof statusFile?.phase === "string" ? (statusFile.phase as SelfUpdatePhase) : IDLE_FIELDS.phase;
  const error = statusFile?.error ?? null;

  return {
    phase,
    error,
    lastAppliedSha: lastApplied?.sha ?? null,
    lastAppliedAt: lastApplied?.at ?? null
  };
}

const ACTIVE_PHASES = new Set<SelfUpdatePhase>(["requested", "pulling", "installing", "building", "copying-static", "restarting"]);

/** true quando o script root ja esta no meio de um update — evita empilhar pedidos novos
 * (o watcher so reage a criacao/existencia do marker, um segundo pedido antes do primeiro
 * terminar so reescreveria o marker sem efeito nenhum, mas mantem a checagem explicita mesmo
 * assim pra nao mascarar um status "error" anterior nao visto ainda). */
export async function isSelfUpdateInProgress(dataDir: string): Promise<boolean> {
  const status = await readSelfUpdateStatus(dataDir);
  return ACTIVE_PHASES.has(status.phase);
}

/** Cria o marker que o watcher root (sebas-self-update.path) observa. So isso — o processo
 * node nunca toca em git/npm/systemctl diretamente, ProtectSystem=strict do systemd nem
 * deixaria (ReadWritePaths so cobre o dataDir, nao o checkout do repo). Nao mexe no arquivo de
 * "ultima aplicacao" — so o script root escreve nele, e so no "done". */
export async function requestSelfUpdate(dataDir: string): Promise<void> {
  await writeFile(statusPath(dataDir), JSON.stringify({ phase: "requested", error: null }), "utf8");
  writeFileSync(markerPath(dataDir), "");
}
