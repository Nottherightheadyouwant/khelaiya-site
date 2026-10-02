import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const items = Array.isArray(body.items) ? body.items : [];
  const valid =
    typeof body.eventId === "string" &&
    typeof body.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(body.date) &&
    typeof body.customerName === "string" &&
    body.customerName.trim().length >= 2 &&
    body.customerName.trim().length <= 100 &&
    typeof body.phone === "string" &&
    /^\d{10}$/.test(body.phone) &&
    items.length > 0 &&
    items.length <= 12 &&
    items.every((item) => item && typeof item === "object" &&
      typeof (item as Record<string, unknown>).ticketId === "string" &&
      Number.isInteger((item as Record<string, unknown>).quantity) &&
      Number((item as Record<string, unknown>).quantity) > 0 &&
      Number((item as Record<string, unknown>).quantity) <= 10);
  if (!valid) return NextResponse.json({ error: "Check your contact details and pass quantities." }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    // Preview / demo mode: generate a 20-minute reservation hold
    const bookingId = crypto.randomUUID();
    const bookingCode = `KHL-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    return NextResponse.json({
      bookingId,
      bookingCode,
      expiresAt,
      isDemo: true,
    }, { status: 201 });
  }

  const { data, error } = await supabase.rpc("create_manual_booking_hold", {
    p_event_id: String(body.eventId),
    p_event_date: String(body.date),
    p_customer_name: String(body.customerName).trim(),
    p_phone: String(body.phone),
    p_items: items,
  });
  if (error) {
    const message = error.message.includes("SOLD_OUT")
      ? "One or more passes just sold out. Please adjust your selection."
      : error.message.includes("EVENT_NOT_AVAILABLE")
        ? "This date is no longer available."
        : "We could not reserve these passes. Check your selection and try again.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
  return NextResponse.json(data, { status: 201 });
}
