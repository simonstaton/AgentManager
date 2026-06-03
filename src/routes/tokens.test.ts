import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTokensRouter } from "./tokens";

// Mock child_process so rebootstrapMcp never spawns a real process
vi.mock("node:child_process", () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: (e: null) => void) => cb(null)),
}));

// Mock token-storage
vi.mock("../token-storage", () => ({
  KNOWN_SERVICES: new Set(["github", "linear", "figma"]),
  SERVICE_TO_ENV: { github: "GITHUB_TOKEN", linear: "LINEAR_API_KEY", figma: "FIGMA_TOKEN" },
  getTokenStatuses: vi.fn(),
  saveUIToken: vi.fn(),
  loadToken: vi.fn(),
  deleteToken: vi.fn(),
}));

// Mock token-validation
vi.mock("../token-validation", () => ({
  validateToken: vi.fn(),
}));

// Mock storage sync
vi.mock("../storage", () => ({
  debouncedSyncToGCS: vi.fn(),
}));

// Mock auth so we can inject users per-request via a test header
vi.mock("../auth", async () => {
  const mod = await vi.importActual<typeof import("../auth")>("../auth");
  return {
    ...mod,
    requireNotAgentService: (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const role = req.headers["x-test-role"];
      if (role === "agent") {
        res.status(403).json({ error: "This operation is not allowed for agent service tokens" });
        return;
      }
      next();
    },
  };
});

import { deleteToken, getTokenStatuses, loadToken, saveUIToken } from "../token-storage";
import { validateToken } from "../token-validation";

function request(
  method: string,
  url: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          "content-type": "application/json",
          ...(payload ? { "content-length": String(Buffer.byteLength(payload)) } : {}),
          ...(headers ?? {}),
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
      app.use(createTokensRouter());
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/tokens", () => {
  it("returns token statuses for all services", async () => {
    const statuses = { github: { set: true }, linear: { set: false } };
    vi.mocked(getTokenStatuses).mockReturnValue(statuses as never);

    const { status, body } = await request("GET", `${baseUrl}/api/tokens`);
    expect(status).toBe(200);
    expect(body).toEqual({ tokens: statuses });
    expect(getTokenStatuses).toHaveBeenCalledOnce();
  });

  it("returns 500 when getTokenStatuses throws", async () => {
    vi.mocked(getTokenStatuses).mockImplementation(() => {
      throw new Error("storage failure");
    });

    const { status, body } = await request("GET", `${baseUrl}/api/tokens`);
    expect(status).toBe(500);
    expect(body).toHaveProperty("error");
  });
});

describe("PUT /api/tokens/:service", () => {
  beforeEach(() => {
    vi.mocked(validateToken).mockResolvedValue({ valid: true, user: "testuser" });
    vi.mocked(loadToken).mockReturnValue({
      server: "github",
      source: "ui",
      token: "fake",
      label: "test",
    });
  });

  it("saves a valid token and returns ok", async () => {
    const { status, body } = await request("PUT", `${baseUrl}/api/tokens/github`, {
      token: "mock",
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.service).toBe("github");
    expect(saveUIToken).toHaveBeenCalledOnce();
  });

  it("returns 400 for an unknown service", async () => {
    const { status, body } = await request("PUT", `${baseUrl}/api/tokens/unknown-svc`, {
      token: "mock",
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/Unknown service/);
  });

  it("returns 400 when token is missing from body", async () => {
    const { status, body } = await request("PUT", `${baseUrl}/api/tokens/github`, {});
    expect(status).toBe(400);
    expect(body.error).toMatch(/token/i);
  });

  it("returns 400 when token is too short", async () => {
    const { status, body } = await request("PUT", `${baseUrl}/api/tokens/github`, { token: "ab" });
    expect(status).toBe(400);
    expect(body.error).toMatch(/token/i);
  });

  it("includes validationWarning when token fails validation", async () => {
    vi.mocked(validateToken).mockResolvedValue({ valid: false, error: "bad token" });

    const { status, body } = await request("PUT", `${baseUrl}/api/tokens/linear`, {
      token: "fake",
    });
    expect(status).toBe(200);
    expect(body.validationWarning).toBe("bad token");
  });

  it("skips validation when ?validate=false", async () => {
    const { status, body } = await request("PUT", `${baseUrl}/api/tokens/figma?validate=false`, { token: "mock" });
    expect(status).toBe(200);
    expect(validateToken).not.toHaveBeenCalled();
    expect(body.ok).toBe(true);
  });

  it("includes the label returned by loadToken", async () => {
    const { body } = await request("PUT", `${baseUrl}/api/tokens/github`, { token: "mock", label: "mine" });
    expect(body.label).toBe("test");
  });

  it("blocks agent tokens (403)", async () => {
    const { status, body } = await request(
      "PUT",
      `${baseUrl}/api/tokens/github`,
      { token: "mock" },
      { "x-test-role": "agent" },
    );
    expect(status).toBe(403);
    expect(body.error).toMatch(/not allowed/i);
    expect(saveUIToken).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/tokens/:service", () => {
  it("deletes a token and returns ok", async () => {
    const { status, body } = await request("DELETE", `${baseUrl}/api/tokens/github`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.service).toBe("github");
    expect(deleteToken).toHaveBeenCalledWith("github");
  });

  it("returns hasFallback=false when env var is not set", async () => {
    delete process.env.GITHUB_TOKEN;
    const { body } = await request("DELETE", `${baseUrl}/api/tokens/github`);
    expect(body.hasFallback).toBe(false);
  });

  it("returns hasFallback=true when env var is set", async () => {
    process.env.GITHUB_TOKEN = "envtoken";
    const { body } = await request("DELETE", `${baseUrl}/api/tokens/github`);
    expect(body.hasFallback).toBe(true);
    delete process.env.GITHUB_TOKEN;
  });

  it("returns 400 for an unknown service", async () => {
    const { status, body } = await request("DELETE", `${baseUrl}/api/tokens/nope`);
    expect(status).toBe(400);
    expect(body.error).toMatch(/Unknown service/);
  });

  it("returns 500 when deleteToken throws", async () => {
    vi.mocked(deleteToken).mockImplementation(() => {
      throw new Error("io error");
    });
    const { status } = await request("DELETE", `${baseUrl}/api/tokens/figma`);
    expect(status).toBe(500);
  });

  it("blocks agent tokens (403)", async () => {
    const { status } = await request("DELETE", `${baseUrl}/api/tokens/github`, undefined, { "x-test-role": "agent" });
    expect(status).toBe(403);
    expect(deleteToken).not.toHaveBeenCalled();
  });
});
