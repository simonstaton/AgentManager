import http from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
  buildTriagePrompt: vi.fn().mockReturnValue("prompt"),
  buildValidationResult: vi.fn(),
  clarityFromChecks: vi.fn(),
  verdictFromClarity: vi.fn(),
}));

import { createWorkflowsEngineRouter } from "./workflows-engine";

/**
 * Smoke tests verifying the engine router mounts correctly at /api/workflows.
 * This mirrors what server.ts does: app.use(createWorkflowsEngineRouter(...)).
 */
const mockAm = {
  create: vi.fn().mockReturnValue({ agent: { id: "a1", name: "test" } }),
  destroy: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn(),
  list: vi.fn().mockReturnValue([]),
  on: vi.fn(),
  setWorkflowMembershipChecker: vi.fn(),
};
const mockBus = { post: vi.fn(), subscribe: vi.fn() };

let server: http.Server;
let base: string;

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      const app = express();
      app.use(express.json());
      // biome-ignore lint/suspicious/noExplicitAny: test mock cast
      app.use(createWorkflowsEngineRouter(mockAm as any, mockBus as any));
      server = app.listen(0, "127.0.0.1", () => {
        base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        resolve();
      });
    }),
);

afterAll(() => server?.close());

async function get(path: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    http
      .get(`${base}${path}`, (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
      })
      .on("error", reject);
  });
}

describe("engine router mount verification", () => {
  it("GET /api/workflows returns 200 (engine router mounted)", async () => {
    const { status } = await get("/api/workflows");
    expect(status).toBe(200);
  });

  it("GET /api/workflows/unknown returns 404 (engine router handles :id)", async () => {
    const { status } = await get("/api/workflows/does-not-exist");
    expect(status).toBe(404);
  });

  it("engine router does not intercept unrelated paths", async () => {
    const { status } = await get("/api/health");
    expect(status).toBe(404); // not registered in this test app
  });
});
