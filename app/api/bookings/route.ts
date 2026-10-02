import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code || code.trim().length < 4) {
    return NextResponse.json({ error: "Booking reference required." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ status: "pending_verification" });
  }

  const { data, error } = await supabase.rpc("check_booking_status", {
    p_code: code.trim(),
  });

  if (error || !data) {
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  }

  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (
    typeof body.bookingId !== "string" ||
    typeof body.upiReference !== "string" ||
    body.upiReference.trim().length < 6 ||
    body.upiReference.trim().length > 64
  ) {
    return NextResponse.json(
      { error: "Enter the UPI transaction reference (UTR) to submit your booking." },
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
    p_booking_id: body.bookingId,
    p_upi_reference: body.upiReference.trim(),
  });
  if (error) {
    const message = error.message.includes("HOLD_EXPIRED")
      ? "Your 20-minute pass hold expired. Please select your passes again."
      : error.message.includes("duplicate key")
        ? "This UPI reference has already been submitted."
        : "We could not submit this payment reference. Check it and try again.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
  return NextResponse.json({ bookingCode: data }, { status: 201 });
}
