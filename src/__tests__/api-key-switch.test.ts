import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetSanitizeCache } from "../sanitize";

/**
 * Regression tests for API key switching logic in the config route.
 * Verifies that switching between OpenRouter and Anthropic keys properly
 * cleans up environment variables (no "undefined" string pollution).
 *
 * See: https://github.com/simonstaton/ClaudeSwarm_PRIVATE/pull/211
 */

/** Simulate the key-switching logic from PUT /api/settings/anthropic-key */
function switchApiKey(key: string) {
  const isOpenRouter = key.startsWith("sk-or-");
  if (isOpenRouter) {
    process.env.ANTHROPIC_AUTH_TOKEN = key;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_BASE_URL = "https://openrouter.ai/api";
  } else {
    process.env.ANTHROPIC_API_KEY = key;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_BASE_URL;
  }
  resetSanitizeCache();
}

describe("API key switching", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Start with OpenRouter configured
    process.env.ANTHROPIC_AUTH_TOKEN = "sk-or-v1-existing-key";
    process.env.ANTHROPIC_BASE_URL = "https://openrouter.ai/api";
    process.env.ANTHROPIC_API_KEY = "";
    resetSanitizeCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetSanitizeCache();
  });

  it("switching to Anthropic key removes AUTH_TOKEN and BASE_URL from env", () => {
    switchApiKey("sk-ant-test-anthropic-key-12345");

    expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-test-anthropic-key-12345");
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it("switching to Anthropic key does not leave string 'undefined' in env", () => {
    switchApiKey("sk-ant-test-anthropic-key-12345");

    // This was the original bug: process.env coerces undefined to "undefined"
    expect(process.env.ANTHROPIC_AUTH_TOKEN).not.toBe("undefined");
    expect(process.env.ANTHROPIC_BASE_URL).not.toBe("undefined");
    expect("ANTHROPIC_AUTH_TOKEN" in process.env).toBe(false);
    expect("ANTHROPIC_BASE_URL" in process.env).toBe(false);
  });

  it("switching to OpenRouter key removes API_KEY from env", () => {
    // First switch to Anthropic
    switchApiKey("sk-ant-test-anthropic-key-12345");

    // Then switch back to OpenRouter
    switchApiKey("sk-or-v1-new-openrouter-key");

    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe("sk-or-v1-new-openrouter-key");
    expect(process.env.ANTHROPIC_BASE_URL).toBe("https://openrouter.ai/api");
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect("ANTHROPIC_API_KEY" in process.env).toBe(false);
  });

  it("round-trip switch leaves correct state", () => {
    // OpenRouter -> Anthropic -> OpenRouter
    switchApiKey("sk-ant-test-key-12345");
    switchApiKey("sk-or-v1-final-key");

    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe("sk-or-v1-final-key");
    expect(process.env.ANTHROPIC_BASE_URL).toBe("https://openrouter.ai/api");
    expect("ANTHROPIC_API_KEY" in process.env).toBe(false);
  });

  it("isOpenRouter detection works correctly after switching to Anthropic", () => {
    switchApiKey("sk-ant-test-anthropic-key-12345");

    // This is how the settings endpoint determines mode
    const isOpenRouter = !!process.env.ANTHROPIC_AUTH_TOKEN;
    expect(isOpenRouter).toBe(false);
  });
});
