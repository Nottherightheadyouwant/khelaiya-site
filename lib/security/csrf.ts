import "server-only";

/**
 * Validate that state-changing requests (POST, PUT, DELETE, PATCH) originate
 * from the same origin or an explicitly allowed origin.
 */
export function validateCsrfOrigin(headers: Headers): { valid: boolean; reason?: string } {
  // Sec-Fetch-Site header check (standard in modern browsers)
  const secFetchSite = headers.get("sec-fetch-site");
  if (secFetchSite === "cross-site") {
    return { valid: false, reason: "Cross-site request blocked by Sec-Fetch-Site policy." };
  }

  const origin = headers.get("origin");
  const host = headers.get("host") || headers.get("x-forwarded-host");

  if (!host) {
    return { valid: false, reason: "Host header is missing." };
  }

  // If origin is present, ensure it matches the host or configured site URL
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const hostWithoutPort = host.split(":")[0];
      const originHostWithoutPort = originUrl.hostname;

      if (originHostWithoutPort !== hostWithoutPort && originHostWithoutPort !== "localhost") {
        const allowedSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
        if (allowedSiteUrl) {
          try {
            const siteUrl = new URL(allowedSiteUrl);
            if (siteUrl.hostname === originHostWithoutPort) {
              return { valid: true };
            }
          } catch {
            // Ignore parse errors on misconfigured site URL
          }
        }
        return { valid: false, reason: `Origin '${origin}' does not match host '${host}'.` };
      }
    } catch {
      return { valid: false, reason: "Malformed Origin header." };
    }
  }

  return { valid: true };
}

/**
 * Validates that an incoming mutation request uses an expected Content-Type.
 */
export function validateJsonContentType(headers: Headers): boolean {
  const contentType = headers.get("content-type");
  return Boolean(contentType && contentType.toLowerCase().includes("application/json"));
}
