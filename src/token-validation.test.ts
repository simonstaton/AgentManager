import { describe, expect, it } from "vitest";
import { validateToken } from "./token-validation";

describe("validateToken", () => {
  it("returns error for unknown service", async () => {
    const result = await validateToken("unknownservice", "tok");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Unknown service");
    expect(result.error).toContain("unknownservice");
  });

  it("includes all supported services in the error message", async () => {
    const result = await validateToken("bad", "tok");
    expect(result.error).toContain("github");
    expect(result.error).toContain("linear");
    expect(result.error).toContain("figma");
    expect(result.error).toContain("notion");
    expect(result.error).toContain("slack");
  });
});
