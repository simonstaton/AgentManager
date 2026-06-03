/// <reference types="vitest/globals" />

type PRState = "open" | "closed" | "merged" | "draft";

function derivePRStateLabel(state: PRState): string {
  if (state === "draft") return "Draft";
  if (state === "merged") return "Merged";
  return "Open";
}

function derivePRStateVariant(state: PRState): "secondary" | "info" | "success" {
  if (state === "draft") return "secondary";
  if (state === "merged") return "info";
  return "success";
}

function deriveUniquePRRepos(repos: string[]): string[] {
  return [...new Set(repos)];
}

describe("PR state label derivation", () => {
  it("labels draft PRs as Draft", () => expect(derivePRStateLabel("draft")).toBe("Draft"));
  it("labels merged PRs as Merged", () => expect(derivePRStateLabel("merged")).toBe("Merged"));
  it("labels open PRs as Open", () => expect(derivePRStateLabel("open")).toBe("Open"));
  it("labels closed PRs as Open", () => expect(derivePRStateLabel("closed")).toBe("Open"));
});

describe("PR state variant derivation", () => {
  it("draft uses secondary variant", () => expect(derivePRStateVariant("draft")).toBe("secondary"));
  it("merged uses info variant", () => expect(derivePRStateVariant("merged")).toBe("info"));
  it("open uses success variant", () => expect(derivePRStateVariant("open")).toBe("success"));
});

describe("unique PR repos", () => {
  it("deduplicates repos", () => expect(deriveUniquePRRepos(["a", "b", "a"])).toHaveLength(2));
  it("preserves order of first occurrence", () => expect(deriveUniquePRRepos(["b", "a", "b"])[0]).toBe("b"));
});
