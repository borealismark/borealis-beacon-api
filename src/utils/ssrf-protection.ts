import { promises as dns } from "dns";
import * as net from "net";

// RFC 1918 private ranges, loopback, link-local, cloud metadata
const BLOCKED_RANGES = [
  { start: "10.0.0.0", end: "10.255.255.255" },
  { start: "172.16.0.0", end: "172.31.255.255" },
  { start: "192.168.0.0", end: "192.168.255.255" },
  { start: "127.0.0.0", end: "127.255.255.255" },
  { start: "169.254.0.0", end: "169.254.255.255" },
  { start: "0.0.0.0", end: "0.255.255.255" },
  { start: "100.64.0.0", end: "100.127.255.255" },
  { start: "::1", end: "::1" },
  { start: "fc00::", end: "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff" },
];

// Cloud metadata endpoints that must always be blocked
const BLOCKED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "169.254.169.254",
  "fd00:ec2::254",
]);

function ipToLong(ip: string): number {
  return ip
    .split(".")
    .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function isIpInRange(ip: string, start: string, end: string): boolean {
  if (net.isIPv6(ip)) {
    // For IPv6 we only block ::1 and fc00::/7 explicitly
    return ip === "::1" || ip.toLowerCase().startsWith("fc") || ip.toLowerCase().startsWith("fd");
  }
  try {
    const ipLong = ipToLong(ip);
    const startLong = ipToLong(start);
    const endLong = ipToLong(end);
    return ipLong >= startLong && ipLong <= endLong;
  } catch {
    return false;
  }
}

function isPrivateIp(ip: string): boolean {
  for (const range of BLOCKED_RANGES) {
    if (isIpInRange(ip, range.start, range.end)) {
      return true;
    }
  }
  return false;
}

export async function validateUrl(rawUrl: string): Promise<{ valid: boolean; error?: string; normalizedUrl?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { valid: false, error: "Only HTTP and HTTPS URLs are allowed" };
  }

  const hostname = parsed.hostname;

  if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) {
    return { valid: false, error: "Blocked hostname" };
  }

  // Block raw IP literals that are private
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      return { valid: false, error: "Private IP addresses are not allowed" };
    }
  } else {
    // Resolve hostname and check resolved IPs
    try {
      const addresses = await dns.lookup(hostname, { all: true });
      for (const addr of addresses) {
        if (isPrivateIp(addr.address)) {
          return { valid: false, error: "Hostname resolves to a private IP address" };
        }
        if (BLOCKED_HOSTNAMES.has(addr.address)) {
          return { valid: false, error: "Blocked hostname" };
        }
      }
    } catch {
      // If DNS resolution fails, allow it through - the fetch will fail naturally
      // This prevents blocking legitimate domains with temporary DNS issues
    }
  }

  return {
    valid: true,
    normalizedUrl: parsed.href,
  };
}
