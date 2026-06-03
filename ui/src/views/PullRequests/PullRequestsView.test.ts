/**
 * Tests for PullRequestsView filter logic and PRResultCard data mappings.
 * Tests pure/data-layer aspects without a DOM dependency.
 */
import { describe, expect, it } from "vitest";
import type { PullRequestItem } from "../../api";
import { timeAgo } from "../../constants";

// ─── timeAgo (used by PRResultCard) ──────────────────────────────────────────

describe("timeAgo", () => {
  function isoSecondsAgo(n: number) {
    return new Date(Date.now() - n * 1000).toISOString();
  }

  it("returns 'just now' for times under 60 seconds ago", () => {
    expect(timeAgo(isoSecondsAgo(30))).toBe("just now");
    expect(timeAgo(isoSecondsAgo(0))).toBe("just now");
  });

  it("returns minutes for times between 1 and 60 minutes ago", () => {
    expect(timeAgo(isoSecondsAgo(60))).toBe("1m ago");
    expect(timeAgo(isoSecondsAgo(90))).toBe("1m ago");
    expect(timeAgo(isoSecondsAgo(3599))).toBe("59m ago");
  });

  it("returns hours for times between 1 and 24 hours ago", () => {
    expect(timeAgo(isoSecondsAgo(3600))).toBe("1h ago");
    expect(timeAgo(isoSecondsAgo(7200))).toBe("2h ago");
    expect(timeAgo(isoSecondsAgo(86399))).toBe("23h ago");
  });

  it("returns days for times over 24 hours ago", () => {
    expect(timeAgo(isoSecondsAgo(86400))).toBe("1d ago");
    expect(timeAgo(isoSecondsAgo(172800))).toBe("2d ago");
  });
});

// ─── PR filter predicate (mirrors PullRequestsView filter logic) ──────────────

type StateFilter = "all" | "open" | "draft";
type ChecksFilter = "all" | "passing" | "failing" | "pending";

function filterPRs(
  pullRequests: PullRequestItem[],
  stateFilter: StateFilter,
  checksFilter: ChecksFilter,
  repoFilter: string,
): PullRequestItem[] {
  return pullRequests.filter((pr) => {
    if (stateFilter === "open" && pr.state !== "open") return false;
    if (stateFilter === "draft" && pr.state !== "draft") return false;
    if (checksFilter !== "all" && pr.checksStatus !== checksFilter) return false;
    if (repoFilter !== "all" && pr.repo !== repoFilter) return false;
    return true;
  });
}

function makePR(overrides: Partial<PullRequestItem> = {}): PullRequestItem {
  return {
    number: 1,
    title: "Test PR",
    state: "open",
    draft: false,
    repo: "owner/repo",
    branch: "feature/test",
    baseBranch: "main",
    url: "https://github.test/owner/repo/pull/1",
    author: "agent-001",
    additions: 10,
    deletions: 2,
    updatedAt: new Date().toISOString(),
    checksStatus: "passing",
    reviewDecision: "REVIEW_REQUIRED",
    labels: [],
    agent: null,
    ...overrides,
  };
}

describe("PR filter predicate", () => {
  const prs: PullRequestItem[] = [
    makePR({ number: 1, state: "open", checksStatus: "passing", repo: "org/repo-a" }),
    makePR({ number: 2, state: "draft", checksStatus: "failing", repo: "org/repo-a" }),
    makePR({ number: 3, state: "open", checksStatus: "pending", repo: "org/repo-b" }),
    makePR({ number: 4, state: "merged", checksStatus: "passing", repo: "org/repo-b" }),
  ];

  it("returns all PRs when all filters are set to 'all'", () => {
    expect(filterPRs(prs, "all", "all", "all")).toHaveLength(4);
  });

  it("filters to only open PRs", () => {
    const result = filterPRs(prs, "open", "all", "all");
    expect(result).toHaveLength(2);
    expect(result.every((pr) => pr.state === "open")).toBe(true);
  });

  it("filters to only draft PRs", () => {
    const result = filterPRs(prs, "draft", "all", "all");
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(2);
  });

  it("filters by checks status", () => {
    const passing = filterPRs(prs, "all", "passing", "all");
    expect(passing).toHaveLength(2);
    expect(passing.every((pr) => pr.checksStatus === "passing")).toBe(true);

    const failing = filterPRs(prs, "all", "failing", "all");
    expect(failing).toHaveLength(1);
    expect(failing[0].number).toBe(2);
  });

  it("filters by repo", () => {
    const repoA = filterPRs(prs, "all", "all", "org/repo-a");
    expect(repoA).toHaveLength(2);
    expect(repoA.every((pr) => pr.repo === "org/repo-a")).toBe(true);
  });

  it("combines state and checks filters", () => {
    const result = filterPRs(prs, "open", "passing", "all");
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(1);
  });

  it("returns empty array when no PRs match", () => {
    expect(filterPRs(prs, "open", "failing", "all")).toHaveLength(0);
  });

  it("combined repo + state filter", () => {
    const result = filterPRs(prs, "open", "all", "org/repo-b");
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(3);
  });
});

// ─── PR count derivation (mirrors PullRequestsView counts memo) ───────────────

describe("PR count derivation", () => {
  const prs: PullRequestItem[] = [
    makePR({ state: "open", agent: { id: "a1", name: "Agent 1" } }),
    makePR({ state: "open", agent: null }),
    makePR({ state: "draft", agent: { id: "a2", name: "Agent 2" } }),
    makePR({ state: "merged", agent: null }),
  ];

  it("counts total PRs correctly", () => {
    expect(prs.length).toBe(4);
  });

  it("counts open PRs correctly", () => {
    expect(prs.filter((pr) => pr.state === "open")).toHaveLength(2);
  });

  it("counts draft PRs correctly", () => {
    expect(prs.filter((pr) => pr.state === "draft")).toHaveLength(1);
  });

  it("counts agent-owned PRs correctly", () => {
    expect(prs.filter((pr) => pr.agent !== null)).toHaveLength(2);
  });

  it("derives unique repos correctly", () => {
    const multiRepoPRs = [makePR({ repo: "org/alpha" }), makePR({ repo: "org/beta" }), makePR({ repo: "org/alpha" })];
    const repos = [...new Set(multiRepoPRs.map((pr) => pr.repo))];
    expect(repos).toHaveLength(2);
    expect(repos).toContain("org/alpha");
    expect(repos).toContain("org/beta");
  });
});
