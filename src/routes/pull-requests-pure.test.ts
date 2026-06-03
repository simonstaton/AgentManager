import { describe, expect, it } from "vitest";
import { deriveChecksStatus, extractRepoSlug, extractTokenFromUrl } from "./pull-requests";

describe("deriveChecksStatus", () => {
  it("returns none for empty rollup", () => {
    expect(deriveChecksStatus([])).toBe("none");
    expect(deriveChecksStatus(null as never)).toBe("none");
  });
  it("returns failing when any check failed", () => {
    expect(deriveChecksStatus([{ conclusion: "FAILURE", state: null, status: null }])).toBe("failing");
    expect(deriveChecksStatus([{ conclusion: "ERROR", state: null, status: null }])).toBe("failing");
  });
  it("returns pending when any check is in progress", () => {
    expect(deriveChecksStatus([{ conclusion: null, state: null, status: "IN_PROGRESS" }])).toBe("pending");
  });
  it("returns passing when all checks succeeded", () => {
    expect(deriveChecksStatus([{ conclusion: "SUCCESS", state: null, status: null }])).toBe("passing");
  });
});

describe("extractRepoSlug", () => {
  it("extracts slug from HTTPS URL", () => {
    expect(extractRepoSlug("https://github.com/org/repo.git")).toBe("org/repo");
  });
  it("extracts slug from HTTPS URL with token", () => {
    expect(extractRepoSlug("https://token123@github.com/org/repo")).toBe("org/repo");
  });
  it("extracts slug from SSH URL", () => {
    expect(extractRepoSlug("git@github.com:org/repo.git")).toBe("org/repo");
  });
  it("returns null for non-GitHub URL", () => {
    expect(extractRepoSlug("https://gitlab.com/org/repo")).toBeNull();
  });
});

describe("extractTokenFromUrl", () => {
  it("extracts token from x-access-token format", () => {
    expect(extractTokenFromUrl("https://x-access-token:mytoken@github.com/org/repo")).toBe("mytoken");
  });
  it("extracts bare token", () => {
    expect(extractTokenFromUrl("https://mytoken@github.com/org/repo")).toBe("mytoken");
  });
  it("returns null when no token in URL", () => {
    expect(extractTokenFromUrl("https://github.com/org/repo")).toBeNull();
  });
});
