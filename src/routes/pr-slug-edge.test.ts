/// <reference types="vitest/globals" />
import { extractRepoSlug, extractTokenFromUrl } from "./pull-requests";

describe("extractRepoSlug – edge cases", () => {
  it("returns null for URL with trailing slash (regex requires .git suffix)", () => {
    expect(extractRepoSlug("https://github.com/org/repo/")).toBeNull();
  });

  it("handles SSH URL without .git suffix", () => {
    expect(extractRepoSlug("git@github.com:org/repo")).toBe("org/repo");
  });

  it("returns null for empty string", () => {
    expect(extractRepoSlug("")).toBeNull();
  });
});

describe("extractTokenFromUrl – edge cases", () => {
  it("returns null for empty string", () => {
    expect(extractTokenFromUrl("")).toBeNull();
  });

  it("returns null for URL with no credentials", () => {
    expect(extractTokenFromUrl("https://github.com/org/repo.git")).toBeNull();
  });

  it("handles token with special characters", () => {
    const token = "ghp_abc123XYZ";
    expect(extractTokenFromUrl(`https://${token}@github.com/org/repo`)).toBe(token);
  });
});
