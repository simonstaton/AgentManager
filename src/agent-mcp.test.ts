import { describe, expect, it } from "vitest";
import { AGENT_MCP_FILENAME, filterMcpServers } from "./agent-mcp";

describe("filterMcpServers", () => {
  const global = { figma: { type: "http" }, linear: { type: "http" }, slack: { type: "http" } };

  it("returns only allowlisted servers", () => {
    const { servers } = filterMcpServers(global, ["figma"]);
    expect(Object.keys(servers)).toEqual(["figma"]);
  });

  it("reports missing servers", () => {
    const { missing } = filterMcpServers(global, ["figma", "unknown"]);
    expect(missing).toEqual(["unknown"]);
  });

  it("reports dropped servers", () => {
    const { dropped } = filterMcpServers(global, ["figma"]);
    expect(dropped).toContain("linear");
    expect(dropped).toContain("slack");
  });

  it("empty allow returns empty servers", () => {
    const { servers, dropped } = filterMcpServers(global, []);
    expect(Object.keys(servers)).toHaveLength(0);
    expect(dropped).toHaveLength(3);
  });
});

describe("AGENT_MCP_FILENAME", () => {
  it("is agent-mcp.json", () => {
    expect(AGENT_MCP_FILENAME).toBe("agent-mcp.json");
  });
});
