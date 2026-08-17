import type { DatabaseSync } from "node:sqlite";
import { getGithubToken } from "../github/settings-repo.js";

export interface DiscoveredModule {
  repoFullName: string;
  repoUrl: string;
  htmlUrl: string;
  manifestPath: string;
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

  const items: DiscoveredModule[] = (data.items ?? [])
    .filter((item) => item.path === "sebas.module.json")
    .map((item) => ({
      repoFullName: item.repository.full_name,
      repoUrl: `${item.repository.html_url}.git`,
      htmlUrl: item.repository.html_url,
      manifestPath: item.path,
      alreadyInstalled: installedIds.has(item.repository.full_name.split("/")[1] ?? "")
    }));

  return { ok: true, items };
}
