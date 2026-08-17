const FETCH_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Confirma que o token e' valido batendo em /user — mesmo espirito de testOpenCodeKey.ts. */
export async function testGithubToken(token: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetchWithTimeout("https://api.github.com/user", {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" }
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, error: `GitHub recusou o token com ${response.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
