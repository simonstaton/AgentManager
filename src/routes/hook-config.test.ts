import http from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import hookConfigRouter from "./hook-config";

vi.mock("../hook-config-store", () => ({
  getHookConfig: vi.fn().mockReturnValue({ agentId: "test-agent", rules: [], updatedAt: "" }),
  setHookConfig: vi
    .fn()
    .mockImplementation((_agentId: string, rules: unknown[]) =>
      Promise.resolve({ agentId: "test-agent", rules, updatedAt: new Date().toISOString() }),
    ),
  deleteHookConfig: vi.fn(),
}));

const HOOK_URL = "https://example.com/hook";
const AGENT = "test-agent";

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
        path: parsed.pathname + parsed.search,
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
      app.use("/api/agents", hookConfigRouter);
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

const agentPath = `${AGENT}/hooks`;

describe("GET /api/agents/:id/hooks", () => {
  it("returns empty rules for unknown agent", async () => {
    const res = await request("GET", `${baseUrl}/api/agents/${agentPath}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("rules");
    expect(Array.isArray(res.body.rules)).toBe(true);
  });
});

describe("PUT /api/agents/:id/hooks — valid rules", () => {
  it("accepts valid http rule", async () => {
    const res = await request("PUT", `${baseUrl}/api/agents/${agentPath}`, {
      rules: [{ id: "r1", event: "PreToolUse", type: "http", url: HOOK_URL, matcher: "Bash" }],
    });
    expect(res.status).toBe(200);
    expect(Array.isArray((res.body as { rules: unknown[] }).rules)).toBe(true);
  });

  it("accepts valid command rule", async () => {
    const res = await request("PUT", `${baseUrl}/api/agents/${agentPath}`, {
      rules: [{ id: "r2", event: "PostToolUse", type: "command", command: "echo hello" }],
    });
    expect(res.status).toBe(200);
    expect(Array.isArray((res.body as { rules: unknown[] }).rules)).toBe(true);
  });

  it("accepts empty rules array", async () => {
    const res = await request("PUT", `${baseUrl}/api/agents/${agentPath}`, { rules: [] });
    expect(res.status).toBe(200);
  });
});

describe("PUT /api/agents/:id/hooks — invalid rules (400 responses)", () => {
  it("rejects invalid event name", async () => {
    const res = await request("PUT", `${baseUrl}/api/agents/${agentPath}`, {
      rules: [{ id: "r1", event: "BogusEvent", type: "http", url: HOOK_URL }],
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/invalid event/);
  });

  it("rejects invalid type", async () => {
    const res = await request("PUT", `${baseUrl}/api/agents/${agentPath}`, {
      rules: [{ id: "r1", event: "PreToolUse", type: "webhook", url: HOOK_URL }],
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/invalid type/);
  });

  it("rejects http rule with command field set", async () => {
    const res = await request("PUT", `${baseUrl}/api/agents/${agentPath}`, {
      rules: [{ id: "r1", event: "PreToolUse", type: "http", url: HOOK_URL, command: "echo hi" }],
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/command must not be set/);
  });

  it("rejects command rule with url field set", async () => {
    const res = await request("PUT", `${baseUrl}/api/agents/${agentPath}`, {
      rules: [{ id: "r1", event: "PreToolUse", type: "command", command: "echo hi", url: HOOK_URL }],
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/url must not be set/);
  });

  it("rejects timeout greater than 60000ms", async () => {
    const res = await request("PUT", `${baseUrl}/api/agents/${agentPath}`, {
      rules: [{ id: "r1", event: "PreToolUse", type: "http", url: HOOK_URL, timeout: 99999 }],
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/timeout must be/);
  });

  it("rejects dangerous command (rm -rf /)", async () => {
    const res = await request("PUT", `${baseUrl}/api/agents/${agentPath}`, {
      rules: [{ id: "r1", event: "PreToolUse", type: "command", command: "rm -rf /" }],
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/command rejected/);
  });

  it("rejects more than 20 rules", async () => {
    const rules = Array.from({ length: 21 }, (_, i) => ({
      id: `r${i}`,
      event: "Stop",
      type: "command",
      command: "echo hi",
    }));
    const res = await request("PUT", `${baseUrl}/api/agents/${agentPath}`, { rules });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/max 20 rules/);
  });

  it("rejects invalid matcher regex", async () => {
    const res = await request("PUT", `${baseUrl}/api/agents/${agentPath}`, {
      rules: [{ id: "r1", event: "PreToolUse", type: "http", url: HOOK_URL, matcher: "[invalid regex(" }],
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/not a valid regex/);
  });
});

describe("PUT /api/agents/:id/hooks — storage failure returns 500", () => {
  it("returns 500 when setHookConfig rejects", async () => {
    const { setHookConfig } = await import("../hook-config-store");
    const mock = setHookConfig as ReturnType<typeof vi.fn>;
    mock.mockRejectedValueOnce(new Error("ENOSPC: no space left on device"));

    const res = await request("PUT", `${baseUrl}/api/agents/${agentPath}`, {
      rules: [{ id: "r1", event: "Stop", type: "command", command: "echo hi" }],
    });
    expect(res.status).toBe(500);
    expect((res.body as { error: string }).error).toBe("Failed to save hook config");

    mock.mockImplementation((_agentId: string, rules: unknown[]) =>
      Promise.resolve({ agentId: AGENT, rules, updatedAt: new Date().toISOString() }),
    );
  });
});
