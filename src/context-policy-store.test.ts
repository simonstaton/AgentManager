import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let testRoot: string;
let store: typeof import("./context-policy-store");

describe("context-policy-store", () => {
  beforeEach(async () => {
    testRoot = mkdtempSync(path.join(os.tmpdir(), "context-policy-test-"));
    const policyDir = path.join(testRoot, "context-policies");
    mkdirSync(policyDir, { recursive: true });

    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");

      const patchPath = (p: unknown): string => {
        if (typeof p !== "string") return p as string;
        // Redirect /tmp/context-policies → testRoot/context-policies
        if (p.includes("/tmp/context-policies")) {
          return p.replace("/tmp/context-policies", policyDir);
        }
        // Redirect /persistent → always-missing sentinel (forces /tmp fallback)
        return p;
      };

      return {
        ...actual,
        existsSync: (p: string) => {
          if (p === "/persistent") return false;
          return actual.existsSync(patchPath(p));
        },
        mkdirSync: (p: string, options?: object) => actual.mkdirSync(patchPath(p), options),
        readFileSync: (p: string, enc?: BufferEncoding) => actual.readFileSync(patchPath(p), enc),
        unlinkSync: (p: string) => actual.unlinkSync(patchPath(p)),
      };
    });

    vi.doMock("node:fs/promises", async () => {
      const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
      const policyDirLocal = policyDir; // capture for closure

      const patchPath = (p: unknown): string => {
        if (typeof p !== "string") return p as string;
        if (p.includes("/tmp/context-policies")) {
          return p.replace("/tmp/context-policies", policyDirLocal);
        }
        return p;
      };

      return {
        ...actual,
        writeFile: (p: string, data: string, enc?: BufferEncoding) => actual.writeFile(patchPath(p), data, enc),
        rename: (from: string, to: string) => actual.rename(patchPath(from), patchPath(to)),
      };
    });

    vi.resetModules();
    store = await import("./context-policy-store");
  });

  afterEach(() => {
    vi.doUnmock("node:fs");
    vi.doUnmock("node:fs/promises");
    vi.resetModules();

    if (testRoot && existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  // ── Constants ────────────────────────────────────────────────────────────────

  describe("exported constants", () => {
    it("THRESHOLD_MIN is 0.5", () => expect(store.THRESHOLD_MIN).toBe(0.5));
    it("THRESHOLD_MAX is 0.9", () => expect(store.THRESHOLD_MAX).toBe(0.9));
    it("THRESHOLD_DEFAULT is 0.72", () => expect(store.THRESHOLD_DEFAULT).toBe(0.72));
    it("COOLDOWN_MIN is 1", () => expect(store.COOLDOWN_MIN).toBe(1));
    it("COOLDOWN_MAX is 50", () => expect(store.COOLDOWN_MAX).toBe(50));
    it("COOLDOWN_DEFAULT is 3", () => expect(store.COOLDOWN_DEFAULT).toBe(3));
    it("GLOBAL_SCOPE is 'default'", () => expect(store.GLOBAL_SCOPE).toBe("default"));

    it("BUILTIN_DEFAULT has fully resolved autoReset", () => {
      expect(store.BUILTIN_DEFAULT.autoReset).toEqual({
        enabled: true,
        threshold: store.THRESHOLD_DEFAULT,
        cooldownTurns: store.COOLDOWN_DEFAULT,
      });
    });

    it("POLICY_BOUNDS exposes correct ranges", () => {
      expect(store.POLICY_BOUNDS.autoReset.threshold).toEqual({
        min: store.THRESHOLD_MIN,
        max: store.THRESHOLD_MAX,
      });
      expect(store.POLICY_BOUNDS.autoReset.cooldownTurns).toEqual({
        min: store.COOLDOWN_MIN,
        max: store.COOLDOWN_MAX,
      });
    });
  });

  // ── getGlobalPolicy before any writes ────────────────────────────────────────

  describe("getGlobalPolicy (no file on disk)", () => {
    it("returns empty policy with empty updatedAt", () => {
      const record = store.getGlobalPolicy();
      expect(record.scope).toBe(store.GLOBAL_SCOPE);
      expect(record.policy).toEqual({});
      expect(record.updatedAt).toBe("");
    });
  });

  // ── getAgentPolicy before any writes ─────────────────────────────────────────

  describe("getAgentPolicy (no file on disk)", () => {
    it("returns empty policy for unknown agentId", () => {
      const record = store.getAgentPolicy("agent-xyz");
      expect(record.scope).toBe("agent-xyz");
      expect(record.policy).toEqual({});
      expect(record.updatedAt).toBe("");
    });
  });

  // ── setGlobalPolicy ──────────────────────────────────────────────────────────

  describe("setGlobalPolicy", () => {
    it("persists and returns the sanitized record", async () => {
      const saved = await store.setGlobalPolicy({ autoReset: { enabled: false, threshold: 0.8, cooldownTurns: 5 } });
      expect(saved.scope).toBe(store.GLOBAL_SCOPE);
      expect(saved.policy.autoReset?.enabled).toBe(false);
      expect(saved.policy.autoReset?.threshold).toBe(0.8);
      expect(saved.policy.autoReset?.cooldownTurns).toBe(5);
      expect(saved.updatedAt).not.toBe("");
    });

    it("round-trips: getGlobalPolicy returns what was set", async () => {
      await store.setGlobalPolicy({ autoReset: { threshold: 0.75 } });
      const record = store.getGlobalPolicy();
      expect(record.policy.autoReset?.threshold).toBe(0.75);
    });

    it("overwrites a previous global policy", async () => {
      await store.setGlobalPolicy({ autoReset: { threshold: 0.6 } });
      await store.setGlobalPolicy({ autoReset: { threshold: 0.85 } });
      const record = store.getGlobalPolicy();
      expect(record.policy.autoReset?.threshold).toBe(0.85);
    });

    it("clamps threshold below THRESHOLD_MIN to THRESHOLD_MIN", async () => {
      await store.setGlobalPolicy({ autoReset: { threshold: 0.1 } });
      const record = store.getGlobalPolicy();
      expect(record.policy.autoReset?.threshold).toBe(store.THRESHOLD_MIN);
    });

    it("clamps threshold above THRESHOLD_MAX to THRESHOLD_MAX", async () => {
      await store.setGlobalPolicy({ autoReset: { threshold: 0.99 } });
      const record = store.getGlobalPolicy();
      expect(record.policy.autoReset?.threshold).toBe(store.THRESHOLD_MAX);
    });

    it("clamps cooldownTurns below COOLDOWN_MIN to COOLDOWN_MIN", async () => {
      await store.setGlobalPolicy({ autoReset: { cooldownTurns: 0 } });
      const record = store.getGlobalPolicy();
      expect(record.policy.autoReset?.cooldownTurns).toBe(store.COOLDOWN_MIN);
    });

    it("clamps cooldownTurns above COOLDOWN_MAX to COOLDOWN_MAX", async () => {
      await store.setGlobalPolicy({ autoReset: { cooldownTurns: 99 } });
      const record = store.getGlobalPolicy();
      expect(record.policy.autoReset?.cooldownTurns).toBe(store.COOLDOWN_MAX);
    });

    it("rounds fractional cooldownTurns to nearest integer", async () => {
      await store.setGlobalPolicy({ autoReset: { cooldownTurns: 3.7 } });
      const record = store.getGlobalPolicy();
      expect(record.policy.autoReset?.cooldownTurns).toBe(4);
    });

    it("strips unknown top-level fields (no autoReset set → empty policy)", async () => {
      // empty patch — nothing to sanitize
      const saved = await store.setGlobalPolicy({});
      expect(saved.policy).toEqual({});
    });

    it("stores updatedAt as an ISO timestamp string", async () => {
      const before = Date.now();
      const saved = await store.setGlobalPolicy({ autoReset: { enabled: true } });
      const after = Date.now();
      const ts = new Date(saved.updatedAt).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });

  // ── setAgentPolicy ───────────────────────────────────────────────────────────

  describe("setAgentPolicy", () => {
    it("persists a per-agent override", async () => {
      const saved = await store.setAgentPolicy("agent-abc", { autoReset: { enabled: false } });
      expect(saved.scope).toBe("agent-abc");
      expect(saved.policy.autoReset?.enabled).toBe(false);
      expect(saved.updatedAt).not.toBe("");
    });

    it("round-trips: getAgentPolicy returns what was set", async () => {
      await store.setAgentPolicy("agent-1", { autoReset: { cooldownTurns: 10 } });
      const record = store.getAgentPolicy("agent-1");
      expect(record.policy.autoReset?.cooldownTurns).toBe(10);
    });

    it("different agents are stored independently", async () => {
      await store.setAgentPolicy("agent-A", { autoReset: { threshold: 0.6 } });
      await store.setAgentPolicy("agent-B", { autoReset: { threshold: 0.8 } });
      expect(store.getAgentPolicy("agent-A").policy.autoReset?.threshold).toBe(0.6);
      expect(store.getAgentPolicy("agent-B").policy.autoReset?.threshold).toBe(0.8);
    });
  });

  // ── deleteAgentPolicy ────────────────────────────────────────────────────────

  describe("deleteAgentPolicy", () => {
    it("is a no-op for a non-existent agent (does not throw)", () => {
      expect(() => store.deleteAgentPolicy("agent-ghost")).not.toThrow();
    });

    it("removes a previously stored per-agent override", async () => {
      await store.setAgentPolicy("agent-del", { autoReset: { threshold: 0.65 } });
      store.deleteAgentPolicy("agent-del");
      // After deletion the record should be empty again
      const record = store.getAgentPolicy("agent-del");
      expect(record.policy).toEqual({});
      expect(record.updatedAt).toBe("");
    });
  });

  // ── getEffectiveContextPolicy ─────────────────────────────────────────────────

  describe("getEffectiveContextPolicy", () => {
    it("returns BUILTIN_DEFAULT when no overrides exist", () => {
      const effective = store.getEffectiveContextPolicy();
      expect(effective.autoReset).toEqual(store.BUILTIN_DEFAULT.autoReset);
    });

    it("returns BUILTIN_DEFAULT for an unknown agentId", () => {
      const effective = store.getEffectiveContextPolicy("agent-new");
      expect(effective.autoReset).toEqual(store.BUILTIN_DEFAULT.autoReset);
    });

    it("global override wins over builtin for threshold", async () => {
      await store.setGlobalPolicy({ autoReset: { threshold: 0.8 } });
      const effective = store.getEffectiveContextPolicy();
      expect(effective.autoReset.threshold).toBe(0.8);
      // Other fields inherit from builtin
      expect(effective.autoReset.enabled).toBe(true);
      expect(effective.autoReset.cooldownTurns).toBe(store.COOLDOWN_DEFAULT);
    });

    it("global override wins over builtin for enabled flag", async () => {
      await store.setGlobalPolicy({ autoReset: { enabled: false } });
      const effective = store.getEffectiveContextPolicy();
      expect(effective.autoReset.enabled).toBe(false);
    });

    it("global override wins over builtin for cooldownTurns", async () => {
      await store.setGlobalPolicy({ autoReset: { cooldownTurns: 10 } });
      const effective = store.getEffectiveContextPolicy();
      expect(effective.autoReset.cooldownTurns).toBe(10);
    });

    it("per-agent override wins over global for threshold", async () => {
      await store.setGlobalPolicy({ autoReset: { threshold: 0.75 } });
      await store.setAgentPolicy("agent-x", { autoReset: { threshold: 0.6 } });
      const effective = store.getEffectiveContextPolicy("agent-x");
      expect(effective.autoReset.threshold).toBe(0.6);
    });

    it("per-agent override wins over global for enabled", async () => {
      await store.setGlobalPolicy({ autoReset: { enabled: false } });
      await store.setAgentPolicy("agent-y", { autoReset: { enabled: true } });
      const effective = store.getEffectiveContextPolicy("agent-y");
      expect(effective.autoReset.enabled).toBe(true);
    });

    it("per-agent override is selective — unset fields inherit from global", async () => {
      await store.setGlobalPolicy({ autoReset: { threshold: 0.8, cooldownTurns: 7 } });
      // agent only overrides cooldownTurns
      await store.setAgentPolicy("agent-z", { autoReset: { cooldownTurns: 2 } });
      const effective = store.getEffectiveContextPolicy("agent-z");
      expect(effective.autoReset.cooldownTurns).toBe(2);
      expect(effective.autoReset.threshold).toBe(0.8); // from global
      expect(effective.autoReset.enabled).toBe(true); // from builtin
    });

    it("deleting per-agent override reverts to global", async () => {
      await store.setGlobalPolicy({ autoReset: { threshold: 0.77 } });
      await store.setAgentPolicy("agent-del2", { autoReset: { threshold: 0.55 } });
      store.deleteAgentPolicy("agent-del2");
      const effective = store.getEffectiveContextPolicy("agent-del2");
      expect(effective.autoReset.threshold).toBe(0.77);
    });

    it("passing GLOBAL_SCOPE as agentId behaves as no-agent (skips per-agent layer)", async () => {
      await store.setGlobalPolicy({ autoReset: { threshold: 0.8 } });
      // GLOBAL_SCOPE is treated the same as undefined → no per-agent layer added
      const effective = store.getEffectiveContextPolicy(store.GLOBAL_SCOPE);
      expect(effective.autoReset.threshold).toBe(0.8);
    });

    it("all three layers compose in correct precedence order", async () => {
      // builtin: enabled=true, threshold=0.72, cooldown=3
      // global:  cooldown=10
      // agent:   enabled=false
      await store.setGlobalPolicy({ autoReset: { cooldownTurns: 10 } });
      await store.setAgentPolicy("agent-full", { autoReset: { enabled: false } });
      const effective = store.getEffectiveContextPolicy("agent-full");
      expect(effective.autoReset.enabled).toBe(false); // from agent
      expect(effective.autoReset.cooldownTurns).toBe(10); // from global
      expect(effective.autoReset.threshold).toBe(0.72); // from builtin
    });

    it("effective policy has no optional/undefined fields (fully resolved)", async () => {
      const effective = store.getEffectiveContextPolicy();
      expect(effective.autoReset.enabled).toBeDefined();
      expect(effective.autoReset.threshold).toBeDefined();
      expect(effective.autoReset.cooldownTurns).toBeDefined();
    });
  });

  // ── sanitize edge cases (via the public API) ─────────────────────────────────

  describe("sanitize edge cases (exercised through setGlobalPolicy)", () => {
    it("ignores non-boolean enabled field", async () => {
      await store.setGlobalPolicy({ autoReset: { enabled: "yes" as unknown as boolean } });
      const record = store.getGlobalPolicy();
      expect(record.policy.autoReset?.enabled).toBeUndefined();
    });

    it("ignores non-finite threshold", async () => {
      await store.setGlobalPolicy({ autoReset: { threshold: NaN } });
      const record = store.getGlobalPolicy();
      expect(record.policy.autoReset?.threshold).toBeUndefined();
    });

    it("ignores non-numeric cooldownTurns", async () => {
      await store.setGlobalPolicy({ autoReset: { cooldownTurns: "five" as unknown as number } });
      const record = store.getGlobalPolicy();
      expect(record.policy.autoReset?.cooldownTurns).toBeUndefined();
    });

    it("stores nothing when autoReset is not an object", async () => {
      await store.setGlobalPolicy({ autoReset: "bad" as unknown as object });
      const record = store.getGlobalPolicy();
      expect(record.policy.autoReset).toBeUndefined();
    });
  });
});
