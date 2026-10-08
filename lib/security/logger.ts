import "server-only";

const SENSITIVE_KEYS = new Set([
  "password",
  "passwd",
  "secret",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "cookie",
  "set-cookie",
  "apikey",
  "servicekey",
  "privatekey",
  "upireference",
  "utr",
]);

/**
 * Recursively scrubs sensitive data from objects before logging.
 */
export function sanitizeForLogging(data: unknown, depth = 0): unknown {
  if (depth > 5) return "[MaxDepthReached]";
  if (data === null || data === undefined) return data;

  if (typeof data === "string") {
    // Mask potential phone numbers (e.g. 10 digits)
    if (/^\d{10}$/.test(data)) {
      return data.slice(0, 2) + "******" + data.slice(8);
    }
    // Mask long tokens or hashes
    if (data.length > 50 && !data.includes(" ")) {
      return data.slice(0, 6) + "...[REDACTED]..." + data.slice(-4);
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeForLogging(item, depth + 1));
  }

  if (typeof data === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_KEYS.has(lowerKey)) {
        sanitized[key] = "[REDACTED]";
      } else {
        sanitized[key] = sanitizeForLogging(value, depth + 1);
      }
    }
    return sanitized;
  }

  return data;
}

export const safeLog = {
  info: (message: string, context?: unknown) => {
    if (process.env.NODE_ENV !== "test") {
      if (context !== undefined) {
        console.log(`[INFO] ${message}`, sanitizeForLogging(context));
      } else {
        console.log(`[INFO] ${message}`);
      }
    }
  },
  warn: (message: string, context?: unknown) => {
    if (context !== undefined) {
      console.warn(`[WARN] ${message}`, sanitizeForLogging(context));
    } else {
      console.warn(`[WARN] ${message}`);
    }
  },
  error: (message: string, error?: unknown) => {
    const sanitizedError = error instanceof Error
      ? { message: error.message, name: error.name }
      : sanitizeForLogging(error);
    console.error(`[ERROR] ${message}`, sanitizedError);
  },
};
