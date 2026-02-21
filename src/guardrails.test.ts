import { describe, expect, it } from "vitest";
import { ALLOWED_MODELS, BLOCKED_COMMAND_PATTERNS } from "./guardrails";

describe("guardrails constants", () => {
  it("includes expected models", () => {
    expect(ALLOWED_MODELS).toContain("claude-opus-4-6");
    expect(ALLOWED_MODELS).toContain("claude-sonnet-4-5-20250929");
  });
});

describe("BLOCKED_COMMAND_PATTERNS", () => {
  const matches = (input: string) => BLOCKED_COMMAND_PATTERNS.some((p) => p.test(input));

  it("blocks dangerous rm commands", () => {
    expect(matches("rm -rf /etc")).toBe(true);
    expect(matches("rm --recursive /var")).toBe(true);
    expect(matches("rm -r /bin")).toBe(true);
    expect(matches("RM -RF /usr")).toBe(true); // case insensitive
  });

  it("allows rm on /tmp", () => {
    expect(matches("rm -rf /tmp/workspace")).toBe(false);
    expect(matches("rm -r /tmp/test")).toBe(false);
  });

  it("blocks DROP TABLE/DATABASE when SQL context (semicolon) present", () => {
    expect(matches("DROP TABLE users;")).toBe(true);
    expect(matches("DROP DATABASE production;")).toBe(true);
    expect(matches("drop table orders;")).toBe(true);
    expect(matches("Some text DROP TABLE test;")).toBe(true);
  });

  it("allows DROP TABLE/DATABASE in non-SQL context (no semicolon)", () => {
    expect(matches("Documentation for DROP TABLE syntax")).toBe(false);
    expect(matches("Explain DROP DATABASE")).toBe(false);
  });

  it("blocks DELETE FROM when followed by ; or WHERE (SQL context)", () => {
    expect(matches("DELETE FROM users;")).toBe(true);
    expect(matches("DELETE FROM users WHERE id=1")).toBe(true);
    expect(matches("delete from orders WHERE 1=1")).toBe(true);
    expect(matches("Some preamble DELETE FROM items WHERE price > 100")).toBe(true);
  });

  it("allows natural language DELETE FROM (no semicolon or WHERE)", () => {
    expect(matches("delete from the list")).toBe(false);
    expect(matches("remove items delete from cache")).toBe(false);
  });

  it("blocks database connection strings", () => {
    expect(matches("mongodb://localhost/admin")).toBe(true);
    expect(matches("mongodb+srv://cluster.example.com/db")).toBe(true);
    expect(matches("postgres://user:pass@host/db")).toBe(true);
    expect(matches("postgresql://localhost:5432/mydb")).toBe(true);
    expect(matches("mysql://user:pass@host/db")).toBe(true);
    expect(matches("Connect to mongodb://prod-server/data")).toBe(true);
  });

  it("allows normal prompts", () => {
    expect(matches("Write a function to sort an array")).toBe(false);
    expect(matches("Help me debug this code")).toBe(false);
    expect(matches("Create a user registration form")).toBe(false);
    expect(matches("Explain how databases work")).toBe(false);
    expect(matches("What is DELETE in SQL?")).toBe(false); // "DELETE" alone without "FROM" is OK
  });
});
