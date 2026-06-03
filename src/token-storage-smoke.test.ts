import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./service-mapping.json", () => ({
  default: { envToService: { GITHUB_TOKEN: "github" }, serviceToEnv: { github: "GITHUB_TOKEN" } },
}));

vi.mock("./logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

let tmpDir: string;
beforeEach(() => { tmpDir = mkdtempSync(path.join(os.tmpdir(), "ts-test-")); });
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); vi.resetModules(); });

describe("token-storage constants", async () => {
  it("ENV_TO_SERVICE and SERVICE_TO_ENV are populated", async () => {
    const { ENV_TO_SERVICE, SERVICE_TO_ENV, KNOWN_SERVICES } = await import("./token-storage");
    expect(typeof ENV_TO_SERVICE).toBe("object");
    expect(typeof SERVICE_TO_ENV).toBe("object");
    expect(KNOWN_SERVICES.size).toBeGreaterThan(0);
  });
});
