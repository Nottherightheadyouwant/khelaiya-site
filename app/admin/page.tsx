import Link from "next/link";
import { logoutAction, reviewBookingAction } from "@/app/actions";
import { requireAdmin } from "@/lib/supabase/admin";
import type { Booking, Event } from "@/lib/types";

const money = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
const dateText = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ saved?: string; reviewed?: string; error?: string }> }) {
  const { supabase, user } = await requireAdmin();
  if (!supabase || !user) return null;
  await supabase.rpc("release_expired_upi_holds");
  const [{ data: eventRows }, { data: bookingRows }] = await Promise.all([
    supabase.from("events").select("*, tickets(*)").order("created_at", { ascending: false }),
    supabase.from("bookings").select("*, events(name), booking_items(*)").order("created_at", { ascending: false }),
  ]);
  const events = (eventRows || []) as unknown as Event[];
  const bookings = (bookingRows || []) as unknown as (Booking & { events?: { name: string }; booking_items?: { ticket_name: string; quantity: number }[] })[];
  const pending = bookings.filter((booking) => booking.status === "pending_verification");
  const passCount = events.reduce((sum, event) => sum + (event.tickets || []).reduce((n, ticket) => n + ticket.quantity_remaining, 0), 0);
  const verifiedRevenue = bookings.filter((booking) => booking.status === "verified").reduce((sum, booking) => sum + Number(booking.total_inr), 0);
  const params = await searchParams;

  return <main className="admin-page">
    <header className="admin-top"><Link className="brand" href="/">khelaiya<span>.</span></Link><div className="admin-top-actions"><span>{user.email}</span><Link href="/">View website ↗</Link><form action={logoutAction}><button>Sign out</button></form></div></header>
    <div className="admin-layout"><nav className="admin-sidebar"><span>WORKSPACE</span><a className="selected" href="#events">◷ &nbsp; Events</a><a href="#inventory">▤ &nbsp; Vendors & passes</a><a href="#verification">✓ &nbsp; UPI verification</a></nav>
      <div className="admin-content"><div className="admin-title"><div><h1>Events desk</h1><p>Manage listings, inventory, and manual UPI reviews.</p></div><Link className="button primary" href="/admin/events/new">＋ Add event</Link></div>
        {params.saved && <div className="success-flash">Your event changes are saved.</div>}
        {params.reviewed && <div className="success-flash">Booking review saved.</div>}
        {params.error && <div className="form-error">The requested action could not be completed. Please review the event or booking details.</div>}
        <div className="admin-stats"><article><small>Events</small><strong>{events.length}</strong><span>{events.filter((event) => event.published).length} published</span></article><article><small>Passes remaining</small><strong>{passCount.toLocaleString("en-IN")}</strong><span>Across all active vendor passes</span></article><article><small>UPI reviews</small><strong>{pending.length}</strong><span>{pending.length ? "Awaiting verification" : "All caught up"}</span></article><article><small>Verified revenue</small><strong>{money(verifiedRevenue)}</strong><span>Verified bookings only</span></article></div>

        <section id="events" className="admin-panel"><div className="panel-title"><div><h2>Events</h2><p>Events and their client side visibility.</p></div></div><div className="table-scroll"><table><thead><tr><th>Event</th><th>City</th><th>Venue</th><th>Dates</th><th>Passes</th><th>Website</th><th /></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td><strong>{event.name}</strong></td><td>{event.city}</td><td>{event.venue_name}</td><td>{event.event_dates.length} dates</td><td>{event.tickets?.length || 0} types</td><td><span className={event.published ? "status verified" : "status pending"}>{event.published ? "Published" : "Draft"}</span></td><td><Link className="table-action" href={`/admin/events/${event.id}`}>Edit</Link></td></tr>)}</tbody></table></div></section>

        <section id="inventory" className="admin-panel"><div className="panel-title"><div><h2>Vendor passes</h2><p>Ticket type, price, and remaining quantity by event.</p></div></div><div className="table-scroll"><table><thead><tr><th>Vendor</th><th>Pass type</th><th>Event</th><th>Price</th><th>Total</th><th>Remaining</th></tr></thead><tbody>{events.flatMap((event) => (event.tickets || []).filter((ticket) => ticket.is_active).map((ticket) => <tr key={ticket.id}><td><strong>{ticket.vendor_name}</strong></td><td>{ticket.pass_name}</td><td>{event.name}</td><td>{money(ticket.price_inr)}</td><td>{ticket.quantity_total}</td><td>{ticket.quantity_remaining}</td></tr>))}</tbody></table></div></section>

        <section id="verification" className="admin-panel"><div className="panel-title"><div><h2>Manual UPI verification</h2><p>Confirm the UTR in your UPI account before issuing passes.</p></div><span className="status pending">{pending.length} TO REVIEW</span></div>{bookings.length ? <div className="table-scroll"><table><thead><tr><th>Booking</th><th>Customer</th><th>Event & date</th><th>Passes</th><th>Amount</th><th>UPI reference</th><th>Status / review</th></tr></thead><tbody>{bookings.map((booking) => <tr key={booking.id}><td><strong>{booking.booking_code}</strong><small className="table-small">{new Date(booking.created_at).toLocaleString("en-IN")}</small></td><td>{booking.customer_name}<small className="table-small">{booking.phone}</small></td><td>{booking.events?.name}<small className="table-small">{dateText(booking.event_date)}</small></td><td>{booking.booking_items?.map((item) => `${item.ticket_name} × ${item.quantity}`).join(", ")}</td><td><strong>{money(Number(booking.total_inr))}</strong></td><td>{booking.upi_reference || "Waiting for payment"}</td><td>{booking.status === "pending_verification" ? <form action={reviewBookingAction} className="review-actions"><input type="hidden" name="booking_id" value={booking.id} /><button name="decision" value="verified">Verify</button><button name="decision" value="rejected">Reject</button></form> : <span className={`status ${booking.status === "verified" ? "verified" : booking.status === "rejected" || booking.status === "expired" ? "rejected" : "pending"}`}>{booking.status.replaceAll("_", " ")}</span>}</td></tr>)}</tbody></table></div> : <div className="empty-state">No bookings yet.</div>}</section>
        <p className="admin-note">Customer passes are reserved when a booking request is submitted. Rejecting a request returns its inventory to sale.</p>
      </div>
    </div>
  </main>;
}
