/**
 * token-storage.test.ts
 *
 * Uses vi.resetModules() + dynamic import in beforeEach so that token-storage
 * reads MCP_TOKEN_DIR / TOKEN_DIR fresh for each test (the constant is evaluated
 * at module load time, not lazily).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We re-import these types in each test via the `mod` variable below.
import type { StoredToken } from "./token-storage";

type Mod = typeof import("./token-storage");

let tokenDir: string;
let mod: Mod;
let registerSecretValue: ReturnType<typeof vi.fn>;
let unregisterSecretValue: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  tokenDir = fs.mkdtempSync(path.join(os.tmpdir(), "token-storage-test-"));
  process.env.MCP_TOKEN_DIR = tokenDir;

  vi.resetModules();

  registerSecretValue = vi.fn();
  unregisterSecretValue = vi.fn();

  vi.doMock("./logger", () => ({
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  }));

  vi.doMock("./sanitize", () => ({
    registerSecretValue,
    unregisterSecretValue,
  }));

  mod = await import("./token-storage");
});

afterEach(() => {
  if (fs.existsSync(tokenDir)) {
    fs.rmSync(tokenDir, { recursive: true, force: true });
  }
  delete process.env.MCP_TOKEN_DIR;
  delete process.env.GITHUB_TOKEN;
  delete process.env.LINEAR_API_KEY;
  vi.clearAllMocks();
});

describe("ensureTokenDir", () => {
  it("does not throw if directory already exists", () => {
    expect(() => mod.ensureTokenDir()).not.toThrow();
  });
});

describe("loadToken — no stored file", () => {
  it("returns null when the token file does not exist", () => {
    expect(mod.loadToken("github")).toBeNull();
  });
});

describe("saveToken / loadToken round-trip", () => {
  it("persists a UI token and reads it back", () => {
    const token: StoredToken = {
      server: "github",
      token: "test_token_abc123",
      source: "ui",
      label: "my-gh-token",
      setAt: new Date().toISOString(),
    };
    mod.saveToken(token);
    const loaded = mod.loadToken("github");
    expect(loaded?.token).toBe("test_token_abc123");
    expect(loaded?.source).toBe("ui");
    expect(loaded?.label).toBe("my-gh-token");
  });

  it("persists an OAuth token and reads it back", () => {
    mod.saveToken({
      server: "linear",
      accessToken: "lin_oauth_abcdefgh",
      refreshToken: "lin_refresh_xyz",
      tokenType: "Bearer",
      source: "oauth",
    });
    const loaded = mod.loadToken("linear");
    expect(loaded?.accessToken).toBe("lin_oauth_abcdefgh");
    expect(loaded?.refreshToken).toBe("lin_refresh_xyz");
  });

  it("registers the secret with sanitize on save", () => {
    mod.saveToken({ server: "figma", token: "figma-secret-value", source: "ui" });
    expect(registerSecretValue).toHaveBeenCalledWith("figma-secret-value");
  });

  it("returns cached token without re-reading disk", () => {
    mod.saveToken({ server: "github", token: "cached-token-12", source: "ui" });
    fs.unlinkSync(path.join(tokenDir, "github.json"));
    expect(mod.loadToken("github")?.token).toBe("cached-token-12");
  });
});

describe("deleteToken", () => {
  it("removes the token file and cache entry", () => {
    mod.saveToken({ server: "github", token: "test_token_del012", source: "ui" });
    mod.deleteToken("github");
    expect(mod.loadToken("github")).toBeNull();
    expect(fs.existsSync(path.join(tokenDir, "github.json"))).toBe(false);
  });

  it("calls unregisterSecretValue with the stored token value", () => {
    mod.saveToken({ server: "figma", token: "figma-secret-del1", source: "ui" });
    vi.clearAllMocks();
    mod.deleteToken("figma");
    expect(unregisterSecretValue).toHaveBeenCalledWith("figma-secret-del1");
  });

  it("is a no-op when no token exists", () => {
    expect(() => mod.deleteToken("nonexistent")).not.toThrow();
  });
});

describe("listStoredTokens", () => {
  it("returns empty array when no tokens are stored", () => {
    expect(mod.listStoredTokens()).toEqual([]);
  });

  it("returns all stored service names", () => {
    mod.saveToken({ server: "github", token: "test_token_lst001", source: "ui" });
    mod.saveToken({ server: "linear", token: "lin_list_test01", source: "ui" });
    const stored = mod.listStoredTokens();
    expect(stored.sort()).toEqual(["github", "linear"].sort());
  });
});

describe("getAllTokens", () => {
  it("returns all stored tokens as objects", () => {
    mod.saveToken({ server: "github", token: "test_token_all001", source: "ui" });
    mod.saveToken({ server: "figma", token: "fig_all_test0001", source: "ui" });
    const all = mod.getAllTokens();
    expect(all).toHaveLength(2);
    expect(all.map((t) => t.server).sort()).toEqual(["figma", "github"].sort());
  });
});

describe("isTokenExpired", () => {
  it("returns false when no expiresAt is set", () => {
    expect(mod.isTokenExpired({ server: "github", source: "oauth" })).toBe(false);
  });

  it("returns true for a past expiry date", () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString();
    expect(mod.isTokenExpired({ server: "github", expiresAt: pastDate, source: "oauth" })).toBe(true);
  });

  it("returns false for a future expiry date", () => {
    const futureDate = new Date(Date.now() + 3_600_000).toISOString();
    expect(mod.isTokenExpired({ server: "github", expiresAt: futureDate, source: "oauth" })).toBe(false);
  });
});

describe("getEffectiveTokenValue", () => {
  it("returns UI token value when stored", () => {
    mod.saveToken({ server: "github", token: "test_token_eff012", source: "ui" });
    expect(mod.getEffectiveTokenValue("github")).toBe("test_token_eff012");
  });

  it("returns null for expired OAuth token with no env var fallback", () => {
    delete process.env.LINEAR_API_KEY;
    mod.saveToken({
      server: "linear",
      accessToken: "lin_expired_token",
      source: "oauth",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(mod.getEffectiveTokenValue("linear")).toBeNull();
  });

  it("falls back to env var when no stored token exists", () => {
    process.env.GITHUB_TOKEN = "env-github-token";
    expect(mod.getEffectiveTokenValue("github")).toBe("env-github-token");
  });
});

describe("getTokenStatuses", () => {
  it("marks a service as configured when UI token is set", () => {
    mod.saveToken({ server: "github", token: "test_token_sts123", source: "ui" });
    const statuses = mod.getTokenStatuses();
    expect(statuses.github.configured).toBe(true);
    expect(statuses.github.source).toBe("ui");
    expect(statuses.github.hint).toBe("...s123");
  });

  it("marks a service as not configured when nothing is set", () => {
    delete process.env.GITHUB_TOKEN;
    const statuses = mod.getTokenStatuses();
    expect(statuses.github.configured).toBe(false);
    expect(statuses.github.source).toBe("none");
  });

  it("exposes label and validatedUser from stored token", () => {
    mod.saveToken({
      server: "figma",
      token: "fig_status_12345",
      source: "ui",
      label: "prod-figma",
      validatedUser: "alice",
    });
    const statuses = mod.getTokenStatuses();
    expect(statuses.figma.label).toBe("prod-figma");
    expect(statuses.figma.user).toBe("alice");
  });
});

describe("invalidateTokenCache + preloadTokens", () => {
  it("forces a fresh read from disk after invalidation", () => {
    mod.saveToken({ server: "github", token: "test_token_cv1234", source: "ui" });
    const filePath = path.join(tokenDir, "github.json");
    fs.writeFileSync(filePath, JSON.stringify({ server: "github", token: "test_token_cv2234", source: "ui" }));
    expect(mod.loadToken("github")?.token).toBe("test_token_cv1234");
    mod.invalidateTokenCache();
    expect(mod.loadToken("github")?.token).toBe("test_token_cv2234");
  });

  it("preloadTokens: loads all stored tokens into cache", () => {
    mod.saveToken({ server: "github", token: "test_token_pre123", source: "ui" });
    mod.invalidateTokenCache();
    mod.preloadTokens();
    fs.unlinkSync(path.join(tokenDir, "github.json"));
    expect(mod.loadToken("github")?.token).toBe("test_token_pre123");
  });
});

describe("overwrite unregisters old secret", () => {
  it("calls unregisterSecretValue then registerSecretValue with new value", () => {
    mod.saveToken({ server: "github", token: "test_token_old123", source: "ui" });
    vi.clearAllMocks();
    mod.saveToken({ server: "github", token: "test_token_new123", source: "ui" });
    expect(unregisterSecretValue).toHaveBeenCalledWith("test_token_old123");
    expect(registerSecretValue).toHaveBeenCalledWith("test_token_new123");
  });
});

describe("service mapping exports", () => {
  it("KNOWN_SERVICES contains expected service names", () => {
    expect(mod.KNOWN_SERVICES.has("github")).toBe(true);
    expect(mod.KNOWN_SERVICES.has("linear")).toBe(true);
  });

  it("SERVICE_TO_ENV maps github to GITHUB_TOKEN", () => {
    expect(mod.SERVICE_TO_ENV.github).toBe("GITHUB_TOKEN");
  });

  it("ENV_TO_SERVICE maps GITHUB_TOKEN to github", () => {
    expect(mod.ENV_TO_SERVICE.GITHUB_TOKEN).toBe("github");
  });
});
