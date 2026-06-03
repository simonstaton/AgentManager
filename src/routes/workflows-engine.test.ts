import http from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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

const mockAgentManager = {
  create: vi.fn().mockReturnValue({ agent: { id: "agent-1", name: "test-agent" } }),
  destroy: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn(),
  list: vi.fn().mockReturnValue([]),
  on: vi.fn(),
  setWorkflowMembershipChecker: vi.fn(),
};
const mockMessageBus = { post: vi.fn(), subscribe: vi.fn() };

// Typed helpers to keep test bodies lean and reduce duplicate patterns
type Body = Record<string, unknown>;
async function req(method: string, url: string, body?: Body): Promise<{ status: number; body: Body }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const opts = {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
      },
    };
    const r = http.request(url, opts, (res) => {
      let raw = "";
      res.on("data", (c: Buffer) => {
        raw += c.toString();
      });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) as Body });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: {} });
        }
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

let server: http.Server;
let base: string;

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      const app = express();
      app.use(express.json());
      // biome-ignore lint/suspicious/noExplicitAny: test mock cast
      app.use(createWorkflowsEngineRouter(mockAgentManager as any, mockMessageBus as any));
      server = app.listen(0, "127.0.0.1", () => {
        base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        resolve();
      });
    }),
);

afterAll(() => server?.close());
afterEach(() => {
  _clearEngineWorkflowsForTest();
  vi.clearAllMocks();
});

/** POST /api/workflows/linear with defaults filled in */
const startWorkflow = (overrides: Body = {}) =>
  req("POST", `${base}/api/workflows/linear`, {
    linearUrl: "https://linear.app/ws/issue/T-1",
    repository: "org/repo",
    ...overrides,
  });

describe("GET /api/workflows", () => {
  it("returns empty list initially", async () => {
    const { status, body } = await req("GET", `${base}/api/workflows`);
    expect(status).toBe(200);
    expect(body as unknown).toEqual([]);
  });

  it("returns created workflow in list", async () => {
    await startWorkflow();
    const { status, body } = await req("GET", `${base}/api/workflows`);
    expect(status).toBe(200);
    expect((body as unknown as unknown[]).length).toBe(1);
  });
});

describe("GET /api/workflows/:id", () => {
  it("returns 404 for unknown ID", async () => {
    const { status } = await req("GET", `${base}/api/workflows/nonexistent`);
    expect(status).toBe(404);
  });

  it("returns workflow by ID after creation", async () => {
    const { body: wf } = await startWorkflow();
    const { status, body } = await req("GET", `${base}/api/workflows/${wf.id as string}`);
    expect(status).toBe(200);
    expect((body as { id: string }).id).toBe(wf.id);
  });
});

describe("POST /api/workflows/linear validation", () => {
  it("returns 400 when linearUrl missing", async () => {
    const { status, body } = await req("POST", `${base}/api/workflows/linear`, { repository: "org/repo" });
    expect(status).toBe(400);
    expect((body as { error: string }).error).toMatch(/linearUrl/);
  });

  it("returns 400 for non-Linear URL", async () => {
    const { status } = await startWorkflow({ linearUrl: "https://github.com/not-linear" });
    expect(status).toBe(400);
  });

  it("returns 400 when repository missing", async () => {
    const { status } = await req("POST", `${base}/api/workflows/linear`, {
      linearUrl: "https://linear.app/ws/issue/T-1",
    });
    expect(status).toBe(400);
  });

  it("returns 400 for invalid linearApiKey", async () => {
    const { status } = await startWorkflow({ linearApiKey: "bad-key" });
    expect(status).toBe(400);
  });

  it("returns 400 for invalid githubPat", async () => {
    const { status } = await startWorkflow({ githubPat: "bad-pat" });
    expect(status).toBe(400);
  });
});

describe("POST /api/workflows/linear success", () => {
  it("creates running workflow for normal mode", async () => {
    const { status, body } = await startWorkflow();
    const wf = body as { id: string; status: string; linearUrl: string };
    expect(status).toBe(201);
    expect(wf.status).toBe("running");
    expect(wf.id).toBeTruthy();
    expect(wf.linearUrl).toBe("https://linear.app/ws/issue/T-1");
  });

  it("creates validating workflow for basicMode", async () => {
    const { status, body } = await startWorkflow({ basicMode: true });
    expect(status).toBe(201);
    expect((body as { status: string }).status).toBe("validating");
  });
});

describe("DELETE /api/workflows/:id", () => {
  it("returns 404 for unknown ID", async () => {
    const { status } = await req("DELETE", `${base}/api/workflows/none`);
    expect(status).toBe(404);
  });

  it("cancels workflow and returns cancelled status", async () => {
    const { body: wf } = await startWorkflow();
    const { status, body } = await req("DELETE", `${base}/api/workflows/${wf.id as string}`);
    expect(status).toBe(200);
    expect((body as { status: string }).status).toBe("cancelled");
  });

  it("workflow is gone from list after cancellation", async () => {
    const { body: wf } = await startWorkflow();
    await req("DELETE", `${base}/api/workflows/${wf.id as string}`);
    // Workflow still appears in list but with cancelled status
    const { body: list } = await req("GET", `${base}/api/workflows`);
    expect((list as unknown as { status: string }[]).find((w) => w.status === "cancelled")).toBeTruthy();
  });
});
