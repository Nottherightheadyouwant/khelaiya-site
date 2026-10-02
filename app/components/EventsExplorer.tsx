"use client";

import { useMemo, useState, useEffect } from "react";
import type { Event, Ticket } from "@/lib/types";
import { createManualUpiCheckout } from "@/lib/payment";

const money = (amount: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);

function formatDate(date: string) {
  if (!date) return "";
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatDateLong(date: string) {
  if (!date) return "";
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatTimer(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export type SavedBooking = {
  id: string;
  bookingCode: string;
  eventName: string;
  eventDate: string;
  venueName: string;
  city: string;
  count: number;
  totalInr: number;
  upiReference: string;
  status: "pending_verification" | "verified" | "rejected";
  createdAt: string;
};

export function EventsExplorer({
  events,
  isSupabaseConfigured = false,
}: {
  events: Event[];
  isSupabaseConfigured?: boolean;
}) {
  const cities = useMemo(
    () => [...new Set(events.map((event) => event.city))].sort(),
    [events],
  );

  const [city, setCity] = useState("All cities");
  const [query, setQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState("All");
  const [active, setActive] = useState<Event | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [checkout, setCheckout] = useState(false);
  const [hold, setHold] = useState<{
    bookingId: string;
    bookingCode: string;
    expiresAt: string;
    isDemo?: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [bookingCode, setBookingCode] = useState("");
  const [copiedUpi, setCopiedUpi] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [myPassesOpen, setMyPassesOpen] = useState(false);
  const [savedBookings, setSavedBookings] = useState<SavedBooking[]>([]);
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(0);

  const [checkingCode, setCheckingCode] = useState<string | null>(null);

  // Sync pass status from database
  const refreshPassStatus = async (code: string) => {
    setCheckingCode(code);
    try {
      const res = await fetch(`/api/bookings?code=${encodeURIComponent(code)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.status) {
          setSavedBookings((prev) => {
            const next = prev.map((b) =>
              b.bookingCode === code ? { ...b, status: data.status } : b
            );
            try {
              localStorage.setItem("khelaiya_my_bookings", JSON.stringify(next));
            } catch {}
            return next;
          });
        }
      }
    } catch {
      // ignore network errors
    } finally {
      setCheckingCode(null);
    }
  };

  // Auto-sync pending passes whenever My Passes is opened
  useEffect(() => {
    if (myPassesOpen && savedBookings.length > 0) {
      savedBookings.forEach((b) => {
        refreshPassStatus(b.bookingCode);
      });
    }
  }, [myPassesOpen]);

  // Load saved bookings and favorites from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem("khelaiya_my_bookings");
      if (raw) setSavedBookings(JSON.parse(raw));
      const rawFav = localStorage.getItem("khelaiya_favs");
      if (rawFav) setFavorites(JSON.parse(rawFav));
    } catch {
      // ignore in SSR
    }
  }, []);

  // 20-minute countdown timer effect
  useEffect(() => {
    if (!hold?.expiresAt) {
      setSecondsRemaining(0);
      return;
    }
    const calc = () =>
      Math.max(0, Math.floor((new Date(hold.expiresAt).getTime() - Date.now()) / 1000));
    setSecondsRemaining(calc());
    const timer = setInterval(() => {
      const rem = calc();
      setSecondsRemaining(rem);
      if (rem <= 0) {
        clearInterval(timer);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [hold?.expiresAt]);

  const toggleFavorite = (eventId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites((prev) => {
      const next = { ...prev, [eventId]: !prev[eventId] };
      try {
        localStorage.setItem("khelaiya_favs", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const visible = events.filter((event) => {
    const cityMatches = city === "All cities" || event.city === city;
    const searchText = `${event.name} ${event.city} ${event.venue_name} ${event.event_description} ${event.venue_description}`.toLowerCase();
    const queryMatches = searchText.includes(query.toLowerCase());

    let quickMatches = true;
    if (quickFilter === "AC Dome") {
      quickMatches = event.name.toLowerCase().includes("dome") || event.event_description.toLowerCase().includes("dome");
    } else if (quickFilter === "Sheri Garba") {
      quickMatches = event.name.toLowerCase().includes("sheri") || event.event_description.toLowerCase().includes("sheri") || event.event_description.toLowerCase().includes("mandli");
    } else if (quickFilter === "Kirtidan Gadhvi") {
      quickMatches = searchText.includes("kirtidan");
    } else if (quickFilter === "Aishwarya Majmudar") {
      quickMatches = searchText.includes("aishwarya");
    } else if (quickFilter === "Kinjal Dave") {
      quickMatches = searchText.includes("kinjal");
    } else if (quickFilter === "Falguni Pathak") {
      quickMatches = searchText.includes("falguni");
    } else if (quickFilter === "Bhumik Shah") {
      quickMatches = searchText.includes("bhumik");
    }

    return cityMatches && queryMatches && quickMatches;
  });

  const tickets = (active?.tickets || []).filter(
    (ticket) => ticket.is_active && ticket.quantity_remaining > 0,
  );
  const count = tickets.reduce((total, ticket) => total + (quantities[ticket.id] || 0), 0);
  const amount = tickets.reduce(
    (total, ticket) => total + ticket.price_inr * (quantities[ticket.id] || 0),
    0,
  );

  function openEvent(event: Event) {
    setActive(event);
    setSelectedDate(event.event_dates[0] || "");
    setQuantities({});
    setCheckout(false);
    setHold(null);
    setMessage("");
    setBookingCode("");
    setShowQr(false);
  }

  function setQuantity(ticket: Ticket, next: number) {
    setQuantities((current) => ({
      ...current,
      [ticket.id]: Math.max(0, Math.min(ticket.quantity_remaining, 10, next)),
    }));
  }

  function selectedItems() {
    return tickets
      .filter((ticket) => (quantities[ticket.id] || 0) > 0)
      .map((ticket) => ({ ticketId: ticket.id, quantity: quantities[ticket.id] }));
  }

  async function createHold(formData: FormData) {
    if (!active || !selectedDate) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: active.id,
          date: selectedDate,
          customerName: formData.get("customerName"),
          phone: formData.get("phone"),
          items: selectedItems(),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Passes could not be reserved.");
      setHold(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Passes could not be reserved.");
    } finally {
      setBusy(false);
    }
  }

  async function submitBooking(formData: FormData) {
    if (!hold || !active) return;
    setBusy(true);
    setMessage("");
    const upiRef = String(formData.get("upiReference") || "").trim();
    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: hold.bookingId, upiReference: upiRef }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Booking could not be submitted.");
      setBookingCode(result.bookingCode);

      // Save booking in local storage
      const newBooking: SavedBooking = {
        id: hold.bookingId,
        bookingCode: result.bookingCode,
        eventName: active.name,
        eventDate: selectedDate,
        venueName: active.venue_name,
        city: active.city,
        count,
        totalInr: amount,
        upiReference: upiRef,
        status: "pending_verification",
        createdAt: new Date().toISOString(),
      };
      const updated = [newBooking, ...savedBookings];
      setSavedBookings(updated);
      try {
        localStorage.setItem("khelaiya_my_bookings", JSON.stringify(updated));
      } catch {
        // ignore
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Booking could not be submitted.");
    } finally {
      setBusy(false);
    }
  }

  const copyUpiText = (text: string) => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedUpi(true);
      setTimeout(() => setCopiedUpi(false), 2200);
    }
  };

  const copyBookingCode = (code: string) => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2200);
    }
  };

  return (
    <>
      {/* Top Banner (Status notification) */}
      {!isSupabaseConfigured && !bannerDismissed && (
        <aside className="preview-banner" aria-label="System status">
          <div className="preview-banner-content">
            <span className="preview-pill">PREVIEW MODE</span>
            <span>
              Browsing 13 verified Ahmedabad & Gandhinagar Navratri events with authorized vendor passes.
              To sync with live Supabase database & admin panel, follow the setup in <code>README.md</code>.
            </span>
          </div>
          <button
            className="preview-close"
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss banner"
          >
            ×
          </button>
        </aside>
      )}

      {/* Main Navigation Topbar */}
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#top">
            khelaiya<span>.</span>
          </a>

          <label className="location-select">
            <small>LOCATION</small>
            <select value={city} onChange={(e) => setCity(e.target.value)}>
              <option>All cities</option>
              {cities.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>

          <label className="searchbox">
            <span aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search events, artists (Aishwarya, Kinjal...), venues"
              aria-label="Search events"
            />
            {query && (
              <button
                type="button"
                className="clear-search"
                onClick={() => setQuery("")}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </label>

          <div className="nav-actions">
            <button
              type="button"
              className="my-passes-btn"
              onClick={() => setMyPassesOpen(true)}
            >
              <span className="ticket-icon">🎟</span>
              <span>My Passes</span>
              {savedBookings.length > 0 && (
                <span className="badge-count">{savedBookings.length}</span>
              )}
            </button>
            <a className="admin-link" href="/admin">
              Admin Desk ↗
            </a>
          </div>
        </div>
      </header>

      {/* Main Page Content */}
      <main id="top" className="page-width">
        {/* Hero Section */}
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">Ahmedabad & Gandhinagar · Navratri 2026</span>
            <h1>Find your garba<br />night.</h1>
            <p>
              Nine nights. A thousand circles. Discover 13 curated garba celebrations, lock verified vendor passes for 20 minutes, and pay directly via UPI.
            </p>
            <div className="hero-actions">
              <a className="button primary" href="#events">
                Explore 13 events <span>↓</span>
              </a>
              <span className="hero-date">✦ &nbsp; 4 — 20 October 2026</span>
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="orb orb-large" />
            <div className="orb" />
            <div className="dandiya" />
            <div className="sticks" />
          </div>
          <div className="hero-tag">Every city. Every raas.</div>
        </section>

        {/* Events Catalog Section */}
        <section id="events" className="event-section">
          <div className="section-heading">
            <div>
              <h2>Garba Celebrations</h2>
              <p>Thirteen verified festival nights across Ahmedabad and Gandhinagar.</p>
            </div>
            <div className="results-count">
              Showing <strong>{visible.length}</strong> of {events.length} events
            </div>
          </div>

          {/* City & Category Filter Chips */}
          <div className="filters-container">
            <div className="filters city-filters">
              <button
                type="button"
                className={city === "All cities" ? "active" : ""}
                onClick={() => setCity("All cities")}
              >
                All locations
              </button>
              {cities.map((value) => (
                <button
                  type="button"
                  key={value}
                  className={city === value ? "active" : ""}
                  onClick={() => setCity(value)}
                >
                  📍 {value}
                </button>
              ))}
            </div>

            <div className="quick-filters">
              <span className="quick-label">Filter by:</span>
              {[
                "All",
                "AC Dome",
                "Sheri Garba",
                "Aishwarya Majmudar",
                "Kirtidan Gadhvi",
                "Kinjal Dave",
                "Falguni Pathak",
                "Bhumik Shah",
              ].map((tag) => (
                <button
                  type="button"
                  key={tag}
                  className={`tag-chip ${quickFilter === tag ? "tag-active" : ""}`}
                  onClick={() => setQuickFilter(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Event Cards Grid */}
          <div className="event-grid">
            {visible.map((event, index) => {
              const activeTickets = event.tickets.filter((t) => t.is_active);
              const minPrice = activeTickets.reduce<number | null>(
                (min, ticket) => (min === null ? ticket.price_inr : Math.min(min, ticket.price_inr)),
                null,
              );
              const advertisedPrice = event.public_price_from ? Number(event.public_price_from) : null;
              const isFav = !!favorites[event.id];
              const dateCount = event.event_dates.length;
              const datePreview =
                dateCount > 1
                  ? `${formatDate(event.event_dates[0])} — ${formatDate(event.event_dates[dateCount - 1])} (${dateCount}N)`
                  : formatDate(event.event_dates[0]);

              return (
                <article
                  className="event-card"
                  key={event.id}
                  onClick={() => openEvent(event)}
                >
                  <div
                    className={`event-cover tone-${index % 6}`}
                    style={
                      event.hero_image_url
                        ? {
                            backgroundImage: `linear-gradient(0deg, #24131c99, transparent 60%), url("${event.hero_image_url}")`,
                          }
                        : undefined
                    }
                  >
                    <div className="cover-top-badges">
                      <span className="cover-label">NAVRATRI 2026</span>
                      <button
                        type="button"
                        className={`fav-button ${isFav ? "is-fav" : ""}`}
                        onClick={(e) => toggleFavorite(event.id, e)}
                        aria-label={isFav ? "Remove from saved" : "Save event"}
                      >
                        {isFav ? "♥" : "♡"}
                      </button>
                    </div>
                    <span className="cover-title">{event.name}</span>
                  </div>

                  <div className="event-body">
                    <div className="event-name-line">
                      <h3>{event.name}</h3>
                      <span className="rating">✦ {event.city}</span>
                    </div>

                    <p className="event-venue-preview">
                      <span className="venue-pin">📍</span> {event.venue_name}
                    </p>

                    <p className="event-meta">
                      📅 {datePreview}
                    </p>

                    <div className="event-foot">
                      <div className="price-box">
                        <span className="price">
                          {minPrice !== null
                            ? `${money(minPrice)} onwards`
                            : advertisedPrice !== null
                            ? `Ref. ${money(advertisedPrice)}`
                            : "Passes soon"}
                        </span>
                        <small className="price-sub">
                          {minPrice !== null
                            ? `${activeTickets.length} pass types`
                            : "Organizer allocation"}
                        </small>
                      </div>
                      <button
                        type="button"
                        className="book-small"
                        onClick={(click) => {
                          click.stopPropagation();
                          openEvent(event);
                        }}
                      >
                        {minPrice === null ? "View details" : "Book passes →"}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {visible.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">🔍</div>
              <h3>No events match your search</h3>
              <p>Try searching for a different artist name, venue, or clearing filters.</p>
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  setCity("All cities");
                  setQuery("");
                  setQuickFilter("All");
                }}
              >
                Reset all filters
              </button>
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="footer">
        <div className="page-width footer-content">
          <div>
            <a className="brand" href="#top">
              khelaiya<span>.</span>
            </a>
            <p>Made for the nights that bring us together. Authentic Garba & Navratri ticketing.</p>
          </div>
          <div className="footer-links">
            <span>Ahmedabad & Gandhinagar</span>
            <span>·</span>
            <a href="/admin">Admin Login</a>
            <span>·</span>
            <button
              type="button"
              className="text-btn"
              onClick={() => setMyPassesOpen(true)}
            >
              My Passes ({savedBookings.length})
            </button>
          </div>
        </div>
      </footer>

      {/* Booking Modal */}
      {active && (
        <div
          className="overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setActive(null);
          }}
        >
          <section
            className="booking-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`${active.name} booking`}
          >
            <div
              className="detail-cover"
              style={
                active.hero_image_url
                  ? {
                      backgroundImage: `linear-gradient(0deg, #24131c88, transparent 55%), url("${active.hero_image_url}")`,
                    }
                  : undefined
              }
            >
              <button
                type="button"
                className="modal-close-overlay"
                onClick={() => setActive(null)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            {bookingCode ? (
              /* Success Panel */
              <div className="success-panel">
                <div className="success-check">✓</div>
                <h2>Payment Reference Submitted!</h2>
                <p>
                  Your passes for <strong>{active.name}</strong> are currently <strong>pending manual UPI verification</strong>.
                  Our event team checks bank receipts regularly to verify UTR submissions.
                </p>

                <div className="booking-receipt-box">
                  <div className="receipt-row">
                    <span>Booking Reference</span>
                    <div className="code-copy-row">
                      <strong>{bookingCode}</strong>
                      <button
                        type="button"
                        className="copy-chip"
                        onClick={() => copyBookingCode(bookingCode)}
                      >
                        {copiedCode ? "✓ Copied" : "Copy"}
                      </button>
                    </div>
                  </div>
                  <div className="receipt-row">
                    <span>Night</span>
                    <strong>{formatDateLong(selectedDate)}</strong>
                  </div>
                  <div className="receipt-row">
                    <span>Passes</span>
                    <strong>{count} {count === 1 ? "pass" : "passes"}</strong>
                  </div>
                  <div className="receipt-row">
                    <span>Amount</span>
                    <strong>{money(amount)}</strong>
                  </div>
                  <div className="receipt-row">
                    <span>Status</span>
                    <span className="status pending">Pending Verification</span>
                  </div>
                </div>

                <div className="success-actions">
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => setActive(null)}
                  >
                    Back to Events
                  </button>
                  <button
                    type="button"
                    className="button secondary-btn"
                    onClick={() => {
                      setActive(null);
                      setMyPassesOpen(true);
                    }}
                  >
                    View in My Passes
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="modal-heading">
                  <div>
                    <h2>{active.name}</h2>
                    <p>📍 {active.venue_name} · {active.city}</p>
                  </div>
                  <button
                    type="button"
                    className="close-button"
                    onClick={() => setActive(null)}
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>

                <div className="modal-content">
                  {!checkout ? (
                    <>
                      {/* Step 1 & 2: Date & Passes */}
                      <div className="step-indicator">
                        <span className="step-active">01 &nbsp; DATE & PASSES</span>
                        <span>02 &nbsp; 20-MIN HOLD</span>
                        <span>03 &nbsp; UPI PAYMENT</span>
                      </div>

                      <div className="modal-section-title">
                        <strong>Choose your festival night</strong>
                        <span className="date-hint">({active.event_dates.length} available dates)</span>
                      </div>

                      <div className="date-list">
                        {active.event_dates.map((date) => (
                          <button
                            type="button"
                            key={date}
                            className={`date-choice ${selectedDate === date ? "selected" : ""}`}
                            onClick={() => setSelectedDate(date)}
                          >
                            <strong>{formatDate(date).split(",")[0]}</strong>
                            <span>{new Date(`${date}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                          </button>
                        ))}
                      </div>

                      <div className="event-info-box">
                        <p className="event-description">{active.event_description}</p>
                      </div>

                      <div className="modal-section-title" style={{ marginTop: "20px" }}>
                        <strong>Select vendor pass types</strong>
                        <span className="date-hint">Max 10 passes per order</span>
                      </div>

                      {tickets.length ? (
                        <div className="ticket-list">
                          {tickets.map((ticket) => (
                            <div className="ticket-row" key={ticket.id}>
                              <div className="ticket-info">
                                <strong>{ticket.pass_name}</strong>
                                <small>
                                  Authorized vendor: {ticket.vendor_name}
                                  {ticket.quantity_remaining <= 35 ? (
                                    <span className="stock-warning"> · Only {ticket.quantity_remaining} passes left</span>
                                  ) : (
                                    <span> · {ticket.quantity_remaining} passes available</span>
                                  )}
                                </small>
                              </div>
                              <b className="ticket-price">{money(ticket.price_inr)}</b>
                              <div className="stepper">
                                <button
                                  type="button"
                                  onClick={() => setQuantity(ticket, (quantities[ticket.id] || 0) - 1)}
                                  aria-label={`Remove ${ticket.pass_name}`}
                                >
                                  −
                                </button>
                                <span>{quantities[ticket.id] || 0}</span>
                                <button
                                  type="button"
                                  onClick={() => setQuantity(ticket, (quantities[ticket.id] || 0) + 1)}
                                  aria-label={`Add ${ticket.pass_name}`}
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="inventory-note">
                          Pass prices and allocations are currently being confirmed with the organizer. Check back soon.
                        </div>
                      )}

                      <div className="venue-copy">
                        <strong>About the venue</strong>
                        <p>{active.venue_description}</p>
                      </div>

                      {tickets.length === 0 && active.public_price_from && (
                        <p className="inventory-note">
                          Other public marketplace listings start from {money(Number(active.public_price_from))}. Khelaiya vendor pass types, prices, and quantities will appear here once authorized.
                        </p>
                      )}

                      {active.external_source_url && (
                        <p className="source-note">
                          Public event details are for reference.{" "}
                          <a href={active.external_source_url} target="_blank" rel="noreferrer">
                            View public listing ↗
                          </a>
                        </p>
                      )}

                      <div className="total-line">
                        <div>
                          <span>Total for {count} {count === 1 ? "pass" : "passes"}</span>
                          <small className="date-summary">{formatDateLong(selectedDate)}</small>
                        </div>
                        <strong>{money(amount)}</strong>
                      </div>

                      <button
                        type="button"
                        className="button primary full-width"
                        disabled={count === 0}
                        onClick={() => setCheckout(true)}
                      >
                        {count === 0 ? "Select passes to continue" : `Continue to Reservation (${money(amount)}) →`}
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Step 3: Reservation Hold & UPI Checkout */}
                      <button
                        type="button"
                        className="back-link"
                        onClick={() => setCheckout(false)}
                      >
                        ← Back to pass selection
                      </button>

                      <div className="step-indicator">
                        <span>01 &nbsp; DATE & PASSES</span>
                        <span className={!hold ? "step-active" : ""}>02 &nbsp; 20-MIN HOLD</span>
                        <span className={hold ? "step-active" : ""}>03 &nbsp; UPI PAYMENT</span>
                      </div>

                      {!hold ? (
                        <>
                          <h3 className="payment-title">
                            Reserve {count} {count === 1 ? "pass" : "passes"} for {formatDate(selectedDate)}
                          </h3>
                          <div className="lock-note">
                            <span className="lock-icon">🔒</span>
                            <span>
                              We atomically lock your passes for <strong>20 minutes</strong> while you complete payment. If not paid in 20 minutes, passes automatically return to inventory.
                            </span>
                          </div>

                          <form action={createHold} className="booking-form">
                            <label>
                              Full Name
                              <input
                                name="customerName"
                                required
                                minLength={2}
                                maxLength={100}
                                placeholder="Your name as on ID"
                                autoComplete="name"
                              />
                            </label>

                            <label>
                              Mobile Number (for pass SMS/WhatsApp)
                              <input
                                name="phone"
                                required
                                pattern="[0-9]{10}"
                                maxLength={10}
                                placeholder="10-digit mobile number"
                                inputMode="numeric"
                                autoComplete="tel"
                              />
                            </label>

                            {message && (
                              <div className="form-error" role="alert">
                                {message}
                              </div>
                            )}

                            <button
                              className="button primary full-width"
                              disabled={busy}
                            >
                              {busy ? "Locking inventory…" : "Lock passes & show UPI payment details →"}
                            </button>
                          </form>
                        </>
                      ) : (
                        <>
                          {/* Live 20-minute countdown banner */}
                          <div className={`countdown-bar ${secondsRemaining < 300 ? "urgent" : ""}`}>
                            <span className="timer-pulse">●</span>
                            <span>
                              Pass hold expires in <strong>{formatTimer(secondsRemaining)}</strong>. Complete UPI payment before timer runs out.
                            </span>
                          </div>

                          <h3 className="payment-title">Pay {money(amount)} via UPI</h3>

                          {(() => {
                            const pay = createManualUpiCheckout(active.name, amount);
                            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
                              pay.paymentUri,
                            )}`;

                            return (
                              <div className="upi-instructions-box">
                                <div className="upi-details-grid">
                                  <div>
                                    <small className="upi-sub">PAYEE NAME</small>
                                    <strong>{pay.payeeName}</strong>
                                    <div className="upi-vpa-row">
                                      <span className="upi-id-pill">{pay.upiId}</span>
                                      <button
                                        type="button"
                                        className="copy-btn"
                                        onClick={() => copyUpiText(pay.upiId)}
                                      >
                                        {copiedUpi ? "✓ Copied" : "Copy UPI ID"}
                                      </button>
                                    </div>
                                  </div>
                                  <div className="amount-col">
                                    <small className="upi-sub">EXACT AMOUNT</small>
                                    <span className="upi-amount">{money(pay.amountInr)}</span>
                                  </div>
                                </div>

                                <div className="upi-action-row">
                                  <a
                                    className="button upi-app-btn"
                                    href={pay.paymentUri}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    📱 Open in UPI App (GPay / PhonePe / Paytm) ↗
                                  </a>
                                  <button
                                    type="button"
                                    className="toggle-qr-btn"
                                    onClick={() => setShowQr(!showQr)}
                                  >
                                    {showQr ? "Hide QR Code" : "Show QR Code"}
                                  </button>
                                </div>

                                {showQr && (
                                  <div className="qr-container">
                                    <img
                                      src={qrUrl}
                                      alt="Scan to pay via UPI"
                                      width={180}
                                      height={180}
                                      className="qr-img"
                                    />
                                    <small>Scan using Google Pay, PhonePe, Paytm, or BHIM</small>
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                          <div className="utr-instructions">
                            <strong>Step 2: Enter transaction UTR reference</strong>
                            <p>
                              After transferring ₹{amount} in your UPI app, copy the 12-digit UTR or Transaction Reference from your payment receipt and enter it below.
                            </p>
                          </div>

                          <form action={submitBooking} className="booking-form">
                            <label>
                              UPI Reference Number / UTR
                              <input
                                name="upiReference"
                                required
                                minLength={6}
                                maxLength={64}
                                placeholder="e.g. 427189012345 (12-digit reference)"
                              />
                            </label>

                            {message && (
                              <div className="form-error" role="alert">
                                {message}
                              </div>
                            )}

                            <button
                              className="button primary full-width"
                              disabled={busy}
                            >
                              {busy ? "Submitting for verification…" : "I’ve Paid · Submit for Verification"}
                            </button>
                          </form>
                        </>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {/* My Passes Drawer / Modal */}
      {myPassesOpen && (
        <div
          className="overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMyPassesOpen(false);
          }}
        >
          <section className="booking-modal passes-drawer" role="dialog" aria-label="My Passes">
            <div className="modal-heading">
              <div>
                <h2>My Passes</h2>
                <p>Bookings made from this browser</p>
              </div>
              <button
                type="button"
                className="close-button"
                onClick={() => setMyPassesOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="modal-content">
              {savedBookings.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">🎟</div>
                  <h3>No passes booked yet</h3>
                  <p>When you reserve and submit a UPI payment, your booking reference will appear here.</p>
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => setMyPassesOpen(false)}
                  >
                    Browse Garba Events
                  </button>
                </div>
              ) : (
                <div className="passes-list">
                  {savedBookings.map((b) => (
                    <article className="pass-card" key={b.id}>
                      <div className="pass-card-head">
                        <div>
                          <strong>{b.eventName}</strong>
                          <small>📍 {b.venueName} · {b.city}</small>
                        </div>
                        <div className="pass-status-group">
                          <span className={`status ${b.status}`}>
                            {b.status === "verified"
                              ? "✓ Verified"
                              : b.status === "rejected"
                              ? "✕ Rejected"
                              : "⏳ Pending Verification"}
                          </span>
                          <button
                            type="button"
                            className="check-status-btn"
                            onClick={() => refreshPassStatus(b.bookingCode)}
                            disabled={checkingCode === b.bookingCode}
                          >
                            {checkingCode === b.bookingCode ? "Checking…" : "🔄 Check"}
                          </button>
                        </div>
                      </div>

                      {b.status === "verified" && (
                        <div className="verified-pass-banner">
                          <span>🎉 Pass Confirmed! Show this reference at the gate.</span>
                        </div>
                      )}

                      <div className="pass-details-row">
                        <div>
                          <small>NIGHT</small>
                          <span>{formatDate(b.eventDate)}</span>
                        </div>
                        <div>
                          <small>PASSES</small>
                          <span>{b.count} Passes</span>
                        </div>
                        <div>
                          <small>AMOUNT</small>
                          <strong>{money(b.totalInr)}</strong>
                        </div>
                      </div>

                      <div className="pass-ref-bar">
                        <span>Ref: <code>{b.bookingCode}</code></span>
                        <span>UTR: <code>{b.upiReference}</code></span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
