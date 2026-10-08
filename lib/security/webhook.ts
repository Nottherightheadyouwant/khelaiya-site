import "server-only";
import crypto from "crypto";

export interface WebhookVerificationOptions {
  secret: string;
  signatureHeader: string;
  payload: string | Buffer;
  timestampHeader?: string;
  toleranceSeconds?: number;
}

/**
 * Verify HMAC-SHA256 signatures for incoming webhooks (e.g. Supabase DB Webhooks,
 * payment provider callbacks) using constant-time comparison to prevent timing attacks.
 */
export function verifyHmacSha256Signature(options: WebhookVerificationOptions): {
  valid: boolean;
  error?: string;
} {
  const { secret, signatureHeader, payload, timestampHeader, toleranceSeconds = 300 } = options;

  if (!secret) {
    return { valid: false, error: "Missing webhook secret on server." };
  }
  if (!signatureHeader) {
    return { valid: false, error: "Missing signature header on incoming request." };
  }

  // Prevent replay attacks if timestamp header is provided
  if (timestampHeader) {
    const timestampMs = Number(timestampHeader) * 1000;
    if (isNaN(timestampMs) || Math.abs(Date.now() - timestampMs) > toleranceSeconds * 1000) {
      return { valid: false, error: "Webhook timestamp expired or outside tolerance window." };
    }
  }

  // Clean signature (handle prefixes like 'sha256=' or 'v1=')
  const cleanSignature = signatureHeader.replace(/^sha256=|^v1=/, "").trim();

  // Compute expected HMAC
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(payload);
  const expectedSignatureHex = hmac.digest("hex");

  try {
    const sigBuffer = Buffer.from(cleanSignature, "hex");
    const expectedBuffer = Buffer.from(expectedSignatureHex, "hex");

    if (sigBuffer.length !== expectedBuffer.length) {
      return { valid: false, error: "Signature length mismatch." };
    }

    // Constant-time comparison
    const isValid = crypto.timingSafeEqual(sigBuffer, expectedBuffer);
    return { valid: isValid, error: isValid ? undefined : "Invalid signature." };
  } catch {
    return { valid: false, error: "Signature verification failed." };
  }
}
