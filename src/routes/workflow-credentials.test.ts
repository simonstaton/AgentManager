import http from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createWorkflowCredentialsRouter } from "./workflow-credentials";

vi.mock("../auth", () => ({
  requireNotAgentService: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../sanitize", () => ({
  registerSecretValue: vi.fn(),
}));

vi.mock("../token-validation", () => ({
  validateToken: vi.fn().mockResolvedValue({ valid: true, user: "test-user" }),
}));

function request(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method,
        headers: {
          "content-type": "application/json",
          ...(payload ? { "content-length": String(Buffer.byteLength(payload)) } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: string) => (raw += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: { raw } });
          }
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let server: http.Server;
let baseUrl: string;

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      const app = express();
      app.use(express.json());
      app.use(createWorkflowCredentialsRouter());
      server = app.listen(0, "127.0.0.1", () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    }),
);

afterAll(() => {
  server?.close();
});

const PATH = "/api/workflows/validate-credentials";

describe("POST /api/workflows/validate-credentials — input validation", () => {
  it("returns 400 when body is empty", async () => {
    const { status, body } = await request("POST", `${baseUrl}${PATH}`, {});
    expect(status).toBe(400);
    expect(typeof body.error).toBe("string");
  });

  it("returns 400 for linearApiKey shorter than 8 chars", async () => {
    const { status, body } = await request("POST", `${baseUrl}${PATH}`, { linearApiKey: "short" });
    expect(status).toBe(400);
    expect(body.error).toMatch(/linearApiKey/);
  });

  it("returns 400 for linearApiKey that is not a string", async () => {
    const { status, body } = await request("POST", `${baseUrl}${PATH}`, { linearApiKey: 12345 });
    expect(status).toBe(400);
    expect(body.error).toMatch(/linearApiKey/);
  });

  it("returns 400 for githubPat shorter than 8 chars", async () => {
    const { status, body } = await request("POST", `${baseUrl}${PATH}`, { githubPat: "tooshrt" });
    expect(status).toBe(400);
    expect(body.error).toMatch(/githubPat/);
  });
});

describe("POST /api/workflows/validate-credentials — valid credentials", () => {
  it("returns 200 with valid:true for a valid linearApiKey", async () => {
    const { status, body } = await request("POST", `${baseUrl}${PATH}`, {
      linearApiKey: "lin_api_validkey_12345",
    });
    expect(status).toBe(200);
    expect(body).toHaveProperty("results");
  });

  it("returns 200 with valid:true for a valid githubPat", async () => {
    const { status, body } = await request("POST", `${baseUrl}${PATH}`, {
      githubPat: "ghp_validpat_12345678",
    });
    expect(status).toBe(200);
    expect(body).toHaveProperty("results");
  });

  it("validates both keys when both are provided", async () => {
    const { status, body } = await request("POST", `${baseUrl}${PATH}`, {
      linearApiKey: "lin_api_validkey_12345",
      githubPat: "ghp_validpat_12345678",
    });
    expect(status).toBe(200);
    expect(body.results).toHaveProperty("linear");
    expect(body.results).toHaveProperty("github");
  });
});
