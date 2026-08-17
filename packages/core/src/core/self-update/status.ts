import { existsSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type SelfUpdatePhase = "idle" | "requested" | "pulling" | "installing" | "building" | "copying-static" | "restarting" | "done" | "error";

export interface SelfUpdateStatus {
  phase: SelfUpdatePhase;
  error: string | null;
}

const IDLE_STATUS: SelfUpdateStatus = { phase: "idle", error: null };

function statusPath(dataDir: string): string {
  return join(dataDir, "self-update-status.json");
}

function markerPath(dataDir: string): string {
  return join(dataDir, "self-update-requested");
}

/** Le o arquivo de status escrito pelo script root (sebas-self-update.sh, fora do checkout,
 * fora do controle deste processo) — so leitura, ProtectSystem=strict permite ler qualquer
 * caminho, so bloqueia escrita fora de ReadWritePaths (que inclui o dataDir). */
export async function readSelfUpdateStatus(dataDir: string): Promise<SelfUpdateStatus> {
  const path = statusPath(dataDir);
  if (!existsSync(path)) return IDLE_STATUS;
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<SelfUpdateStatus>;
    if (typeof parsed.phase !== "string") return IDLE_STATUS;
    return { phase: parsed.phase as SelfUpdatePhase, error: parsed.error ?? null };
  } catch {
    return IDLE_STATUS;
  }
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
 * deixaria (ReadWritePaths so cobre o dataDir, nao o checkout do repo). */
export async function requestSelfUpdate(dataDir: string): Promise<void> {
  await writeFile(statusPath(dataDir), JSON.stringify({ phase: "requested", error: null } satisfies SelfUpdateStatus), "utf8");
  writeFileSync(markerPath(dataDir), "");
}
