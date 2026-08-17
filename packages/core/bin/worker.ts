import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Cron } from "croner";
import { loadCoreConfig } from "../src/core/config/env.js";
import { openDb } from "../src/core/db/client.js";
import { runMigrations } from "../src/core/db/migrate.js";
import { logRun } from "../src/core/logging.js";
import { runAiHealthCheck } from "../src/core/notifications/health-check.js";
import { ModuleHost } from "../src/core/modules/host.js";
import { grantedPermissionsForInTreeModule } from "../src/core/modules/grants.js";
import { resolveEntryPoints } from "../src/core/modules/installer.js";
import type { SebasModuleManifest } from "../src/core/modules/types.js";
import { claimNext, failJob } from "../src/core/queue/sqlite-queue.js";

const config = loadCoreConfig();
runMigrations(config.dbPath);
const db = openDb(config.dbPath);

const IN_TREE_MODULE_DIR = join(process.cwd(), "..", "modules", "changelog-roblox");
const inTreeManifest = JSON.parse(readFileSync(join(IN_TREE_MODULE_DIR, "sebas.module.json"), "utf8")) as SebasModuleManifest;
const inTreeModuleId = inTreeManifest.id;

const host = new ModuleHost(db, config);
host.start({
  moduleId: inTreeModuleId,
  entryPoints: resolveEntryPoints(IN_TREE_MODULE_DIR, inTreeManifest),
  granted: grantedPermissionsForInTreeModule(inTreeManifest)
});

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

if (inTreeManifest.cron?.schedule) {
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
});

console.log("sebas-worker started. Cron registered, queue drain loop running.");
void drainQueue();
void runAiHealthCheck(db, config).catch((error) => console.error("Initial AI health check failed:", error));
