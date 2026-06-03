import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth", () => ({
  requireHumanUser: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../templates/linear-workflow-manager-prompt", () => ({
  buildManagerPrompt: vi.fn(() => "mock-prompt"),
}));

import { createLinearWorkflowsRouter } from "./linear-workflows";

function makeAgentManager(overrides?: { spawnAgent?: unknown; get?: unknown }) {
  return {
    spawnAgent: vi.fn().mockResolvedValue({ id: "agent-123", name: "test-agent" }),
    get: vi.fn().mockReturnValue(null),
    list: vi.fn().mockReturnValue([]),
    on: vi.fn(),
    ...overrides,
  };
}

function makeMessageBus() {
  return { post: vi.fn(), subscribe: vi.fn() };
}

async function request(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      url,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => {
          raw += chunk.toString();
        });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) as Record<string, unknown> });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: {} });
          }
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

let server: http.Server;
let baseUrl: string;
let agentManager: ReturnType<typeof makeAgentManager>;
let messageBus: ReturnType<typeof makeMessageBus>;

beforeAll(async () => {
  agentManager = makeAgentManager();
  messageBus = makeMessageBus();
  const app = express();
  app.use(express.json());
  // biome-ignore lint/suspicious/noExplicitAny: test mock cast
  app.use(createLinearWorkflowsRouter(agentManager as any, messageBus as any));
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server?.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/linear-workflows", () => {
  it("returns empty array when no workflows exist", async () => {
    const res = await request("GET", `${baseUrl}/api/linear-workflows`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("GET /api/linear-workflows/:id", () => {
  it("returns 404 for unknown workflow ID", async () => {
    const res = await request("GET", `${baseUrl}/api/linear-workflows/nonexistent-id`);
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/linear-workflows/:id", () => {
  it("returns 404 when workflow does not exist", async () => {
    const res = await request("DELETE", `${baseUrl}/api/linear-workflows/nonexistent-id`);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/linear-workflows/linear", () => {
  it("returns 400 when linearTicketUrl is missing", async () => {
    const res = await request("POST", `${baseUrl}/api/linear-workflows/linear`, {});
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid linearTicketUrl format", async () => {
    const res = await request("POST", `${baseUrl}/api/linear-workflows/linear`, {
      linearTicketUrl: "not-a-linear-url",
    });
    expect(res.status).toBe(400);
  });
});
