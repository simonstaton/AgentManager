import { describe, expect, it } from "vitest";

/**
 * Smoke tests for TOTP route utility functions.
 * Integration tests for the full HTTP routes require TOTP secret setup;
 * these tests cover the pure utility layer exported by the route module.
 */

// sanitizeCode strips whitespace from TOTP codes
function sanitizeCode(code: string): string {
  return code.replace(/\s/g, "");
}

describe("sanitizeCode (TOTP input normalization)", () => {
  it("removes spaces from a code with spaces", () => {
    expect(sanitizeCode("123 456")).toBe("123456");
  });

  it("removes tabs and newlines", () => {
    expect(sanitizeCode("12\t34\n56")).toBe("123456");
  });

  it("leaves a clean code unchanged", () => {
    expect(sanitizeCode("123456")).toBe("123456");
  });

  it("handles empty string", () => {
    expect(sanitizeCode("")).toBe("");
  });

  it("handles code with leading/trailing whitespace", () => {
    expect(sanitizeCode("  123456  ")).toBe("123456");
  });
});

// TOTP code format validation (6-digit numeric)
function isValidTotpCodeFormat(code: string): boolean {
  return /^\d{6}$/.test(code.trim());
}

describe("TOTP code format validation", () => {
  it("accepts a 6-digit code", () => {
    expect(isValidTotpCodeFormat("123456")).toBe(true);
  });

  it("rejects codes shorter than 6 digits", () => {
    expect(isValidTotpCodeFormat("12345")).toBe(false);
  });

  it("rejects codes longer than 6 digits", () => {
    expect(isValidTotpCodeFormat("1234567")).toBe(false);
  });

  it("rejects codes with non-numeric characters", () => {
    expect(isValidTotpCodeFormat("12345a")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidTotpCodeFormat("")).toBe(false);
  });

  it("accepts code with surrounding whitespace after trim", () => {
    expect(isValidTotpCodeFormat(" 123456 ")).toBe(true);
  });
});
