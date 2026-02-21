/**
 * Webhook URL validation to prevent SSRF (e.g. reaching GCP metadata, internal networks).
 * Only http/https allowed; blocks loopback, RFC-1918, link-local, and metadata.google.internal.
 */

const BLOCKED_HOSTS = new Set(["metadata.google.internal", "metadata", "localhost", "localhost.localdomain"]);

/** Loopback: 127.0.0.0/8 */
function isLoopback4(parts: number[]): boolean {
  return parts[0] === 127;
}

/** RFC 1918: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 */
function isPrivate4(parts: number[]): boolean {
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

/** Link-local: 169.254.0.0/16 */
function isLinkLocal4(parts: number[]): boolean {
  return parts[0] === 169 && parts[1] === 254;
}

function parseIPv4(host: string): number[] | null {
  const parts = host.split(".").map((s) => parseInt(s, 10));
  if (parts.length !== 4) return null;
  if (parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return parts;
}

/** Returns true if the URL is allowed for webhook delivery (no SSRF risk). */
export function isAllowedWebhookUrl(urlString: string): boolean {
  if (typeof urlString !== "string" || !urlString.trim()) return false;
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return false;
  }
  const protocol = url.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) return false;
  if (host.endsWith(".local")) return false;
  if (host.endsWith(".internal")) return false;

  const ipv4 = parseIPv4(host);
  if (ipv4) {
    if (isLoopback4(ipv4)) return false;
    if (isPrivate4(ipv4)) return false;
    if (isLinkLocal4(ipv4)) return false;
  }

  // IPv6 loopback / link-local (simplified: reject if host looks like [...])
  if (host.startsWith("[") && (host.includes("::1") || host.toLowerCase().includes("fe80"))) return false;

  return true;
}
