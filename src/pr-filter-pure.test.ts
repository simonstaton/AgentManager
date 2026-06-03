/// <reference types="vitest/globals" />

type StateFilter = "all" | "open" | "draft";
type ChecksFilter = "all" | "passing" | "failing" | "pending";

interface PRItem {
  state: "open" | "closed" | "merged" | "draft";
  checksStatus: "pending" | "passing" | "failing" | "none";
  repo: string;
}

function filterPRs(prs: PRItem[], s: StateFilter, c: ChecksFilter, r: string): PRItem[] {
  return prs.filter((pr) => {
    if (s === "open" && pr.state !== "open") return false;
    if (s === "draft" && pr.state !== "draft") return false;
    if (c !== "all" && pr.checksStatus !== c) return false;
    if (r !== "all" && pr.repo !== r) return false;
    return true;
  });
}

const prs: PRItem[] = [
  { state: "open", checksStatus: "passing", repo: "org/a" },
  { state: "draft", checksStatus: "failing", repo: "org/a" },
  { state: "open", checksStatus: "pending", repo: "org/b" },
  { state: "merged", checksStatus: "passing", repo: "org/b" },
];

describe("PR filter – all combinations", () => {
  it("all filters return all PRs", () => expect(filterPRs(prs, "all", "all", "all")).toHaveLength(4));
  it("open filter returns open PRs", () => expect(filterPRs(prs, "open", "all", "all")).toHaveLength(2));
  it("draft filter returns draft PRs", () => expect(filterPRs(prs, "draft", "all", "all")).toHaveLength(1));
  it("passing checks filter works", () => expect(filterPRs(prs, "all", "passing", "all")).toHaveLength(2));
  it("repo filter works", () => expect(filterPRs(prs, "all", "all", "org/a")).toHaveLength(2));
  it("combined filters narrow results", () => expect(filterPRs(prs, "open", "passing", "all")).toHaveLength(1));
  it("no match returns empty", () => expect(filterPRs(prs, "open", "failing", "all")).toHaveLength(0));
});
