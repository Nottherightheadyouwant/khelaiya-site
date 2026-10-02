"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

export async function loginAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/admin/login?error=setup");
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect("/admin/login?error=invalid");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: admin } = user
    ? await supabase.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle()
    : { data: null };
  if (!admin) {
    await supabase.auth.signOut();
    redirect("/admin/login?error=not-admin");
  }
  redirect("/admin");
}

export async function logoutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase?.auth.signOut();
  redirect("/");
}

function parseTicketLines(text: string) {
  return text
    .split("\n")
    .map((line) => line.split("|").map((part) => part.trim()))
    .filter((parts) => parts.some(Boolean))
    .map(([vendor_name, pass_name, price, quantity]) => ({
      vendor_name,
      pass_name,
      price_inr: Number(price),
      quantity_total: Number(quantity),
    }));
}

export async function saveEventAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  if (!supabase) redirect("/admin/login?error=setup");

  const eventId = String(formData.get("event_id") || "");
  const name = String(formData.get("name") || "").trim();
  const city = String(formData.get("city") || "").trim();
  const venue = String(formData.get("venue_name") || "").trim();
  const eventDescription = String(formData.get("event_description") || "").trim();
  const venueDescription = String(formData.get("venue_description") || "").trim();
  const dates = String(formData.get("event_dates") || "")
    .split(",")
    .map((date) => date.trim())
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  const published = formData.get("published") === "on";
  const tickets = parseTicketLines(String(formData.get("tickets") || ""));
  if (!name || !city || !venue || dates.length === 0) {
    redirect(`/admin/events/${eventId || "new"}?error=required`);
  }
  if (
    tickets.some(
      (ticket) =>
        !ticket.vendor_name ||
        !ticket.pass_name ||
        !Number.isFinite(ticket.price_inr) ||
        ticket.price_inr <= 0 ||
        !Number.isInteger(ticket.quantity_total) ||
        ticket.quantity_total < 0,
    )
  ) {
    redirect(`/admin/events/${eventId || "new"}?error=tickets`);
  }

  const existing = eventId
    ? await supabase
        .from("events")
        .select("*")
        .eq("id", eventId)
        .single()
    : { data: null, error: null };
  if (existing.error) redirect("/admin?error=event");

  let heroImageUrl = existing.data?.hero_image_url || null;
  const image = formData.get("hero_image");
  if (image instanceof File && image.size > 0) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(image.type) || image.size > 5 * 1024 * 1024) {
      redirect(`/admin/events/${eventId || "new"}?error=image`);
    }
    const extension = image.type.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
    const path = `${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from("event-covers")
      .upload(path, image, { contentType: image.type, upsert: false });
    if (uploadError) redirect(`/admin/events/${eventId || "new"}?error=upload`);
    heroImageUrl = supabase.storage.from("event-covers").getPublicUrl(path).data.publicUrl;
  }

  const eventValues = {
    name,
    city,
    venue_name: venue,
    event_description: eventDescription,
    venue_description: venueDescription,
    event_dates: dates,
    hero_image_url: heroImageUrl,
    published,
  };
  const savedEvent = eventId
    ? await supabase.from("events").update(eventValues).eq("id", eventId).select("id").single()
    : await supabase.from("events").insert(eventValues).select("id").single();
  if (savedEvent.error) redirect(`/admin/events/${eventId || "new"}?error=save`);

  const { data: currentTickets } = await supabase
    .from("tickets")
    .select("*")
    .eq("event_id", savedEvent.data.id);
  const seen = new Set<string>();
  for (const ticket of tickets) {
    const identity = `${ticket.vendor_name.toLowerCase()}|${ticket.pass_name.toLowerCase()}`;
    if (seen.has(identity)) redirect(`/admin/events/${savedEvent.data.id}?error=duplicate`);
    seen.add(identity);
    const current = currentTickets?.find(
      (row) =>
        `${row.vendor_name.toLowerCase()}|${row.pass_name.toLowerCase()}` === identity,
    );
    const sold = current
      ? Number(current.quantity_total) - Number(current.quantity_remaining)
      : 0;
    if (ticket.quantity_total < sold) {
      redirect(`/admin/events/${savedEvent.data.id}?error=quantity`);
    }
    const values = {
      event_id: savedEvent.data.id,
      vendor_name: ticket.vendor_name,
      pass_name: ticket.pass_name,
      price_inr: ticket.price_inr,
      quantity_total: ticket.quantity_total,
      quantity_remaining: Math.max(0, ticket.quantity_total - sold),
      is_active: true,
    };
    const result = current
      ? await supabase.from("tickets").update(values).eq("id", current.id)
      : await supabase.from("tickets").insert(values);
    if (result.error) redirect(`/admin/events/${savedEvent.data.id}?error=tickets`);
  }
  for (const current of currentTickets || []) {
    const identity = `${current.vendor_name.toLowerCase()}|${current.pass_name.toLowerCase()}`;
    if (!seen.has(identity)) {
      await supabase.from("tickets").update({ is_active: false }).eq("id", current.id);
    }
  }

  revalidatePath("/");
  revalidatePath("/admin");
  redirect("/admin?saved=1");
}

export async function reviewBookingAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  if (!supabase) redirect("/admin/login?error=setup");
  const id = String(formData.get("booking_id") || "");
  const decision = String(formData.get("decision") || "");
  if (!id || !["verified", "rejected"].includes(decision)) redirect("/admin?error=review");
  const { error } = await supabase.rpc("review_upi_booking", {
    p_booking_id: id,
    p_decision: decision,
  });
  if (error) redirect("/admin?error=review");
  revalidatePath("/admin");
  redirect("/admin?reviewed=1");
}
