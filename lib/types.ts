export type Ticket = {
  id: string;
  event_id: string;
  vendor_name: string;
  pass_name: string;
  price_inr: number;
  quantity_total: number;
  quantity_remaining: number;
  is_active: boolean;
};

export type Event = {
  id: string;
  name: string;
  city: string;
  venue_name: string;
  venue_description: string;
  event_description: string;
  event_dates: string[];
  hero_image_url: string | null;
  public_price_from: number | null;
  external_source_url: string | null;
  published: boolean;
  tickets: Ticket[];
};

export type Booking = {
  id: string;
  booking_code: string;
  customer_name: string;
  phone: string;
  upi_reference: string;
  status: "pending_payment" | "pending_verification" | "verified" | "rejected" | "expired";
  total_inr: number;
  event_date: string;
  created_at: string;
  event: { name: string } | null;
};
