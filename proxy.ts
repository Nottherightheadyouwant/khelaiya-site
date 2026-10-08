import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";
import { validateCsrfOrigin } from "@/lib/security/csrf";
import { checkRateLimit, getClientIp } from "@/lib/security/rateLimit";
import { applySecurityHeaders } from "@/lib/security/headers";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const method = request.method;

  // 1. Enforce CSRF protection on state-changing API endpoints
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    if (pathname.startsWith("/api/")) {
      const csrfCheck = validateCsrfOrigin(request.headers);
      if (!csrfCheck.valid) {
        return new NextResponse(
          JSON.stringify({ error: "Invalid cross-origin request." }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        );
      }
    }
  }

  // 2. Enforce Edge Rate Limiting on sensitive endpoints
  const clientIp = getClientIp(request.headers);

  if (pathname.startsWith("/api/reservations") && method === "POST") {
    // Max 15 reservations holds per minute per IP
    const rate = checkRateLimit(`res:${clientIp}`, { limit: 15, windowMs: 60 * 1000 });
    if (!rate.success) {
      return new NextResponse(
        JSON.stringify({ error: "Too many reservation attempts. Please try again shortly." }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(rate.retryAfterSeconds || 60),
          },
        }
      );
    }
  }

  if (pathname.startsWith("/api/bookings") && method === "POST") {
    // Max 15 UPI submissions per minute per IP
    const rate = checkRateLimit(`book:${clientIp}`, { limit: 15, windowMs: 60 * 1000 });
    if (!rate.success) {
      return new NextResponse(
        JSON.stringify({ error: "Too many booking attempts. Please wait a moment." }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(rate.retryAfterSeconds || 60),
          },
        }
      );
    }
  }

  if (pathname.startsWith("/api/bookings") && method === "GET") {
    // Max 45 status queries per minute per IP to prevent status probing
    const rate = checkRateLimit(`status:${clientIp}`, { limit: 45, windowMs: 60 * 1000 });
    if (!rate.success) {
      return new NextResponse(
        JSON.stringify({ error: "Too many queries. Please slow down." }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(rate.retryAfterSeconds || 60),
          },
        }
      );
    }
  }

  // 3. Update Supabase auth session via cookies
  let response: NextResponse;
  try {
    response = await updateSession(request);
  } catch {
    response = NextResponse.next();
  }

  // 4. Inject HTTP Security Headers
  applySecurityHeaders(response.headers);

  return response;
}

// Keep export for backwards compatibility
export const middleware = proxy;

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
