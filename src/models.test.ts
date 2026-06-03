import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, isOpusModel, MODELS, SMALL_FAST_MODEL } from "./models";

describe("MODELS registry", () => {
  it("contains all expected model keys", () => {
    const keys = Object.keys(MODELS);
    expect(keys).toContain("claude-opus-4-8-20260601");
    expect(keys).toContain("claude-opus-4-7-20260601");
    expect(keys).toContain("claude-opus-4-6");
    expect(keys).toContain("claude-sonnet-4-6");
    expect(keys).toContain("claude-sonnet-4-5-20250929");
    expect(keys).toContain("claude-haiku-4-5-20251001");
  });

  it("each model has required fields", () => {
    for (const [_id, def] of Object.entries(MODELS)) {
      expect(typeof def.displayName).toBe("string");
      expect(def.tokenLimit).toBeGreaterThan(0);
      expect(def.costMultiplier).toBeGreaterThan(0);
      expect(def.pricing.input).toBeGreaterThan(0);
      expect(def.pricing.output).toBeGreaterThan(0);
    }
  });

  it("sonnet 4.6 has costMultiplier of 1.0 (baseline)", () => {
    expect(MODELS["claude-sonnet-4-6"].costMultiplier).toBe(1.0);
  });
});

describe("isOpusModel", () => {
  it("returns true for opus model IDs", () => {
    expect(isOpusModel("claude-opus-4-8-20260601")).toBe(true);
    expect(isOpusModel("claude-opus-4-6")).toBe(true);
  });

  it("returns false for non-opus models", () => {
    expect(isOpusModel("claude-sonnet-4-6")).toBe(false);
    expect(isOpusModel("claude-haiku-4-5-20251001")).toBe(false);
  });
});

describe("DEFAULT_MODEL and SMALL_FAST_MODEL", () => {
  it("DEFAULT_MODEL is a valid key in MODELS", () => {
    expect(DEFAULT_MODEL in MODELS).toBe(true);
  });

  it("SMALL_FAST_MODEL is a valid key in MODELS", () => {
    expect(SMALL_FAST_MODEL in MODELS).toBe(true);
  });

  it("SMALL_FAST_MODEL is haiku", () => {
    expect(SMALL_FAST_MODEL).toContain("haiku");
  });
});
