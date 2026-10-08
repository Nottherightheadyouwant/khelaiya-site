import "server-only";

/**
 * Checks if an IP string is an internal, loopback, or private cloud metadata address.
 */
function isPrivateOrReservedIp(ip: string): boolean {
  // Check loopback
  if (ip === "localhost" || ip === "127.0.0.1" || ip === "::1") return true;

  // IPv4 checks
  const ipv4Match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, aStr, bStr] = ipv4Match;
    const a = parseInt(aStr, 10);
    const b = parseInt(bStr, 10);

    // 0.0.0.0/8
    if (a === 0) return true;
    // 10.0.0.0/8
    if (a === 10) return true;
    // 127.0.0.0/8
    if (a === 127) return true;
    // 169.254.0.0/16 (Link Local & Cloud metadata)
    if (a === 169 && b === 254) return true;
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true;
    // Broadcast
    if (a >= 224) return true;
  }

  // IPv6 private / link-local
  const lower = ip.toLowerCase();
  if (
    lower.startsWith("fe80:") ||
    lower.startsWith("fc00:") ||
    lower.startsWith("fd00:") ||
    lower === "::" ||
    lower === "0:0:0:0:0:0:0:0"
  ) {
    return true;
  }

  return false;
}

/**
 * Validates a target URL against SSRF vulnerabilities before the server fetches it.
 */
export function validateSafeUrlForFetch(urlString: string): { safe: boolean; error?: string } {
  try {
    const url = new URL(urlString);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { safe: false, error: `Disallowed protocol: '${url.protocol}'. Only http: and https: are allowed.` };
    }

    const hostname = url.hostname.toLowerCase();

    if (
      hostname === "localhost" ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      isPrivateOrReservedIp(hostname)
    ) {
      return { safe: false, error: `Target host '${hostname}' resolves to a private or reserved network.` };
    }

    return { safe: true };
  } catch {
    return { safe: false, error: "Malformed URL provided." };
  }
}
