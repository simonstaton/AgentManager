/**
 * Tests for src/totp.ts
 *
 * Strategy: The module-level TOTP_FILE constant bakes in the value of
 * process.env.TOTP_CONFIG_FILE at import time, so we cannot redirect the path
 * via env vars after the module is loaded.  We therefore mock `node:fs` with
 * an in-process Map to intercept all file I/O, and stub the two helpers from
 * `./sanitize` that are not yet exported on this branch.
 */

import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── In-process filesystem stub ────────────────────────────────────────────────
// All reads/writes/deletes go into this Map.  Tests clear it in beforeEach so
// each case starts with a clean slate.

const fileStore = new Map<string, string>();

// totp.ts uses `import fs from "node:fs"` (default import), so the mock must
// expose methods on the `default` export as well as as named exports so that
// vitest resolves them correctly regardless of how the bundler handles the CJS
// interop layer.
vi.mock("node:fs", () => {
  const fns = {
    existsSync: (p: string) => fileStore.has(p),
    readFileSync: (p: string, _enc?: unknown): string => {
      if (!fileStore.has(p)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
      return fileStore.get(p) as string;
    },
    writeFileSync: (p: string, data: string, _opts?: unknown): void => {
      fileStore.set(p, typeof data === "string" ? data : String(data));
    },
    mkdirSync: (_p: string, _opts?: unknown): void => {
      /* no-op */
    },
    renameSync: (src: string, dest: string): void => {
      const val = fileStore.get(src);
      if (val === undefined) throw Object.assign(new Error(`ENOENT: ${src}`), { code: "ENOENT" });
      fileStore.set(dest, val);
      fileStore.delete(src);
    },
    unlinkSync: (p: string): void => {
      if (fileStore.has(p)) fileStore.delete(p);
      else throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
    },
  };
  return { ...fns, default: fns };
});

// ── Mock ./sanitize ───────────────────────────────────────────────────────────
// registerSecretValue / unregisterSecretValue are called inside totp.ts but are
// not yet exported from sanitize.ts on this branch.

vi.mock("./sanitize", () => ({
  registerSecretValue: vi.fn(),
  unregisterSecretValue: vi.fn(),
  sanitizeEvent: vi.fn(),
  resetSanitizeCache: vi.fn(),
}));

// ── Subject under test ────────────────────────────────────────────────────────

import {
  clearTotpConfig,
  confirmTotpSetup,
  disableTotp,
  generateBackupCodes,
  generateOtpauthUrl,
  generateQrCodeDataUrl,
  generateTotpSecret,
  isTotpEnabled,
  loadDecryptedSecret,
  loadTotpConfig,
  prepareTotpSetup,
  regenerateBackupCodes,
  saveTotpConfig,
  type TotpConfig,
  verifyAndConsumeBackupCode,
  verifyTotpCode,
} from "./totp";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTotpConfig(overrides: Partial<TotpConfig> = {}): TotpConfig {
  return {
    enabled: true,
    encryptedSecret: "",
    iv: "",
    authTag: "",
    backupCodes: [],
    enabledAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  fileStore.clear();
});

afterEach(() => {
  fileStore.clear();
});

// ── loadTotpConfig / saveTotpConfig / clearTotpConfig ─────────────────────────

describe("loadTotpConfig", () => {
  it("returns null when no file exists", () => {
    expect(loadTotpConfig()).toBeNull();
  });

  it("returns null when the file contains invalid JSON", () => {
    // Write a valid config first to learn the key totp.ts uses, then corrupt it.
    saveTotpConfig(makeTotpConfig());
    const [key] = [...fileStore.keys()];
    fileStore.set(key, "{ not valid json }");
    expect(loadTotpConfig()).toBeNull();
  });

  it("returns the parsed config when the file is valid", () => {
    const cfg = makeTotpConfig({ backupCodes: ["hash1", "hash2"] });
    saveTotpConfig(cfg);
    const loaded = loadTotpConfig();
    expect(loaded).not.toBeNull();
    expect(loaded?.enabled).toBe(true);
    expect(loaded?.backupCodes).toEqual(["hash1", "hash2"]);
  });
});

describe("saveTotpConfig", () => {
  it("round-trips all fields through loadTotpConfig", () => {
    const cfg = makeTotpConfig({ enabledAt: "2024-01-01T00:00:00.000Z" });
    saveTotpConfig(cfg);
    const loaded = loadTotpConfig();
    expect(loaded?.enabledAt).toBe("2024-01-01T00:00:00.000Z");
  });

  it("persists every field faithfully", () => {
    const cfg = makeTotpConfig({
      encryptedSecret: "deadbeef",
      iv: "aabbcc",
      authTag: "112233",
      backupCodes: ["a", "b"],
    });
    saveTotpConfig(cfg);
    const loaded = loadTotpConfig();
    expect(loaded?.encryptedSecret).toBe("deadbeef");
    expect(loaded?.iv).toBe("aabbcc");
    expect(loaded?.authTag).toBe("112233");
    expect(loaded?.backupCodes).toEqual(["a", "b"]);
  });
});

describe("clearTotpConfig", () => {
  it("makes loadTotpConfig return null after clearing", () => {
    saveTotpConfig(makeTotpConfig());
    expect(loadTotpConfig()).not.toBeNull();
    clearTotpConfig();
    expect(loadTotpConfig()).toBeNull();
  });

  it("does not throw when the file is already absent", () => {
    expect(() => clearTotpConfig()).not.toThrow();
  });
});

// ── isTotpEnabled ─────────────────────────────────────────────────────────────

describe("isTotpEnabled", () => {
  it("returns false when no config exists", () => {
    expect(isTotpEnabled()).toBe(false);
  });

  it("returns false when config has enabled=false", () => {
    saveTotpConfig(makeTotpConfig({ enabled: false }));
    expect(isTotpEnabled()).toBe(false);
  });

  it("returns true when config has enabled=true", () => {
    saveTotpConfig(makeTotpConfig({ enabled: true }));
    expect(isTotpEnabled()).toBe(true);
  });
});

// ── generateTotpSecret ────────────────────────────────────────────────────────

describe("generateTotpSecret", () => {
  it("returns a non-empty string", () => {
    const secret = generateTotpSecret();
    expect(typeof secret).toBe("string");
    expect(secret.length).toBeGreaterThan(0);
  });

  it("returns a valid base32 string (uppercase A-Z and digits 2-7)", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+=*$/);
  });

  it("produces a unique secret on each call", () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a).not.toBe(b);
  });
});

// ── verifyTotpCode ────────────────────────────────────────────────────────────

describe("verifyTotpCode", () => {
  it("returns false for an obviously wrong 6-digit code", () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, "000000")).toBe(false);
  });

  it("returns false for a non-numeric code", () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, "XXXXXX")).toBe(false);
  });

  it("returns false for an empty string", () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, "")).toBe(false);
  });

  it("returns false for an invalid secret without throwing", () => {
    expect(verifyTotpCode("!!!INVALID!!!", "123456")).toBe(false);
  });
});

// ── generateOtpauthUrl ────────────────────────────────────────────────────────

describe("generateOtpauthUrl", () => {
  it("returns a valid otpauth:// URI", () => {
    const secret = generateTotpSecret();
    expect(generateOtpauthUrl(secret)).toMatch(/^otpauth:\/\/totp\//);
  });

  it("embeds issuer=AgentManager in the URI", () => {
    const secret = generateTotpSecret();
    expect(generateOtpauthUrl(secret)).toContain("AgentManager");
  });

  it("embeds the secret as a query parameter", () => {
    const secret = generateTotpSecret();
    expect(generateOtpauthUrl(secret)).toContain(secret);
  });

  it("uses the supplied label", () => {
    const secret = generateTotpSecret();
    expect(generateOtpauthUrl(secret, "admin@example.com")).toContain("admin");
  });

  it("defaults the label to AgentManager when none is supplied", () => {
    const secret = generateTotpSecret();
    const url = generateOtpauthUrl(secret);
    // The label appears as the path segment after /totp/.
    expect(url).toContain("AgentManager");
  });
});

// ── generateQrCodeDataUrl ─────────────────────────────────────────────────────

describe("generateQrCodeDataUrl", () => {
  it("returns a PNG base64 data URL", async () => {
    const secret = generateTotpSecret();
    const dataUrl = await generateQrCodeDataUrl(secret);
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("produces a non-trivially short result (actual PNG content present)", async () => {
    const secret = generateTotpSecret();
    const dataUrl = await generateQrCodeDataUrl(secret);
    // A 200 × 200 px QR code at default quality easily exceeds 500 base64 chars.
    expect(dataUrl.length).toBeGreaterThan(500);
  });
});

// ── generateBackupCodes ───────────────────────────────────────────────────────

describe("generateBackupCodes", () => {
  it("returns exactly 10 plain codes and 10 hashed codes", () => {
    const { plain, hashed } = generateBackupCodes();
    expect(plain).toHaveLength(10);
    expect(hashed).toHaveLength(10);
  });

  it("plain codes match the XXXX-XXXX-XXXX-XXXX hex pattern", () => {
    const { plain } = generateBackupCodes();
    for (const code of plain) {
      expect(code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    }
  });

  it("hashed codes are 64-character hex strings (SHA-256 output)", () => {
    const { hashed } = generateBackupCodes();
    for (const h of hashed) {
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("each plain code hashes to its corresponding stored hash", () => {
    const { plain, hashed } = generateBackupCodes();
    for (let i = 0; i < plain.length; i++) {
      const normalised = plain[i].replace(/-/g, "").toUpperCase();
      const expected = crypto.createHash("sha256").update(normalised).digest("hex");
      expect(hashed[i]).toBe(expected);
    }
  });

  it("generates a fresh set of codes on each call", () => {
    const a = generateBackupCodes();
    const b = generateBackupCodes();
    expect(a.plain).not.toEqual(b.plain);
  });
});

// ── verifyAndConsumeBackupCode ────────────────────────────────────────────────

describe("verifyAndConsumeBackupCode", () => {
  it("returns null for a code that is not in the stored hashes", () => {
    const { hashed } = generateBackupCodes();
    expect(verifyAndConsumeBackupCode("DEAD-BEEF-DEAD-BEEF", hashed)).toBeNull();
  });

  it("returns remaining codes (minus the matched one) on success", () => {
    const { plain, hashed } = generateBackupCodes();
    const result = verifyAndConsumeBackupCode(plain[0], hashed);
    expect(result).not.toBeNull();
    expect(result?.remaining).toHaveLength(9);
    const consumedHash = crypto.createHash("sha256").update(plain[0].replace(/-/g, "").toUpperCase()).digest("hex");
    expect(result?.remaining).not.toContain(consumedHash);
  });

  it("accepts a code with dashes stripped and characters lowercased", () => {
    const { plain, hashed } = generateBackupCodes();
    const stripped = plain[1].replace(/-/g, "").toLowerCase();
    expect(verifyAndConsumeBackupCode(stripped, hashed)).not.toBeNull();
  });

  it("rejects the same code a second time (consumed codes are removed)", () => {
    const { plain, hashed } = generateBackupCodes();
    const first = verifyAndConsumeBackupCode(plain[2], hashed);
    expect(first).not.toBeNull();
    // biome-ignore lint/style/noNonNullAssertion: already asserted first is non-null above
    expect(verifyAndConsumeBackupCode(plain[2], first!.remaining)).toBeNull();
  });
});

// ── loadDecryptedSecret ───────────────────────────────────────────────────────

describe("loadDecryptedSecret", () => {
  it("returns null when no config exists", () => {
    expect(loadDecryptedSecret()).toBeNull();
  });

  it("returns null when config has enabled=false", () => {
    saveTotpConfig(makeTotpConfig({ enabled: false }));
    expect(loadDecryptedSecret()).toBeNull();
  });

  it("returns null gracefully when the stored ciphertext is corrupt", () => {
    // 12-byte IV = 24 hex chars; 16-byte authTag = 32 hex chars.
    saveTotpConfig(
      makeTotpConfig({
        enabled: true,
        encryptedSecret: "deadbeef",
        iv: "deadbeefdeadbeef00000000",
        authTag: "deadbeefdeadbeefdeadbeefdeadbeef",
      }),
    );
    expect(loadDecryptedSecret()).toBeNull();
  });
});

// ── prepareTotpSetup ──────────────────────────────────────────────────────────

describe("prepareTotpSetup", () => {
  it("returns all required fields", async () => {
    const data = await prepareTotpSetup();
    expect(data.setupToken).toBeTruthy();
    expect(data.secret).toBeTruthy();
    expect(data.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(data.backupCodes).toHaveLength(10);
  });

  it("produces a unique setupToken on each call", async () => {
    const a = await prepareTotpSetup();
    const b = await prepareTotpSetup();
    expect(a.setupToken).not.toBe(b.setupToken);
  });

  it("backup codes in the response have the correct format", async () => {
    const data = await prepareTotpSetup();
    for (const code of data.backupCodes) {
      expect(code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    }
  });
});

// ── confirmTotpSetup ──────────────────────────────────────────────────────────

describe("confirmTotpSetup", () => {
  it("returns false for an unknown setupToken", () => {
    expect(confirmTotpSetup("nonexistent-token", "123456")).toBe(false);
  });

  it("returns false when the TOTP code is wrong", async () => {
    const { setupToken } = await prepareTotpSetup();
    // 000000 is statistically never a valid current TOTP token.
    expect(confirmTotpSetup(setupToken, "000000")).toBe(false);
  });

  it("allows multiple attempts after a bad code (session is not deleted on bad code)", async () => {
    const { setupToken } = await prepareTotpSetup();
    confirmTotpSetup(setupToken, "000000");
    // A second bad attempt should still return false, not throw.
    expect(confirmTotpSetup(setupToken, "111111")).toBe(false);
  });
});

// ── disableTotp ───────────────────────────────────────────────────────────────

describe("disableTotp", () => {
  it("leaves TOTP disabled (isTotpEnabled returns false) after calling disableTotp", () => {
    saveTotpConfig(makeTotpConfig({ enabled: true }));
    expect(isTotpEnabled()).toBe(true);
    disableTotp();
    expect(isTotpEnabled()).toBe(false);
  });

  it("does not throw when TOTP was never configured", () => {
    expect(() => disableTotp()).not.toThrow();
  });
});

// ── regenerateBackupCodes ─────────────────────────────────────────────────────

describe("regenerateBackupCodes", () => {
  it("throws when TOTP is not enabled", () => {
    expect(() => regenerateBackupCodes()).toThrow("TOTP is not enabled");
  });

  it("returns 10 new plain codes and updates the stored hashes", () => {
    const original = generateBackupCodes();
    saveTotpConfig(makeTotpConfig({ enabled: true, backupCodes: original.hashed }));

    const newPlain = regenerateBackupCodes();
    expect(newPlain).toHaveLength(10);

    const updated = loadTotpConfig();
    // New hashes must differ from the original set.
    expect(updated?.backupCodes).not.toEqual(original.hashed);

    // Each new plain code must hash to the corresponding new stored hash.
    for (let i = 0; i < newPlain.length; i++) {
      const normalised = newPlain[i].replace(/-/g, "").toUpperCase();
      const expected = crypto.createHash("sha256").update(normalised).digest("hex");
      expect(updated?.backupCodes[i]).toBe(expected);
    }
  });
});
