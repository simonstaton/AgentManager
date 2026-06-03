/**
 * Tests for repo-gate-store: DEFAULT_PRESET derivation, resolveEffectiveGateConfig,
 * get/set/delete, schema migration, and fail-safe read behavior.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PRESET, deleteRepoGateConfig, resolveEffectiveGateConfig, setRepoGateConfig } from "./repo-gate-store";

// ─── DEFAULT_PRESET derivation ────────────────────────────────────────────────

describe("DEFAULT_PRESET", () => {
  it("auto-merge threshold is high", () => {
    expect(DEFAULT_PRESET.autoMergeThreshold).toBe("high");
  });

  it("high-confidence merge is allowed; medium/low/critical are blocked", () => {
    expect(DEFAULT_PRESET.mergePolicy.high.allowed).toBe(true);
    expect(DEFAULT_PRESET.mergePolicy.medium.allowed).toBe(false);
    expect(DEFAULT_PRESET.mergePolicy.low.allowed).toBe(false);
    expect(DEFAULT_PRESET.mergePolicy.critical.allowed).toBe(false);
  });

  it("grading weights sum to 1.0 (±0.001)", () => {
    const { clarity, confidence, blastRadius } = DEFAULT_PRESET.grading.weights;
    expect(clarity + confidence + blastRadius).toBeCloseTo(1.0, 3);
  });

  it("PR size limits match the CLAUDE.md hard limits", () => {
    expect(DEFAULT_PRESET.prSize.maxLines).toBe(400);
    expect(DEFAULT_PRESET.prSize.maxFiles).toBe(20);
    expect(DEFAULT_PRESET.prSize.maxConcerns).toBe(1);
  });

  it("guardrail overrides are off by default", () => {
    expect(DEFAULT_PRESET.guardrailOverrides.allowUnreviewedShell).toBe(false);
    expect(DEFAULT_PRESET.guardrailOverrides.allowDirectPushToMain).toBe(false);
  });

  it("schemaVersion is 1", () => {
    expect(DEFAULT_PRESET.schemaVersion).toBe(1);
  });
});

// ─── Store round-trip ─────────────────────────────────────────────────────────

describe("store round-trip", () => {
  const repoName = "test-repo-gate-store-roundtrip";

  afterEach(() => {
    deleteRepoGateConfig(repoName);
  });

  it("resolves to DEFAULT_PRESET when no file exists", () => {
    const effective = resolveEffectiveGateConfig(repoName);
    expect(effective).toEqual(DEFAULT_PRESET);
  });

  it("persists overrides and resolves merged effective config", async () => {
    await setRepoGateConfig(repoName, { autoMergeThreshold: "medium" }, "test-user");
    const effective = resolveEffectiveGateConfig(repoName);
    expect(effective.autoMergeThreshold).toBe("medium");
    // Unchanged fields come from the default preset
    expect(effective.prSize.maxLines).toBe(DEFAULT_PRESET.prSize.maxLines);
  });

  it("sparse override keeps sibling merge-policy levels intact", async () => {
    await setRepoGateConfig(
      repoName,
      { mergePolicy: { high: { allowed: false, reason: "manual only" } } } as never,
      "test-user",
    );
    const effective = resolveEffectiveGateConfig(repoName);
    expect(effective.mergePolicy.high.allowed).toBe(false);
    // Sibling levels unchanged
    expect(effective.mergePolicy.medium).toEqual(DEFAULT_PRESET.mergePolicy.medium);
  });

  it("deleteRepoGateConfig reverts to DEFAULT_PRESET", async () => {
    await setRepoGateConfig(repoName, { autoMergeThreshold: "medium" }, "test-user");
    deleteRepoGateConfig(repoName);
    const effective = resolveEffectiveGateConfig(repoName);
    expect(effective.autoMergeThreshold).toBe(DEFAULT_PRESET.autoMergeThreshold);
  });
});

// ─── Fail-safe reads ──────────────────────────────────────────────────────────

describe("fail-safe read behavior", () => {
  const repoName = "test-repo-gate-store-failsafe";

  afterEach(() => {
    deleteRepoGateConfig(repoName);
  });

  it("returns DEFAULT_PRESET when the config file is corrupt JSON", async () => {
    // Manually write a corrupt file to the store directory
    const { existsSync: realExists } = await import("node:fs");
    // Write directly to the store path via the store's configPath logic
    const storePath = "/persistent/repo-gate-configs";
    const tmpPath = "/tmp/repo-gate-configs";
    const dir = realExists("/persistent") ? storePath : tmpPath;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/${repoName}.json`, "{ corrupt json {{", "utf-8");

    const effective = resolveEffectiveGateConfig(repoName);
    expect(effective).toEqual(DEFAULT_PRESET);

    // Clean up
    const filePath = `${dir}/${repoName}.json`;
    if (existsSync(filePath)) rmSync(filePath);
  });

  it("resolveEffectiveGateConfig never throws", () => {
    expect(() => resolveEffectiveGateConfig("any-nonexistent-repo")).not.toThrow();
  });
});
