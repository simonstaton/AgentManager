import http from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth", () => ({
  requireNotAgentService: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../workflow-resource-manager", () => ({
  checkWorkflowAgentLimit: vi.fn().mockReturnValue(null),
  checkMemoryForNewWorkflow: vi.fn().mockReturnValue(null),
  detectWorkflowStall: vi.fn(),
  enforceWorkflowCostCap: vi.fn(),
  WORKFLOW_MAX_AGENTS: 10,
}));
vi.mock("../workflow-triage", () => ({
  buildTriagePrompt: vi.fn().mockReturnValue("mock-triage-prompt"),
  buildValidationResult: vi.fn(),
  clarityFromChecks: vi.fn(),
  verdictFromClarity: vi.fn(),
}));

import { _clearEngineWorkflowsForTest, createWorkflowsEngineRouter } from "./workflows-engine";

function makeAgentManager() {
  return {
    create: vi.fn().mockReturnValue({ agent: { id: "agent-1", name: "test-agent" } }),
    destroy: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    on: vi.fn(),
    setWorkflowMembershipChecker: vi.fn(),
  };
}

function makeMessageBus() {
  return { post: vi.fn(), subscribe: vi.fn() };
}

async function request(method: string, url: string, body?: unknown): Promise<{ status: number; body: unknown }> {
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
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
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
  app.use(createWorkflowsEngineRouter(agentManager as any, messageBus as any));
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(() => server?.close());
afterEach(() => {
  _clearEngineWorkflowsForTest();
  vi.clearAllMocks();
});

describe("GET /api/workflows", () => {
  it("returns empty array when no workflows exist", async () => {
    const res = await request("GET", `${baseUrl}/api/workflows`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect((res.body as unknown[]).length).toBe(0);
  });
});

describe("GET /api/workflows/:id", () => {
  it("returns 404 for unknown workflow ID", async () => {
    const res = await request("GET", `${baseUrl}/api/workflows/nonexistent`);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/workflows/linear", () => {
  it("returns 400 when linearUrl is missing", async () => {
    const res = await request("POST", `${baseUrl}/api/workflows/linear`, { repository: "org/repo" });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/linearUrl/);
  });

  it("returns 400 for invalid linearUrl", async () => {
    const res = await request("POST", `${baseUrl}/api/workflows/linear`, {
      linearUrl: "https://github.com/not-linear",
      repository: "org/repo",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/Invalid linearUrl/);
  });

  it("returns 400 when repository is missing", async () => {
    const res = await request("POST", `${baseUrl}/api/workflows/linear`, {
      linearUrl: "https://linear.app/myteam/issue/TEAM-123",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/repository/);
  });

  it("creates a workflow and returns 201 for valid request", async () => {
    const res = await request("POST", `${baseUrl}/api/workflows/linear`, {
      linearUrl: "https://linear.app/myteam/issue/TEAM-123",
      repository: "org/repo",
    });
    expect(res.status).toBe(201);
    const wf = res.body as { id: string; status: string; linearUrl: string };
    expect(wf.id).toBeTruthy();
    expect(wf.status).toBe("running");
    expect(wf.linearUrl).toBe("https://linear.app/myteam/issue/TEAM-123");
  });

  it("creates a validating workflow in basicMode", async () => {
    const res = await request("POST", `${baseUrl}/api/workflows/linear`, {
      linearUrl: "https://linear.app/myteam/issue/TEAM-456",
      repository: "org/repo",
      basicMode: true,
    });
    expect(res.status).toBe(201);
    expect((res.body as { status: string }).status).toBe("validating");
  });

  it("returns 400 for invalid linearApiKey format", async () => {
    const res = await request("POST", `${baseUrl}/api/workflows/linear`, {
      linearUrl: "https://linear.app/myteam/issue/TEAM-123",
      repository: "org/repo",
      linearApiKey: "not-a-valid-key",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/linearApiKey/);
  });
});

describe("DELETE /api/workflows/:id", () => {
  it("returns 404 for unknown workflow", async () => {
    const res = await request("DELETE", `${baseUrl}/api/workflows/nonexistent`);
    expect(res.status).toBe(404);
  });

  it("cancels an existing workflow", async () => {
    // First create one
    const createRes = await request("POST", `${baseUrl}/api/workflows/linear`, {
      linearUrl: "https://linear.app/myteam/issue/TEAM-789",
      repository: "org/repo",
    });
    const id = (createRes.body as { id: string }).id;

    const deleteRes = await request("DELETE", `${baseUrl}/api/workflows/${id}`);
    expect(deleteRes.status).toBe(200);
    expect((deleteRes.body as { status: string }).status).toBe("cancelled");
  });
});
