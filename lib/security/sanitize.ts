/**
 * Sanitizes URLs to prevent JavaScript execution via `javascript:`, `data:`,
 * or `vbscript:` URI schemes in anchor hrefs or image sources.
 */
export function sanitizeUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return trimmed;
    }
    // Allow UPI protocol for payment links
    if (parsed.protocol === "upi:") {
      return trimmed;
    }
  } catch {
    // Relative paths starting with /
    if (trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.startsWith("/\\")) {
      return trimmed;
    }
  }

  return null;
}

/**
 * Escapes characters for HTML context if string interpolation is ever needed.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
