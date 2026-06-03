/**
 * Tests for repo-gate-config routes (PR 13).
 *
 * Exercises: GET returns defaults+overrides+effective; PUT persists+merges;
 * DELETE resets; agent-service token → 403 on PUT/DELETE; invalid input → 400.
 */

import http from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_PRESET, deleteRepoGateConfig } from "../repo-gate-store";
import { createRepoGateConfigRouter } from "../routes/repo-gate-config";

// ─── Minimal test servers ─────────────────────────────────────────────────────

function buildServer(sub: string): http.Server {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as never as { user: { sub: string } }).user = { sub };
    next();
  });
  app.use(createRepoGateConfigRouter());
  return http.createServer(app);
}

let operatorServer: http.Server;
let agentServer: http.Server;
let operatorPort: number;
let agentPort: number;

beforeAll(async () => {
  operatorServer = buildServer("operator");
  agentServer = buildServer("agent-service");
  await new Promise<void>((r) => operatorServer.listen(0, r));
  await new Promise<void>((r) => agentServer.listen(0, r));
  operatorPort = (operatorServer.address() as { port: number }).port;
  agentPort = (agentServer.address() as { port: number }).port;
});

afterAll(() => {
  operatorServer.close();
  agentServer.close();
});

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
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

const REPO = "test-repo-gate-config-routes";

// ─── GET ──────────────────────────────────────────────────────────────────────

describe("GET /api/repositories/:name/gate-config", () => {
  it("returns defaults when no overrides exist", async () => {
    deleteRepoGateConfig(REPO);
    const { status, body } = await request(operatorPort, "GET", `/api/repositories/${REPO}/gate-config`);
    expect(status).toBe(200);
    expect(body.defaults).toEqual(DEFAULT_PRESET);
    expect(body.overrides).toEqual({});
    expect(body.effective).toEqual(DEFAULT_PRESET);
    expect(body.updatedAt).toBeNull();
  });

  it("returns persisted overrides after a PUT", async () => {
    await request(operatorPort, "PUT", `/api/repositories/${REPO}/gate-config`, {
      autoMergeThreshold: "medium",
    });
    const { status, body } = await request(operatorPort, "GET", `/api/repositories/${REPO}/gate-config`);
    expect(status).toBe(200);
    expect(body.overrides).toMatchObject({ autoMergeThreshold: "medium" });
    expect((body.effective as { autoMergeThreshold: string }).autoMergeThreshold).toBe("medium");
    deleteRepoGateConfig(REPO);
  });
});

// ─── PUT (operator) ───────────────────────────────────────────────────────────

describe("PUT /api/repositories/:name/gate-config — operator", () => {
  it("persists valid overrides and returns merged effective config", async () => {
    const { status, body } = await request(operatorPort, "PUT", `/api/repositories/${REPO}/gate-config`, {
      autoMergeThreshold: "medium",
    });
    expect(status).toBe(200);
    expect((body.effective as { autoMergeThreshold: string }).autoMergeThreshold).toBe("medium");
    expect(body.updatedBy).toBe("operator");
    deleteRepoGateConfig(REPO);
  });

  it("returns 400 for invalid autoMergeThreshold", async () => {
    const { status, body } = await request(operatorPort, "PUT", `/api/repositories/${REPO}/gate-config`, {
      autoMergeThreshold: "not-a-level",
    });
    expect(status).toBe(400);
    expect(typeof body.error).toBe("string");
    expect(body.error).toContain("autoMergeThreshold");
  });

  it("returns 400 for mergePolicy entry with non-boolean allowed", async () => {
    const { status, body } = await request(operatorPort, "PUT", `/api/repositories/${REPO}/gate-config`, {
      mergePolicy: { high: { allowed: "yes", reason: "ok" } },
    });
    expect(status).toBe(400);
    expect(body.error).toContain("allowed");
  });

  it("accepts loosening the critical level with audit log", async () => {
    const { status, body } = await request(operatorPort, "PUT", `/api/repositories/${REPO}/gate-config`, {
      mergePolicy: { critical: { allowed: true, reason: "this repo is safe" } },
    });
    expect(status).toBe(200);
    expect((body.effective as { mergePolicy: { critical: { allowed: boolean } } }).mergePolicy.critical.allowed).toBe(
      true,
    );
    deleteRepoGateConfig(REPO);
  });
});

// ─── PUT (agent-service → 403) ────────────────────────────────────────────────

describe("PUT /api/repositories/:name/gate-config — agent-service → 403", () => {
  it("blocks agent-service tokens", async () => {
    const { status } = await request(agentPort, "PUT", `/api/repositories/${REPO}/gate-config`, {
      autoMergeThreshold: "medium",
    });
    expect(status).toBe(403);
  });
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe("DELETE /api/repositories/:name/gate-config", () => {
  it("removes overrides and returns defaults as effective", async () => {
    await request(operatorPort, "PUT", `/api/repositories/${REPO}/gate-config`, {
      autoMergeThreshold: "medium",
    });
    const { status, body } = await request(operatorPort, "DELETE", `/api/repositories/${REPO}/gate-config`);
    expect(status).toBe(200);
    expect(body.effective).toEqual(DEFAULT_PRESET);
    expect(body.overrides).toEqual({});
  });

  it("agent-service → 403", async () => {
    const { status } = await request(agentPort, "DELETE", `/api/repositories/${REPO}/gate-config`);
    expect(status).toBe(403);
  });
});
