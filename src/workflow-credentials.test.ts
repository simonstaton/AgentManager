import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteWorkflowCredentials,
  invalidateKeyCache,
  loadWorkflowCredentials,
  storeWorkflowCredentials,
  writeMcpOverride,
} from "./workflow-credentials";

/**
 * The module binds CREDS_DIR at import time from WORKFLOW_CREDS_DIR env var
 * (falling back to /persistent/workflow-creds).  Tests work against whatever
 * directory the module resolved at startup and clean up their own files.
 */

// Stable key for all tests
const TEST_KEY = "workflow-creds-test-encryption-key-12345678";
// Track UUIDs created in each test so afterEach can clean them up
const createdIds: string[] = [];

beforeEach(() => {
  process.env.ENCRYPTION_KEY = TEST_KEY;
  delete process.env.JWT_SECRET;
  invalidateKeyCache();
  createdIds.length = 0;
});

afterEach(() => {
  // Delete any credential files created by this test
  for (const id of createdIds) {
    try {
      deleteWorkflowCredentials(id);
    } catch {
      // ignore
    }
  }
  process.env.ENCRYPTION_KEY = TEST_KEY;
  invalidateKeyCache();
});

/** Helper: store creds and register id for cleanup */
function store(id: string, creds: { linearApiKey?: string; githubPat?: string }) {
  createdIds.push(id);
  return storeWorkflowCredentials(id, creds);
}

// ── AES-256-GCM encrypt/decrypt round-trip ───────────────────────────────────

describe("AES-256-GCM encrypt/decrypt round-trip", () => {
  it("store then load returns identical credentials", () => {
    const id = crypto.randomUUID();
    const input = {
      linearApiKey: "lin_api_test_key_12345678",
      githubPat: "ghp_testPAT1234567890abcdef",
    };

    store(id, input);

    const loaded = loadWorkflowCredentials(id);
    expect(loaded).not.toBeNull();
    expect(loaded!.linearApiKey).toBe(input.linearApiKey);
    expect(loaded!.githubPat).toBe(input.githubPat);
    expect(loaded!.workflowId).toBe(id);
  });

  it("ciphertext differs on each store (random IV ensures semantic security)", () => {
    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();
    createdIds.push(id1, id2);

    storeWorkflowCredentials(id1, { linearApiKey: "lin_api_same_key_12345678" });
    storeWorkflowCredentials(id2, { linearApiKey: "lin_api_same_key_12345678" });

    // Load raw ciphertext from the two files to compare
    const { getCredsFilePath } = (() => {
      // We can't import the private helper, so resolve the path ourselves
      const dir = process.env.WORKFLOW_CREDS_DIR || "/persistent/workflow-creds";
      return {
        getCredsFilePath: (wid: string) => path.join(dir, `${wid}.json`),
      };
    })();

    const enc1 = (JSON.parse(fs.readFileSync(getCredsFilePath(id1), "utf8")) as { encrypted: string }).encrypted;
    const enc2 = (JSON.parse(fs.readFileSync(getCredsFilePath(id2), "utf8")) as { encrypted: string }).encrypted;
    expect(enc1).not.toBe(enc2);
  });

  it("decryption fails gracefully for tampered ciphertext", () => {
    const id = crypto.randomUUID();
    createdIds.push(id);
    storeWorkflowCredentials(id, { linearApiKey: "lin_api_tamper_test_12345" });

    const dir = process.env.WORKFLOW_CREDS_DIR || "/persistent/workflow-creds";
    const filePath = path.join(dir, `${id}.json`);
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      encrypted: string;
      [k: string]: unknown;
    };
    // Corrupt the last two base64 chars of the ciphertext (auth-tag or data)
    const enc = parsed.encrypted;
    parsed.encrypted = `${enc.slice(0, -2)}${enc.endsWith("AA") ? "BB" : "AA"}`;
    fs.writeFileSync(filePath, JSON.stringify(parsed));

    expect(loadWorkflowCredentials(id)).toBeNull();
  });
});

// ── storeWorkflowCredentials ─────────────────────────────────────────────────

describe("storeWorkflowCredentials", () => {
  it("returns the credentials with expiresAt ~4h in the future", () => {
    const id = crypto.randomUUID();
    const before = Date.now();
    const result = store(id, { githubPat: "ghp_expire_test_12345678" });
    const after = Date.now();

    const expiresAtMs = new Date(result.expiresAt).getTime();
    const fourHoursMs = 4 * 60 * 60 * 1000;
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + fourHoursMs);
    expect(expiresAtMs).toBeLessThanOrEqual(after + fourHoursMs + 1000);
  });

  it("stores only the provided fields (partial creds)", () => {
    const id = crypto.randomUUID();
    store(id, { linearApiKey: "lin_api_partial_12345678" });

    const loaded = loadWorkflowCredentials(id);
    expect(loaded!.linearApiKey).toBe("lin_api_partial_12345678");
    expect(loaded!.githubPat).toBeUndefined();
  });

  it("sanitizes path-traversal characters from workflowId (strips ../ to safe chars)", () => {
    // "../evil" strips to "evil" — traversal chars removed, no throw, no path escape
    const dir = process.env.WORKFLOW_CREDS_DIR || "/persistent/workflow-creds";
    storeWorkflowCredentials("../evil", { linearApiKey: "lin_api_test_12345678" });
    createdIds.push("../evil");
    // File must be inside creds dir (safe path), NOT outside it
    expect(fs.existsSync(path.join(dir, "evil.json"))).toBe(true);
    // Clean up evil.json directly since afterEach uses deleteWorkflowCredentials("../evil")
    // which also maps to evil.json — so that's fine
  });

  it("throws for workflowId that strips to empty string", () => {
    // "..." strips all chars to "" — module should throw Invalid workflowId
    expect(() => storeWorkflowCredentials("...", { linearApiKey: "lin_api_test_12345678" })).toThrow(
      /Invalid workflowId/,
    );
  });

  it("overwrites a previous credential file for the same workflowId", () => {
    const id = crypto.randomUUID();
    store(id, { linearApiKey: "lin_api_first_value_12345" });
    store(id, { linearApiKey: "lin_api_second_value_12345" });

    expect(loadWorkflowCredentials(id)!.linearApiKey).toBe("lin_api_second_value_12345");
  });
});

// ── loadWorkflowCredentials ───────────────────────────────────────────────────

describe("loadWorkflowCredentials", () => {
  it("returns null for an unknown workflowId", () => {
    expect(loadWorkflowCredentials(crypto.randomUUID())).toBeNull();
  });

  it("returns the workflowId field in the result", () => {
    const id = crypto.randomUUID();
    store(id, { linearApiKey: "lin_api_id_check_12345678" });
    expect(loadWorkflowCredentials(id)!.workflowId).toBe(id);
  });

  it("returns null and deletes the file for expired credentials", () => {
    const id = crypto.randomUUID();
    store(id, { linearApiKey: "lin_api_ttl_test_12345678" });

    const dir = process.env.WORKFLOW_CREDS_DIR || "/persistent/workflow-creds";
    const filePath = path.join(dir, `${id}.json`);
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as { expiresAt: string; [k: string]: unknown };
    raw.expiresAt = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(filePath, JSON.stringify(raw));

    expect(loadWorkflowCredentials(id)).toBeNull();
    expect(fs.existsSync(filePath)).toBe(false);
    // Already deleted — remove from cleanup list to avoid double-delete noise
    const idx = createdIds.indexOf(id);
    if (idx !== -1) createdIds.splice(idx, 1);
  });
});

// ── 4h TTL expiry logic ───────────────────────────────────────────────────────

describe("4h TTL expiry", () => {
  it("expiresAt is exactly ~4h after createdAt", () => {
    const id = crypto.randomUUID();
    const result = store(id, { linearApiKey: "lin_api_time_check_1234" });

    const created = new Date(result.createdAt).getTime();
    const expires = new Date(result.expiresAt).getTime();
    const fourHoursMs = 4 * 60 * 60 * 1000;

    expect(expires - created).toBeGreaterThanOrEqual(fourHoursMs - 100);
    expect(expires - created).toBeLessThanOrEqual(fourHoursMs + 1000);
  });

  it("credentials within TTL are loaded successfully", () => {
    const id = crypto.randomUUID();
    store(id, { linearApiKey: "lin_api_valid_ttl_12345678" });
    expect(loadWorkflowCredentials(id)).not.toBeNull();
  });
});

// ── deleteWorkflowCredentials ─────────────────────────────────────────────────

describe("deleteWorkflowCredentials", () => {
  it("removes the credentials so subsequent load returns null", () => {
    const id = crypto.randomUUID();
    store(id, { linearApiKey: "lin_api_delete_test_12345" });
    deleteWorkflowCredentials(id);
    const idx = createdIds.indexOf(id);
    if (idx !== -1) createdIds.splice(idx, 1);

    expect(loadWorkflowCredentials(id)).toBeNull();
  });

  it("is a no-op for a non-existent workflowId", () => {
    expect(() => deleteWorkflowCredentials(crypto.randomUUID())).not.toThrow();
  });
});

// ── writeMcpOverride ──────────────────────────────────────────────────────────

describe("writeMcpOverride", () => {
  it("creates .claude/settings.json with the Linear MCP entry", () => {
    const workspaceDir = path.join(os.tmpdir(), `wt-mcp-test-${Date.now()}`);
    fs.mkdirSync(workspaceDir, { recursive: true });

    try {
      writeMcpOverride(workspaceDir, "lin_api_mcp_test_key_12345");

      const settingsPath = path.join(workspaceDir, ".claude", "settings.json");
      expect(fs.existsSync(settingsPath)).toBe(true);

      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
        mcpServers: { linear: { headers: { Authorization: string } } };
      };
      expect(settings.mcpServers.linear.headers.Authorization).toBe("Bearer lin_api_mcp_test_key_12345");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("preserves existing mcpServers entries from global settings", () => {
    const workspaceDir = path.join(os.tmpdir(), `wt-mcp-preserve-${Date.now()}`);
    const claudeHome = path.join(os.tmpdir(), `.claude-global-test-${Date.now()}`);
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(claudeHome, { recursive: true });

    const origClaudeHome = process.env.CLAUDE_HOME;
    process.env.CLAUDE_HOME = claudeHome;

    fs.writeFileSync(
      path.join(claudeHome, "settings.json"),
      JSON.stringify({
        mcpServers: { github: { type: "http", url: "https://api.github.com" } },
      }),
    );

    try {
      writeMcpOverride(workspaceDir, "lin_api_preserve_key_12345");

      const settings = JSON.parse(fs.readFileSync(path.join(workspaceDir, ".claude", "settings.json"), "utf8")) as {
        mcpServers: { github?: unknown; linear?: unknown };
      };

      expect(settings.mcpServers.github).toBeDefined();
      expect(settings.mcpServers.linear).toBeDefined();
    } finally {
      process.env.CLAUDE_HOME = origClaudeHome;
      fs.rmSync(workspaceDir, { recursive: true, force: true });
      fs.rmSync(claudeHome, { recursive: true, force: true });
    }
  });
});

// ── key derivation ────────────────────────────────────────────────────────────

describe("key derivation", () => {
  it("falls back to JWT_SECRET when ENCRYPTION_KEY is not set", () => {
    delete process.env.ENCRYPTION_KEY;
    process.env.JWT_SECRET = "fallback-jwt-secret-for-tests-12345678";
    invalidateKeyCache();

    const id = crypto.randomUUID();
    createdIds.push(id);
    const result = storeWorkflowCredentials(id, { linearApiKey: "lin_api_jwt_fallback_12345" });
    expect(result.linearApiKey).toBe("lin_api_jwt_fallback_12345");

    const loaded = loadWorkflowCredentials(id);
    expect(loaded!.linearApiKey).toBe("lin_api_jwt_fallback_12345");
  });

  it("throws when neither ENCRYPTION_KEY nor JWT_SECRET is set", () => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.JWT_SECRET;
    invalidateKeyCache();

    expect(() => storeWorkflowCredentials(crypto.randomUUID(), { linearApiKey: "lin_api_no_key_12345678" })).toThrow(
      /No encryption key available/,
    );
  });

  it("credentials encrypted with one key cannot be decrypted with a different key", () => {
    const id = crypto.randomUUID();
    createdIds.push(id);
    store(id, { linearApiKey: "lin_api_cross_key_12345678" });

    // Rotate to a different key
    process.env.ENCRYPTION_KEY = "different-test-encryption-key-for-workflow-12345";
    invalidateKeyCache();

    expect(loadWorkflowCredentials(id)).toBeNull();

    // Restore key so afterEach cleanup can delete the file
    process.env.ENCRYPTION_KEY = TEST_KEY;
    invalidateKeyCache();
  });
});
