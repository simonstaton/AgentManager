import { describe, expect, it } from "vitest";
import { checkDangerousCommand, DANGEROUS_BASH_PATTERNS } from "./hook-config";

describe("DANGEROUS_BASH_PATTERNS", () => {
  it("exports a non-empty array of patterns", () => {
    expect(Array.isArray(DANGEROUS_BASH_PATTERNS)).toBe(true);
    expect(DANGEROUS_BASH_PATTERNS.length).toBeGreaterThan(0);
  });

  it("every entry has a RegExp pattern and a non-empty reason", () => {
    for (const { pattern, reason } of DANGEROUS_BASH_PATTERNS) {
      expect(pattern).toBeInstanceOf(RegExp);
      expect(typeof reason).toBe("string");
      expect(reason.length).toBeGreaterThan(0);
    }
  });
});

describe("checkDangerousCommand", () => {
  it("returns null for safe commands", () => {
    expect(checkDangerousCommand("echo hello")).toBeNull();
    expect(checkDangerousCommand("ls -la /tmp")).toBeNull();
    expect(checkDangerousCommand("npm test")).toBeNull();
  });

  it("rejects rm -rf /", () => {
    const reason = checkDangerousCommand("rm -rf /");
    expect(reason).not.toBeNull();
    expect(typeof reason).toBe("string");
  });

  it("rejects force push to main", () => {
    const reason = checkDangerousCommand("git push origin --force main");
    expect(reason).not.toBeNull();
  });

  it("rejects fork bomb", () => {
    const reason = checkDangerousCommand(":() { :|:& }");
    expect(reason).not.toBeNull();
  });

  it("rejects mkfs commands", () => {
    const reason = checkDangerousCommand("mkfs.ext4 /dev/sda1");
    expect(reason).not.toBeNull();
  });

  it("rejects dd writing to block device", () => {
    const reason = checkDangerousCommand("dd if=/dev/zero of=/dev/sda");
    expect(reason).not.toBeNull();
  });
});
