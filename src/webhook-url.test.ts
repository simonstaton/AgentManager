import { describe, expect, it } from "vitest";
import { isAllowedWebhookUrl } from "./webhook-url";

describe("isAllowedWebhookUrl", () => {
  it("allows valid https URLs", () => {
    expect(isAllowedWebhookUrl("https://example.com/webhook")).toBe(true);
    expect(isAllowedWebhookUrl("https://api.example.com/callback")).toBe(true);
  });

  it("allows valid http URLs", () => {
    expect(isAllowedWebhookUrl("http://example.com/hook")).toBe(true);
  });

  it("rejects non-http(s) protocols", () => {
    expect(isAllowedWebhookUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedWebhookUrl("ftp://example.com")).toBe(false);
    expect(isAllowedWebhookUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects loopback IPv4", () => {
    expect(isAllowedWebhookUrl("http://127.0.0.1/webhook")).toBe(false);
    expect(isAllowedWebhookUrl("http://127.255.255.255/hook")).toBe(false);
    expect(isAllowedWebhookUrl("https://localhost/hook")).toBe(false);
  });

  it("rejects RFC 1918 private ranges", () => {
    expect(isAllowedWebhookUrl("http://10.0.0.1/hook")).toBe(false);
    expect(isAllowedWebhookUrl("http://10.255.255.255/hook")).toBe(false);
    expect(isAllowedWebhookUrl("http://172.16.0.1/hook")).toBe(false);
    expect(isAllowedWebhookUrl("http://172.31.255.255/hook")).toBe(false);
    expect(isAllowedWebhookUrl("http://192.168.0.1/hook")).toBe(false);
    expect(isAllowedWebhookUrl("http://192.168.255.255/hook")).toBe(false);
  });

  it("rejects link-local IPv4", () => {
    expect(isAllowedWebhookUrl("http://169.254.0.1/hook")).toBe(false);
    expect(isAllowedWebhookUrl("http://169.254.255.255/hook")).toBe(false);
  });

  it("rejects GCP metadata hostnames", () => {
    expect(isAllowedWebhookUrl("http://metadata.google.internal/computeMetadata/v1/")).toBe(false);
    expect(isAllowedWebhookUrl("http://metadata/computeMetadata/v1/")).toBe(false);
  });

  it("rejects .local and .internal TLDs", () => {
    expect(isAllowedWebhookUrl("http://foo.local/hook")).toBe(false);
    expect(isAllowedWebhookUrl("http://bar.internal/hook")).toBe(false);
  });

  it("rejects IPv6 loopback and link-local", () => {
    expect(isAllowedWebhookUrl("http://[::1]/hook")).toBe(false);
    expect(isAllowedWebhookUrl("http://[fe80::1]/hook")).toBe(false);
  });

  it("rejects empty or invalid input", () => {
    expect(isAllowedWebhookUrl("")).toBe(false);
    expect(isAllowedWebhookUrl("   ")).toBe(false);
    expect(isAllowedWebhookUrl("not-a-url")).toBe(false);
    expect(isAllowedWebhookUrl("http://")).toBe(false);
  });

  it("allows public IPv4", () => {
    expect(isAllowedWebhookUrl("https://8.8.8.8/hook")).toBe(true);
    expect(isAllowedWebhookUrl("https://1.1.1.1/hook")).toBe(true);
  });
});
