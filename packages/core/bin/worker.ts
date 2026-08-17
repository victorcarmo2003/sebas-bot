import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Cron } from "croner";
import { loadCoreConfig } from "../src/core/config/env.js";
import { openDb } from "../src/core/db/client.js";
import { runMigrations } from "../src/core/db/migrate.js";
import { logRun } from "../src/core/logging.js";
import { runAiHealthCheck, runGithubTokenHealthCheck } from "../src/core/notifications/health-check.js";
import { runModuleUpdateCheckIfDue } from "../src/core/notifications/module-update-check.js";
import { runSelfUpdateCheck } from "../src/core/notifications/self-update-check.js";
import { ModuleHost } from "../src/core/modules/host.js";
import { grantedPermissionsForInTreeModule } from "../src/core/modules/grants.js";
import { resolveEntryPoints } from "../src/core/modules/installer.js";
import { ensureInTreeModuleRegistered } from "../src/core/modules/marketplace-repo.js";
import type { SebasModuleManifest } from "../src/core/modules/types.js";
import { claimNext, failJob } from "../src/core/queue/sqlite-queue.js";

const config = loadCoreConfig();
runMigrations(config.dbPath);
const db = openDb(config.dbPath);
const dataDir = dirname(config.dbPath);
// packages/core -> raiz do checkout (mesmo WorkingDirectory do systemd, ver bin/bot.ts pro
// mesmo padrao de resolucao de path relativo a process.cwd()).
const repoRoot = join(process.cwd(), "..", "..");

const IN_TREE_MODULE_DIR = join(process.cwd(), "..", "modules", "changelog-roblox");
const inTreeManifest = JSON.parse(readFileSync(join(IN_TREE_MODULE_DIR, "sebas.module.json"), "utf8")) as SebasModuleManifest;
const inTreeModuleId = inTreeManifest.id;

const host = new ModuleHost(db, config);
const inTreeInstall = ensureInTreeModuleRegistered(db, inTreeManifest);
const inTreeEnabled = inTreeInstall.state !== "disabled";
if (inTreeEnabled) {
  host.start({
    moduleId: inTreeModuleId,
    entryPoints: resolveEntryPoints(IN_TREE_MODULE_DIR, inTreeManifest),
    granted: grantedPermissionsForInTreeModule(inTreeManifest)
  });
}

const DRAIN_IDLE_SLEEP_MS = 4_000;
let draining = false;

async function drainQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const job = claimNext(db);
      if (!job) break;
      try {
        // Nenhum modulo hoje (nem o changelog-roblox in-tree) enqueua trabalho aqui — poll()
        // roda direto no tick do cron via chronos.run(ctx), sincrono. A fila fica de pe como
        // infraestrutura generica pra modulos futuros que precisem de trabalho assincrono sob
        // demanda; sebas-types.ts ainda nao define um entrypoint de consumo de job, entao por
        // enquanto qualquer job reclamado aqui e' erro de configuracao (modulo enqueuou sem
        // ter como ser processado).
        throw new Error(`No job handler registered for module: ${job.moduleId}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Job ${job.id} (${job.kind}) failed:`, message);
        failJob(db, job.id, message);
        logRun(db, {
          level: "error",
          context: "queue",
          moduleId: job.moduleId,
          message: `Job ${job.kind} failed.`,
          meta: { jobId: job.id, error: message }
        });
      }
    }
  } finally {
    draining = false;
  }
}

setInterval(() => {
  void drainQueue();
}, DRAIN_IDLE_SLEEP_MS);

if (inTreeEnabled && inTreeManifest.cron?.schedule) {
  new Cron(inTreeManifest.cron.schedule, async () => {
    try {
      await host.runChronos(inTreeModuleId);
    } catch (error) {
      console.error(`${inTreeModuleId} chronos run failed:`, error);
      logRun(db, {
        level: "error",
        context: "scheduled-poll",
        moduleId: inTreeModuleId,
        message: "Top-level chronos failure.",
        meta: { error: error instanceof Error ? error.message : String(error) }
      });
    }
  });
}

new Cron("*/30 * * * *", async () => {
  try {
    await runAiHealthCheck(db, config);
  } catch (error) {
    console.error("AI health check failed:", error);
  }
  try {
    await runGithubTokenHealthCheck(db, config);
  } catch (error) {
    console.error("GitHub token health check failed:", error);
  }
});

// Tick fixo curto (5min) — a funcao decide sozinha se "e' sua vez" com base no intervalo
// configuravel em Configuracoes -> Marketplace (marketplace_poll_interval_minutes, default 60min).
// Mesmo truque do resto do arquivo: cron fixo, intervalo de negocio variavel por dentro.
new Cron("*/5 * * * *", async () => {
  try {
    await runModuleUpdateCheckIfDue(db, config);
  } catch (error) {
    console.error("Module update check failed:", error);
  }
  try {
    await runSelfUpdateCheck(db, config, repoRoot, dataDir);
  } catch (error) {
    console.error("Self-update check failed:", error);
  }
});

console.log("sebas-worker started. Cron registered, queue drain loop running.");
void drainQueue();
void runAiHealthCheck(db, config).catch((error) => console.error("Initial AI health check failed:", error));
void runGithubTokenHealthCheck(db, config).catch((error) => console.error("Initial GitHub token health check failed:", error));
void runModuleUpdateCheckIfDue(db, config).catch((error) => console.error("Initial module update check failed:", error));
void runSelfUpdateCheck(db, config, repoRoot, dataDir).catch((error) => console.error("Initial self-update check failed:", error));
