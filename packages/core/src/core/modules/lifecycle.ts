import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Cron } from "croner";
import { diffAgainstGrantedItems, grantsRequestedByManifest, loadActiveGrantItems, permissionsFromGrantItems, recordGrants, revokeAllGrants } from "./grants.js";
import { resolveEntryPoints } from "./installer.js";
import type { ModuleHost } from "./host.js";
import {
  deleteModuleInstall,
  getModuleInstall,
  IN_TREE_PINNED_SHA,
  markFirstEnabled,
  recordModuleEvent,
  setModuleInstallState,
  toModuleDetail
} from "./marketplace-repo.js";

const cronJobs = new Map<string, InstanceType<typeof Cron>>();

export function approveModule(db: DatabaseSync, moduleId: string, actorDiscordId: string): void {
  const row = getModuleInstall(db, moduleId);
  if (!row) throw new Error(`Module "${moduleId}" not found.`);
  const detail = toModuleDetail(db, row);

  const alreadyGranted = loadActiveGrantItems(db, moduleId);
  const requested = grantsRequestedByManifest(detail.manifest);
  const diff = diffAgainstGrantedItems(requested, alreadyGranted);
  recordGrants(db, moduleId, diff, actorDiscordId);
  setModuleInstallState(db, moduleId, "approved");
  recordModuleEvent(db, moduleId, "approve", actorDiscordId, { grantedNow: diff });
}

export function rejectModule(db: DatabaseSync, moduleId: string, actorDiscordId: string): void {
  setModuleInstallState(db, moduleId, "rejected");
  recordModuleEvent(db, moduleId, "reject", actorDiscordId);
}

export function enableModule(db: DatabaseSync, host: ModuleHost, dataDir: string, moduleId: string, actorDiscordId: string): void {
  const row = getModuleInstall(db, moduleId);
  if (!row) throw new Error(`Module "${moduleId}" not found.`);
  if (row.state !== "approved" && row.state !== "disabled") {
    throw new Error(`Module "${moduleId}" must be approved before it can be enabled (current state: ${row.state}).`);
  }
  const detail = toModuleDetail(db, row);
  // Modulo in-tree vive em packages/modules/<id> (junto do monorepo), nao na scratch dir do
  // marketplace (dataDir/installed-modules/<id>) — mesma logica de IN_TREE_MODULE_DIR em bin/bot.ts.
  const moduleDir =
    row.pinned_sha === IN_TREE_PINNED_SHA ? join(process.cwd(), "..", "modules", moduleId) : join(dataDir, "installed-modules", moduleId);
  const entryPoints = resolveEntryPoints(moduleDir, detail.manifest);
  const granted = permissionsFromGrantItems(loadActiveGrantItems(db, moduleId));

  host.start({ moduleId, entryPoints, granted });

  if (detail.manifest.cron?.schedule) {
    cronJobs.get(moduleId)?.stop();
    const job = new Cron(detail.manifest.cron.schedule, () => {
      void host.runChronos(moduleId).catch((error) => {
        console.error(`Module "${moduleId}" chronos run failed:`, error);
      });
    });
    cronJobs.set(moduleId, job);
  }

  setModuleInstallState(db, moduleId, "enabled");
  markFirstEnabled(db, moduleId, actorDiscordId);
  recordModuleEvent(db, moduleId, "enable", actorDiscordId);
}

export function disableModule(db: DatabaseSync, host: ModuleHost, moduleId: string, actorDiscordId: string): void {
  cronJobs.get(moduleId)?.stop();
  cronJobs.delete(moduleId);
  host.stop(moduleId);
  setModuleInstallState(db, moduleId, "disabled");
  recordModuleEvent(db, moduleId, "disable", actorDiscordId);
}

export async function uninstallModule(db: DatabaseSync, host: ModuleHost, moduleId: string, actorDiscordId: string): Promise<void> {
  cronJobs.get(moduleId)?.stop();
  cronJobs.delete(moduleId);
  host.stop(moduleId);
  revokeAllGrants(db, moduleId, actorDiscordId);
  recordModuleEvent(db, moduleId, "uninstall", actorDiscordId);
  deleteModuleInstall(db, moduleId);
}
