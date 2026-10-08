import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validateCsrfOrigin, validateJsonContentType } from "@/lib/security/csrf";
import { checkRateLimit, getClientIp } from "@/lib/security/rateLimit";
import { safeLog } from "@/lib/security/logger";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOOKING_CODE_REGEX = /^[A-Z0-9-]{4,32}$/i;
const UPI_REF_REGEX = /^[A-Za-z0-9-_/]{6,64}$/;

export async function GET(request: NextRequest) {
  const clientIp = getClientIp(request.headers);
  const rate = checkRateLimit(`status:${clientIp}`, { limit: 30, windowMs: 60 * 1000 });
  if (!rate.success) {
    return NextResponse.json(
      { error: "Too many status queries. Please wait a minute." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds || 60) } }
    );
  }

  const rawCode = request.nextUrl.searchParams.get("code");
  if (!rawCode || !BOOKING_CODE_REGEX.test(rawCode.trim())) {
    return NextResponse.json({ error: "Valid booking reference required." }, { status: 400 });
  }

  const code = rawCode.trim().toUpperCase();
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ status: "pending_verification" });
  }

  const { data, error } = await supabase.rpc("check_booking_status", {
    p_code: code,
  });

  if (error || !data) {
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  }

  // Ensure only authorized, non-sensitive booking summary is returned (No PII)
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  // 1. Validate CSRF origin
  const csrfCheck = validateCsrfOrigin(request.headers);
  if (!csrfCheck.valid) {
    return NextResponse.json({ error: "Cross-origin request blocked." }, { status: 403 });
  }

  // 2. Validate Content-Type
  if (!validateJsonContentType(request.headers)) {
    return NextResponse.json({ error: "Invalid Content-Type header." }, { status: 415 });
  }

  // 3. Rate limiting per client IP
  const clientIp = getClientIp(request.headers);
  const rate = checkRateLimit(`book:${clientIp}`, { limit: 10, windowMs: 60 * 1000 });
  if (!rate.success) {
    return NextResponse.json(
      { error: "Too many submission attempts. Please wait a minute." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds || 60) } }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const bookingId = typeof body.bookingId === "string" ? body.bookingId.trim() : "";
  const upiRef = typeof body.upiReference === "string" ? body.upiReference.trim() : "";

  if (!UUID_REGEX.test(bookingId)) {
    return NextResponse.json({ error: "Invalid booking ID format." }, { status: 400 });
  }

  if (!UPI_REF_REGEX.test(upiRef)) {
    return NextResponse.json(
      { error: "Enter a valid UPI transaction reference (UTR) of 6–64 characters." },
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    // Preview / demo mode: return demo booking confirmation reference
    const bookingCode = `KHL-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    return NextResponse.json({ bookingCode, isDemo: true }, { status: 201 });
  }

  const { data, error } = await supabase.rpc("finalize_manual_booking", {
    p_booking_id: bookingId,
    p_upi_reference: upiRef,
  });

  if (error) {
    safeLog.warn("Manual booking submission failed", { message: error.message });
    const message = error.message.includes("HOLD_EXPIRED")
      ? "Your 20-minute pass hold expired. Please select your passes again."
      : error.message.includes("duplicate key")
        ? "This UPI reference has already been submitted."
        : "We could not submit this payment reference. Check it and try again.";
    return NextResponse.json({ error: message }, { status: 409 });
  }

  return NextResponse.json({ bookingCode: data }, { status: 201 });
}
