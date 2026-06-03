import { errorMessage } from "./types";

export interface ValidationResult {
  valid: boolean;
  user?: string;
  scopes?: string[];
  error?: string;
}

const TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function validateGitHub(token: string): Promise<ValidationResult> {
  try {
    const res = await fetchWithTimeout("https://api.github.com/user", {
      headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { valid: false, error: `GitHub API returned ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = (await res.json()) as { login?: string };
    const scopes =
      res.headers
        .get("x-oauth-scopes")
        ?.split(",")
        .map((s) => s.trim()) ?? [];
    return { valid: true, user: data.login, scopes };
  } catch (err: unknown) {
    return { valid: false, error: errorMessage(err) };
  }
}

async function validateLinear(token: string): Promise<ValidationResult> {
  try {
    const res = await fetchWithTimeout("https://api.linear.app/graphql", {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ viewer { id name } }" }),
    });
    if (!res.ok) return { valid: false, error: `Linear API returned ${res.status}` };
    const data = (await res.json()) as { data?: { viewer?: { name?: string } } };
    return { valid: true, user: data.data?.viewer?.name ?? undefined };
  } catch (err: unknown) {
    return { valid: false, error: errorMessage(err) };
  }
}

async function validateFigma(token: string): Promise<ValidationResult> {
  try {
    const res = await fetchWithTimeout("https://api.figma.com/v1/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { valid: false, error: `Figma API returned ${res.status}` };
    const data = (await res.json()) as { handle?: string; email?: string };
    return { valid: true, user: data.handle || data.email || undefined };
  } catch (err: unknown) {
    return { valid: false, error: errorMessage(err) };
  }
}

async function validateNotion(token: string): Promise<ValidationResult> {
  try {
    const res = await fetchWithTimeout("https://api.notion.com/v1/users/me", {
      headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28" },
    });
    if (!res.ok) return { valid: false, error: `Notion API returned ${res.status}` };
    const data = (await res.json()) as { name?: string };
    return { valid: true, user: data.name || undefined };
  } catch (err: unknown) {
    return { valid: false, error: errorMessage(err) };
  }
}

async function validateSlack(token: string): Promise<ValidationResult> {
  try {
    const res = await fetchWithTimeout("https://slack.com/api/auth.test", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { valid: false, error: `Slack API returned ${res.status}` };
    const data = (await res.json()) as { ok?: boolean; user?: string; team?: string; error?: string };
    if (!data.ok) return { valid: false, error: data.error || "Slack auth failed" };
    return { valid: true, user: data.user && data.team ? `${data.user}@${data.team}` : data.user || undefined };
  } catch (err: unknown) {
    return { valid: false, error: errorMessage(err) };
  }
}

const validators: Record<string, (token: string) => Promise<ValidationResult>> = {
  github: validateGitHub,
  linear: validateLinear,
  figma: validateFigma,
  notion: validateNotion,
  slack: validateSlack,
};

export async function validateToken(service: string, token: string): Promise<ValidationResult> {
  const validator = validators[service];
  if (!validator)
    return {
      valid: false,
      error: `Unknown service: ${service}. Supported services: ${Object.keys(validators).join(", ")}`,
    };
  return validator(token);
}
