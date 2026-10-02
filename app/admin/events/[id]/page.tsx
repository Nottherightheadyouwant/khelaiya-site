import Link from "next/link";
import { saveEventAction } from "@/app/actions";
import { requireAdmin } from "@/lib/supabase/admin";
import type { Event } from "@/lib/types";

export default async function AdminEventForm({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error } = await searchParams;
  const { supabase } = await requireAdmin();
  if (!supabase) return null;
  const isNew = id === "new";
  const { data } = isNew ? { data: null } : await supabase.from("events").select("*, tickets(*)").eq("id", id).single();
  const event = data as unknown as Event | null;
  if (!isNew && !event) return <main className="setup-screen"><div className="setup-card"><h1>Event not found</h1><Link href="/admin">Return to events</Link></div></main>;
  const ticketLines = (event?.tickets || []).filter((ticket) => ticket.is_active).map((ticket) => `${ticket.vendor_name} | ${ticket.pass_name} | ${ticket.price_inr} | ${ticket.quantity_total}`).join("\n");
  const errors: Record<string, string> = {
    required: "Add an event name, city, venue, and at least one valid date.",
    tickets: "Check each vendor pass line and confirm its price and quantity.",
    image: "Use a supported image up to 5 MB.",
    upload: "Cover image upload failed. Check that the event-covers storage bucket exists.",
    save: "Event could not be saved. Check the Supabase schema and access policies.",
    duplicate: "Vendor and pass names must be unique within this event.",
    quantity: "Total quantity cannot be lower than the number of passes already sold.",
  };
  return <main className="form-page"><header className="admin-top"><Link className="brand" href="/">khelaiya<span>.</span></Link><Link href="/admin">← Back to event desk</Link></header><section className="event-form-card"><span className="eyebrow dark-eyebrow">EVENT SETUP</span><h1>{isNew ? "Add an event" : "Edit event"}</h1><p>Set up the details guests see before they choose passes.</p>{error && <div className="form-error">{errors[error] || "Could not save this event."}</div>}
    <form action={saveEventAction} className="event-admin-form"><input type="hidden" name="event_id" value={isNew ? "" : id} />
      <div className="form-grid"><label>Event name<input name="name" required defaultValue={event?.name} placeholder="e.g. Raas under the stars" /></label><label>City<input name="city" required defaultValue={event?.city} placeholder="Ahmedabad" /></label></div>
      <label>Venue name<input name="venue_name" required defaultValue={event?.venue_name} placeholder="Venue or ground" /></label>
      <label>About the event<textarea name="event_description" rows={3} defaultValue={event?.event_description} placeholder="What should guests expect?" /></label>
      <label>About the venue<textarea name="venue_description" rows={3} defaultValue={event?.venue_description} placeholder="Access, parking, facilities..." /></label>
      <label>Event dates <small>Separate dates with commas, in YYYY-MM-DD format.</small><input name="event_dates" required defaultValue={event?.event_dates.join(", ")} placeholder="2026-10-11, 2026-10-12" /></label>
      <div className="cover-upload"><label>Event cover / hero image <small>One image used on the listing card and event details. This is not a photo gallery.</small><input type="file" name="hero_image" accept="image/jpeg,image/png,image/webp" /></label>{event?.hero_image_url && <div className="current-cover" style={{ backgroundImage: `url("${event.hero_image_url}")` }}><span>Current cover image</span></div>}</div>
      <label>Vendor passes <small>One per line: Vendor name | Pass type | Price in ₹ | Total quantity</small><textarea name="tickets" rows={6} defaultValue={ticketLines} placeholder={'Early Bird | Entry pass | 499 | 120\nVIP Vendor | Premium pass | 1499 | 50'} /></label>
      <label className="checkbox-label"><input name="published" type="checkbox" defaultChecked={event?.published ?? true} /> Publish this event on the website</label>
      <button className="button primary">{isNew ? "Publish event" : "Save event"}</button>
    </form></section></main>;
}
