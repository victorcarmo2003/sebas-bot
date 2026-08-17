import type { DatabaseSync } from "node:sqlite";
import type { GrantedPermissions } from "./context-bridge.js";
import type { ModulePermissions, PermissionDiffItem, SebasModuleManifest } from "./types.js";

/** Converte o bloco `permissions` de um manifest no conjunto completo de grants que ele PEDE.
 * Usado tanto pro diff de instalacao (comparar contra o que ja foi concedido) quanto pro
 * auto-grant de modulos in-tree (sem fluxo de aprovacao — confia no manifest do proprio repo). */
export function grantsRequestedByManifest(manifest: SebasModuleManifest): PermissionDiffItem[] {
  const permissions: ModulePermissions = manifest.permissions ?? {};
  const items: PermissionDiffItem[] = [];

  for (const scope of permissions.adminScopes ?? []) {
    items.push({ grantType: "adminScope", grantValue: scope });
  }
  for (const scope of permissions.providesScopes ?? []) {
    items.push({ grantType: "providesScope", grantValue: scope });
  }
  for (const domain of permissions.network?.domains ?? []) {
    items.push({ grantType: "networkDomain", grantValue: domain });
  }
  if (permissions.storage) {
    items.push({ grantType: "storage", grantValue: String(permissions.storage.maxMb) });
  }
  for (const discordPermission of permissions.discordPermissions ?? []) {
    items.push({ grantType: "discordPermission", grantValue: discordPermission });
  }
  if (manifest.dependencies?.aiProvider) {
    items.push({ grantType: "aiProviderDependency", grantValue: manifest.dependencies.aiProvider });
  }

  return items;
}

/** Diff entre o que o manifest pede agora e o que ja foi concedido (grants ativos, nao revogados)
 * — so os itens NOVOS aparecem, pro dono revisar antes de aprovar. */
export function diffAgainstGrantedItems(requested: PermissionDiffItem[], alreadyGranted: PermissionDiffItem[]): PermissionDiffItem[] {
  const grantedKeys = new Set(alreadyGranted.map((item) => `${item.grantType}:${item.grantValue}`));
  return requested.filter((item) => !grantedKeys.has(`${item.grantType}:${item.grantValue}`));
}

export function permissionsFromGrantItems(items: PermissionDiffItem[]): GrantedPermissions {
  const granted: GrantedPermissions = {
    networkDomains: new Set(),
    discordPermissions: new Set(),
    hasAiProvider: false,
    hasStorage: false
  };
  for (const item of items) {
    if (item.grantType === "networkDomain") granted.networkDomains.add(item.grantValue);
    if (item.grantType === "discordPermission") granted.discordPermissions.add(item.grantValue);
    if (item.grantType === "aiProviderDependency") granted.hasAiProvider = true;
    if (item.grantType === "storage") granted.hasStorage = true;
  }
  return granted;
}

export function loadActiveGrantItems(db: DatabaseSync, moduleId: string): PermissionDiffItem[] {
  const rows = db
    .prepare("SELECT grant_type, grant_value FROM module_grants WHERE module_id = ? AND revoked_at IS NULL")
    .all(moduleId) as Array<{ grant_type: PermissionDiffItem["grantType"]; grant_value: string }>;
  return rows.map((row) => ({ grantType: row.grant_type, grantValue: row.grant_value }));
}

export function recordGrants(db: DatabaseSync, moduleId: string, items: PermissionDiffItem[], grantedBy: string): void {
  const now = new Date().toISOString();
  for (const item of items) {
    db.prepare(
      `INSERT INTO module_grants (module_id, grant_type, grant_value, granted_by, granted_at) VALUES (?, ?, ?, ?, ?)`
    ).run(moduleId, item.grantType, item.grantValue, grantedBy, now);
  }
}

export function revokeAllGrants(db: DatabaseSync, moduleId: string, revokedBy: string): void {
  db.prepare("UPDATE module_grants SET revoked_at = ?, revoked_by = ? WHERE module_id = ? AND revoked_at IS NULL").run(
    new Date().toISOString(),
    revokedBy,
    moduleId
  );
}

/** Modulos in-tree (embutidos no monorepo, nao instalados via marketplace) confiam direto no
 * proprio manifest — sem fluxo de aprovacao, e' codigo do primeiro-partido, versionado junto do core. */
export function grantedPermissionsForInTreeModule(manifest: SebasModuleManifest): GrantedPermissions {
  return permissionsFromGrantItems(grantsRequestedByManifest(manifest));
}
