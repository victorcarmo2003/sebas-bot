import type { DatabaseSync } from "node:sqlite";
import { getGithubToken } from "../github/settings-repo.js";

export interface DiscoveredModule {
  repoFullName: string;
  repoUrl: string;
  htmlUrl: string;
  manifestPath: string;
  /** id do manifest (sebas.module.json na raiz do repo) — null quando o fetch/parse falha
   * (repo privado sem acesso, manifest invalido, etc). Usado tanto pra decidir alreadyInstalled
   * quanto pro painel montar o link "Configurar" (/modules/:moduleId). */
  moduleId: string | null;
  alreadyInstalled: boolean;
}

export interface DiscoverModulesResult {
  ok: boolean;
  items: DiscoveredModule[];
  error?: string;
}

interface GitHubCodeSearchItem {
  path: string;
  repository: { full_name: string; html_url: string };
}

/** Busca repos publicos com sebas.module.json na raiz via GitHub code search — precisa de
 * token configurado (a code search API do GitHub exige autenticacao, mesmo pra conteudo
 * publico). Token vem do painel (POST /api/admin/github/token), salvo em github_settings —
 * mesmo padrao da chave de IA, nao e' env var. */
export async function discoverModules(db: DatabaseSync, query: string): Promise<DiscoverModulesResult> {
  const token = getGithubToken(db);
  if (!token) {
    return { ok: false, items: [], error: "Nenhum token do GitHub configurado. Configure no painel." };
  }

  const searchQuery = ["filename:sebas.module.json", query.trim()].filter(Boolean).join(" ");
  const url = `https://api.github.com/search/code?q=${encodeURIComponent(searchQuery)}&per_page=20`;

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28"
    }
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false, items: [], error: `GitHub search failed with ${response.status}: ${body.slice(0, 300)}` };
  }

  const data = (await response.json()) as { items?: GitHubCodeSearchItem[] };
  const installedIds = new Set(
    (db.prepare("SELECT id FROM module_installs").all() as Array<{ id: string }>).map((row) => row.id)
  );

  const candidates = (data.items ?? []).filter((item) => item.path === "sebas.module.json");
  const moduleIds = await Promise.all(candidates.map((item) => fetchManifestId(item.repository.full_name, token)));

  const items: DiscoveredModule[] = candidates.map((item, index) => {
    const moduleId = moduleIds[index];
    return {
      repoFullName: item.repository.full_name,
      repoUrl: `${item.repository.html_url}.git`,
      htmlUrl: item.repository.html_url,
      manifestPath: item.path,
      moduleId,
      // Nome do repo (ex. "sebas-module-permissions") nunca bate com o id do manifest (ex.
      // "permissions") — so o id de verdade, lido do proprio sebas.module.json, decide isso.
      alreadyInstalled: moduleId !== null && installedIds.has(moduleId)
    };
  });

  return { ok: true, items };
}

/** Le o id de dentro do sebas.module.json do repo via GitHub Contents API (um GET leve, sem
 * clone) — null se o repo nao for acessivel ou o manifest nao parsear. */
async function fetchManifestId(repoFullName: string, token: string): Promise<string | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${repoFullName}/contents/sebas.module.json`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28"
      }
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { content?: string; encoding?: string };
    if (!data.content) return null;
    const decoded = Buffer.from(data.content, (data.encoding as BufferEncoding) ?? "base64").toString("utf8");
    const manifest = JSON.parse(decoded) as { id?: unknown };
    return typeof manifest.id === "string" ? manifest.id : null;
  } catch {
    return null;
  }
}
