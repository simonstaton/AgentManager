/**
 * Tests for deepMerge — the sparse-override merge backing repo gate configs.
 * Covers: recursive object merge, scalar/array replace, absent-inherits,
 * null-reverts-to-default, immutability, and the headline gate-config use case.
 */

import { describe, expect, it } from "vitest";
import { deepMerge } from "./deep-merge";

describe("deepMerge", () => {
  it("merges nested objects key-by-key, leaving untouched siblings intact", () => {
    const base = { a: { x: 1, y: 2 }, b: 3 };
    const out = deepMerge(base, { a: { y: 20 } });
    expect(out).toEqual({ a: { x: 1, y: 20 }, b: 3 });
  });

  it("replaces scalars wholesale", () => {
    expect(deepMerge({ n: 1 }, { n: 9 })).toEqual({ n: 9 });
    expect(deepMerge({ s: "a" }, { s: "b" })).toEqual({ s: "b" });
    expect(deepMerge({ flag: true }, { flag: false })).toEqual({ flag: false });
  });

  it("replaces arrays wholesale (does NOT union/concat them)", () => {
    const base = { globs: ["a", "b", "c"] };
    const out = deepMerge(base, { globs: ["x"] });
    expect(out.globs).toEqual(["x"]);
  });

  it("inherits the base value for keys absent from the override", () => {
    const base = { a: 1, b: { c: 2 } };
    const out = deepMerge(base, { a: 5 });
    expect(out).toEqual({ a: 5, b: { c: 2 } });
  });

  it("reverts a key to the base value when the override sets it to null", () => {
    const base = { a: { x: 1, y: 2 } };
    const out = deepMerge(base, { a: { x: 99, y: null } });
    // x overridden, y reverted to base (never literal null)
    expect(out).toEqual({ a: { x: 99, y: 2 } });
    expect(out.a.y).not.toBeNull();
  });

  it("ignores undefined override values (treated as absent)", () => {
    const base = { a: 1, b: 2 };
    const out = deepMerge(base, { a: undefined, b: 7 });
    expect(out).toEqual({ a: 1, b: 7 });
  });

  it("does not mutate either input", () => {
    const base = { a: { x: 1 }, list: [1, 2] };
    const override = { a: { x: 2 } };
    const snapBase = JSON.stringify(base);
    const snapOver = JSON.stringify(override);
    const out = deepMerge(base, override);
    expect(JSON.stringify(base)).toBe(snapBase);
    expect(JSON.stringify(override)).toBe(snapOver);
    // result is a distinct object graph
    expect(out.a).not.toBe(base.a);
    out.a.x = 100;
    expect(base.a.x).toBe(1);
  });

  it("returns a clone of base when the override is not a plain object", () => {
    const base = { a: 1 };
    expect(deepMerge(base, null)).toEqual({ a: 1 });
    expect(deepMerge(base, undefined)).toEqual({ a: 1 });
    expect(deepMerge(base, 5 as unknown)).toEqual({ a: 1 });
    expect(deepMerge(base, [1, 2] as unknown)).toEqual({ a: 1 });
    expect(deepMerge(base, {})).toEqual({ a: 1 });
    expect(deepMerge(base, {})).not.toBe(base);
  });

  it("lets an object override replace a scalar base at a leaf", () => {
    const base = { a: 1 };
    const out = deepMerge(base, { a: { nested: true } });
    expect(out).toEqual({ a: { nested: true } });
  });

  it("models the gate-config use case: sparse override keeps sibling policy levels", () => {
    const preset = {
      mergeGate: {
        autoMergeThreshold: "high",
        policy: {
          high: { allowed: true, reason: "ok" },
          medium: { allowed: false, reason: "review" },
          critical: { allowed: false, reason: "blocked" },
        },
      },
    };
    // operator loosens ONLY medium; high & critical must survive untouched
    const out = deepMerge(preset, { mergeGate: { policy: { medium: { allowed: true } } } });
    expect(out.mergeGate.policy.medium.allowed).toBe(true);
    expect(out.mergeGate.policy.medium.reason).toBe("review"); // sibling leaf inherited
    expect(out.mergeGate.policy.high.allowed).toBe(true);
    expect(out.mergeGate.policy.critical.allowed).toBe(false);
    expect(out.mergeGate.autoMergeThreshold).toBe("high");
  });
});
