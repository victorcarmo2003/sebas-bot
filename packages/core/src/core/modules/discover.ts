import type { DatabaseSync } from "node:sqlite";

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
 * GITHUB_TOKEN (a code search API do GitHub exige autenticacao, mesmo pra conteudo publico). */
export async function discoverModules(db: DatabaseSync, query: string): Promise<DiscoverModulesResult> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return { ok: false, items: [], error: "GITHUB_TOKEN is not configured on the core." };
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
