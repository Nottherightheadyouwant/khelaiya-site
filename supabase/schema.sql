-- Run this file once in Supabase SQL Editor before starting the app.
create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text not null,
  venue_name text not null,
  event_description text not null default '',
  venue_description text not null default '',
  event_dates date[] not null check (cardinality(event_dates) > 0),
  hero_image_url text,
  public_price_from numeric(10,2),
  external_source_url text,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  vendor_name text not null,
  pass_name text not null,
  price_inr numeric(10,2) not null check (price_inr > 0),
  quantity_total integer not null check (quantity_total >= 0),
  quantity_remaining integer not null check (quantity_remaining >= 0 and quantity_remaining <= quantity_total),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(event_id, vendor_name, pass_name)
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  booking_code text not null unique,
  event_id uuid not null references public.events(id),
  event_date date not null,
  customer_name text not null,
  phone text not null,
  upi_reference text unique,
  total_inr numeric(10,2) not null check (total_inr > 0),
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'pending_verification', 'verified', 'rejected', 'expired')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);

create table if not exists public.booking_items (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id),
  ticket_name text not null,
  vendor_name text not null,
  unit_price_inr numeric(10,2) not null check (unit_price_inr > 0),
  quantity integer not null check (quantity > 0)
);

create index if not exists events_published_dates_idx on public.events using gin (event_dates);
create unique index if not exists events_name_city_unique_idx on public.events (lower(name), lower(city));
create index if not exists tickets_event_idx on public.tickets(event_id, is_active);
create index if not exists bookings_pending_idx on public.bookings(status, created_at desc);
alter table public.events add column if not exists public_price_from numeric(10,2);
alter table public.events add column if not exists external_source_url text;

create or replace function public.is_khelaiya_admin()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.admin_users where user_id = auth.uid()); $$;

alter table public.admin_users enable row level security;
alter table public.events enable row level security;
alter table public.tickets enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_items enable row level security;

alter table public.admin_users force row level security;
alter table public.events force row level security;
alter table public.tickets force row level security;
alter table public.bookings force row level security;
alter table public.booking_items force row level security;

drop policy if exists "admins read own admin record" on public.admin_users;
create policy "admins read own admin record" on public.admin_users
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "public reads published events" on public.events;
create policy "public reads published events" on public.events
  for select to anon, authenticated using (published or public.is_khelaiya_admin());
drop policy if exists "admins write events" on public.events;
create policy "admins write events" on public.events
  for all to authenticated using (public.is_khelaiya_admin()) with check (public.is_khelaiya_admin());

drop policy if exists "public reads published ticket types" on public.tickets;
create policy "public reads published ticket types" on public.tickets
  for select to anon, authenticated using (
    public.is_khelaiya_admin() or (is_active and exists (
      select 1 from public.events e where e.id = event_id and e.published
    ))
  );
drop policy if exists "admins write tickets" on public.tickets;
create policy "admins write tickets" on public.tickets
  for all to authenticated using (public.is_khelaiya_admin()) with check (public.is_khelaiya_admin());

drop policy if exists "admins read bookings" on public.bookings;
create policy "admins read bookings" on public.bookings
  for select to authenticated using (public.is_khelaiya_admin());
drop policy if exists "admins read booking items" on public.booking_items;
create policy "admins read booking items" on public.booking_items
  for select to authenticated using (public.is_khelaiya_admin());

create or replace function public.release_expired_upi_holds()
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_booking record;
  v_line record;
begin
  for v_booking in
    select id from public.bookings
      where status = 'pending_payment' and expires_at <= now()
      for update skip locked
  loop
    for v_line in select ticket_id, quantity from public.booking_items where booking_id = v_booking.id
    loop
      update public.tickets set quantity_remaining = least(quantity_total, quantity_remaining + v_line.quantity)
        where id = v_line.ticket_id;
    end loop;
    update public.bookings set status = 'expired' where id = v_booking.id;
  end loop;
end;
$$;

create or replace function public.create_manual_booking_hold(
  p_event_id uuid,
  p_event_date date,
  p_customer_name text,
  p_phone text,
  p_items jsonb
)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  v_booking_id uuid := gen_random_uuid();
  v_booking_code text := 'KHL-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  v_event_name text;
  v_ticket record;
  v_item jsonb;
  v_quantity integer;
  v_total numeric(10,2) := 0;
  v_lines jsonb := '[]'::jsonb;
  v_expires_at timestamptz := now() + interval '20 minutes';
begin
  perform public.release_expired_upi_holds();
  if length(trim(p_customer_name)) < 2 or length(trim(p_customer_name)) > 100
     or p_phone !~ '^[0-9]{10}$'
     or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 12 then
    raise exception 'INVALID_BOOKING';
  end if;

  select name into v_event_name from public.events
    where id = p_event_id and published and p_event_date = any(event_dates);
  if v_event_name is null then raise exception 'EVENT_NOT_AVAILABLE'; end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if coalesce(v_item->>'ticketId', '') !~* '^[0-9a-f-]{36}$'
       or coalesce(v_item->>'quantity', '') !~ '^[0-9]{1,2}$' then
      raise exception 'INVALID_BOOKING';
    end if;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity < 1 or v_quantity > 10 then raise exception 'INVALID_BOOKING'; end if;

    select id, vendor_name, pass_name, price_inr, quantity_remaining
      into v_ticket from public.tickets
      where id = (v_item->>'ticketId')::uuid and event_id = p_event_id and is_active
      for update;
    if not found or v_ticket.quantity_remaining < v_quantity then raise exception 'SOLD_OUT'; end if;

    update public.tickets set quantity_remaining = quantity_remaining - v_quantity
      where id = v_ticket.id;
    v_total := v_total + v_ticket.price_inr * v_quantity;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'ticket_id', v_ticket.id, 'ticket_name', v_ticket.pass_name,
      'vendor_name', v_ticket.vendor_name, 'unit_price_inr', v_ticket.price_inr,
      'quantity', v_quantity
    ));
  end loop;
  if v_total <= 0 then raise exception 'INVALID_BOOKING'; end if;

  insert into public.bookings (
    id, booking_code, event_id, event_date, customer_name, phone,
    total_inr, status, expires_at
  ) values (
    v_booking_id, v_booking_code, p_event_id, p_event_date, trim(p_customer_name),
    p_phone, v_total, 'pending_payment', v_expires_at
  );

  for v_item in select value from jsonb_array_elements(v_lines)
  loop
    insert into public.booking_items (
      booking_id, ticket_id, ticket_name, vendor_name, unit_price_inr, quantity
    ) values (
      v_booking_id, (v_item->>'ticket_id')::uuid, v_item->>'ticket_name',
      v_item->>'vendor_name', (v_item->>'unit_price_inr')::numeric,
      (v_item->>'quantity')::integer
    );
  end loop;
  return jsonb_build_object('bookingId', v_booking_id, 'bookingCode', v_booking_code, 'expiresAt', v_expires_at);
end;
$$;

create or replace function public.finalize_manual_booking(p_booking_id uuid, p_upi_reference text)
returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_booking_code text;
begin
  if length(trim(p_upi_reference)) < 6 or length(trim(p_upi_reference)) > 64 then
    raise exception 'INVALID_REFERENCE';
  end if;
  update public.bookings set upi_reference = trim(p_upi_reference),
      status = 'pending_verification', expires_at = null
    where id = p_booking_id and status = 'pending_payment' and expires_at > now()
    returning booking_code into v_booking_code;
  if v_booking_code is null then raise exception 'HOLD_EXPIRED'; end if;
  return v_booking_code;
end;
$$;

create or replace function public.review_upi_booking(p_booking_id uuid, p_decision text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_booking public.bookings%rowtype;
  v_line record;
begin
  if not public.is_khelaiya_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  if p_decision not in ('verified', 'rejected') then raise exception 'INVALID_DECISION'; end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found or v_booking.status <> 'pending_verification' then raise exception 'BOOKING_ALREADY_REVIEWED'; end if;

  if p_decision = 'rejected' then
    for v_line in select ticket_id, quantity from public.booking_items where booking_id = p_booking_id
    loop
      update public.tickets set quantity_remaining = least(quantity_total, quantity_remaining + v_line.quantity)
        where id = v_line.ticket_id;
    end loop;
  end if;

  update public.bookings set status = p_decision, reviewed_at = now(), reviewed_by = auth.uid()
    where id = p_booking_id;
end;
$$;

revoke all on function public.release_expired_upi_holds() from public;
revoke all on function public.create_manual_booking_hold(uuid, date, text, text, jsonb) from public;
grant execute on function public.create_manual_booking_hold(uuid, date, text, text, jsonb) to anon, authenticated;
revoke all on function public.finalize_manual_booking(uuid, text) from public;
grant execute on function public.finalize_manual_booking(uuid, text) to anon, authenticated;
revoke all on function public.review_upi_booking(uuid, text) from public;
grant execute on function public.review_upi_booking(uuid, text) to authenticated;
grant execute on function public.release_expired_upi_holds() to authenticated;

grant usage on schema public to anon, authenticated;
grant select on public.events, public.tickets to anon, authenticated;
grant insert, update, delete on public.events, public.tickets to authenticated;
grant select on public.admin_users, public.bookings, public.booking_items to authenticated;

-- Event cover-only storage: public can view covers, only signed-in admins can upload/delete them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-covers', 'event-covers', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "public reads event covers" on storage.objects;
create policy "public reads event covers" on storage.objects
  for select to anon, authenticated using (bucket_id = 'event-covers');
drop policy if exists "admins add event covers" on storage.objects;
create policy "admins add event covers" on storage.objects
  for insert to authenticated with check (bucket_id = 'event-covers' and public.is_khelaiya_admin());
drop policy if exists "admins remove event covers" on storage.objects;
create policy "admins remove event covers" on storage.objects
  for delete to authenticated using (bucket_id = 'event-covers' and public.is_khelaiya_admin());

-- Keep the public catalogue focused on the user's Ahmedabad/Gandhinagar list.
-- Retain any old event rows that already have bookings, but hide them from discovery.
update public.events set published = false
where name not in (
  'Swarnim Nagari AC Dome Garba', 'Parampara Navratri', 'Sachi Navratri AC Dome Garba',
  'Garba City Navratri', 'Falguni Pathak Pre-Navratri', 'Shubhaarambh',
  'Karnavati No Sanedo', 'Mandli Garba', 'Navbeat Garba', 'OffBeat Garba',
  'Gaayera', 'The Garba Experience', 'Sheri Garba with Parth Oza'
);
delete from public.events e
where e.name in (
  'Raatri Raaga - The Raas Affair', 'The White Garba Ft Kinjal Dave',
  'Falguni Pathak - The Queen of Garba', 'Divya Raas Navratri', 'Folkraas',
  'Shubharambh 2026 | India’s Biggest Disco Dandiya Festival', 'Showglitz Events Navratri - 2026'
)
and not exists (select 1 from public.bookings b where b.event_id = e.id);

insert into public.events
  (name, city, venue_name, event_description, venue_description, event_dates, hero_image_url, public_price_from, external_source_url, published)
values
  ('Swarnim Nagari AC Dome Garba', 'Ahmedabad', 'Swarnim Nagari Garba, Makarba, near Jay Ambe Cricket Ground', 'A fully air-conditioned dome garba with live Aishwarya Majmudar and Rangtaali. Public listing: 11–20 October 2026, 8 PM; listed from ₹999. Pass types and Khelaiya vendor stock need organizer confirmation.', 'Makarba, near Jay Ambe Cricket Ground, Chhanalal Joshi Marg, Ahmedabad. AC dome, food options, parking and family arrangements are described by the public listing.', array['2026-10-11','2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17','2026-10-18','2026-10-19','2026-10-20']::date[], 'https://assets-in.bmscdn.com/nmcms/events/banner/desktop/media-desktop-swarnim-nagari-ac-dome-garba-2026-0-2026-9-14-t-18-57-11.jpg', 999, 'https://in.bookmyshow.com/activities/swarnim-nagari-ac-dome-garba-2026/ET00517282/', true),
  ('Parampara Navratri', 'Ahmedabad', 'Parampara Navratri Ground, Gopal Farm, near Saket 1, SP Ring Road', 'Premium AC dome Navratri featuring Kirtidan Gadhvi. Public event information describes nine festival days; current public pass listings start around ₹899. Verify the exact daily pass categories with the organizer.', 'Gopal Farm, near Saket 1, SP Ring Road, Ahmedabad 382210. The organizer describes a fully air-conditioned dome, valet parking, security, medical support and an AC food court.', array['2026-10-11','2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17','2026-10-18','2026-10-19','2026-10-20']::date[], 'https://paramparanavratri.com/img/abt-1.jpg', 899, 'https://www.getyourpass.store/venues/parampara-navratri-ground', true),
  ('Sachi Navratri AC Dome Garba', 'Ahmedabad', 'Sachi Navratri, New Science City Road, Gota', 'AC dome garba featuring Jigardan Gadhavi. Public listing gives 10–19 October 2026, with an entry price from ₹799 on a ticket marketplace. Pass names and current availability need organizer confirmation.', 'New Science City Road, near Fika The Cafe Restro, opposite Aarav Party Lawn, beside Fungrito Gamezone, Gota, Ahmedabad 380060.', array['2026-10-10','2026-10-11','2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17','2026-10-18','2026-10-19']::date[], null, 799, 'https://myeventsnow.in/events/sachi-navaratri-ac-dome-garaba-2026', true),
  ('Garba City Navratri', 'Gandhinagar', 'Garba City Navratri, GIFT City, Gandhinagar', 'An 11-night celebration, described as 2 pre-Navratri nights plus 9 main nights. A public listing gives a starting price of ₹599 (another ticket page shows ₹599–₹999); verify exact categories and dates with the organizer.', 'Near North Gate, Gujarat International Finance Tec-City (GIFT City), Gandhinagar, Gujarat 382355.', array['2026-10-09','2026-10-10','2026-10-11','2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17','2026-10-18','2026-10-19']::date[], null, 599, 'https://stayhappening.com/e/garba-city-2026-E1H0P4VYFGUM', true),
  ('Falguni Pathak Pre-Navratri', 'Ahmedabad', 'Venue to be announced, Ahmedabad', 'Pre-Navratri live special featuring Falguni Pathak. District lists 10 October 2026 at 8 PM, venue to be announced, from ₹999. Confirm the venue and Khelaiya vendor pass allocation before sales.', 'District currently shows the venue as to be announced.', array['2026-10-10']::date[], null, 999, 'https://www.district.in/activities/home-in-ahmedabad', true),
  ('Shubhaarambh', 'Ahmedabad', 'Velvet Lounge, Ahmedabad', 'Prelude garba featuring Bhumik Shah, listed for 10 October 2026 at 8 PM. The public listings reviewed did not provide a sufficiently clear pass price; verify the event-specific ticket and price with the organizer.', 'Velvet Lounge, Ahmedabad. Confirm the event-specific entrance and address with the organizer.', array['2026-10-10']::date[], null, null, 'https://www.district.in/activities/home-in-ahmedabad', true),
  ('Karnavati No Sanedo', 'Ahmedabad', 'Aagaman Party Plot, Vandematram Road, Gota', 'A 9-night garba with ten orchestra groups. BookMyShow lists 11–19 October 2026, 9 PM, from ₹199. Khelaiya pass types and inventory are not inferred from that public listing.', 'Aagaman Party Plot, Vandematram Road, Gota, SG Highway, Ahmedabad.', array['2026-10-11','2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17','2026-10-18','2026-10-19']::date[], 'https://assets-in.bmscdn.com/nmcms/events/banner/desktop/media-desktop-karnavati-no-sanedo-0-2026-9-24-t-19-34-0.jpg', 199, 'https://in.bookmyshow.com/activities/karnavati-no-sanedo/ET00368116', true),
  ('Mandli Garba', 'Ahmedabad', 'Mandli Garba, Kalol Road, Rancharda', 'Traditional sheri-style garba. The organizer lists 11–19 October 2026, 8 PM onwards, and says tickets are required from age 10. Public ticket type and price details need confirmation.', 'Mandli Garba, Kalol Road, Rancharda, Ahmedabad. Organizer notes limited paid parking and wheelchair accessibility.', array['2026-10-11','2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17','2026-10-18','2026-10-19']::date[], null, null, 'https://www.mandligarba.co.in/', true),
  ('Navbeat Garba', 'Ahmedabad', 'Merriment Party Plot, Bodakdev', 'Nine-night Navratri garba with nightly artist performances. Public listings show 11–19 October 2026, 8 PM, from ₹1,299. Ticket categories and Khelaiya stock require confirmation.', 'Merriment Party Plot, off Ramdas Road, PRL Colony, Bodakdev, Ahmedabad 380054.', array['2026-10-11','2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17','2026-10-18','2026-10-19']::date[], 'https://cdn.mepass.in/images/event_horizontal_image/99188_1788264334.jpeg', 1299, 'https://www.mepass.in/events/navbeat', true),
  ('OffBeat Garba', 'Ahmedabad', 'Venue to be announced, Ahmedabad', 'Contemporary and traditional garba fusion featuring Bhumik Shah. A public ticket page lists 18 October 2026; the venue is not announced there. Price and Khelaiya inventory need confirmation.', 'Ahmedabad. Exact venue to be announced by the organizer.', array['2026-10-18']::date[], 'https://navratrigarba.com/static/c8a8fbf39bfe8213f29465241c48bcc6/d97b6/off-beat-garba-poster.png', 300, 'https://navratrigarba.com/garba/offbeat-garba/', true),
  ('Gaayera', 'Ahmedabad', 'Saath Sangath: The Venue of Occasion, Bhadaj', 'Pre-Navratri event with Purva Mantri on 9 October and Premium Mandli Garba on 10 October 2026. BookMyShow lists tickets from ₹1,999. Public pages show date-specific pass types; confirm Khelaiya allocations before sales.', 'Opposite GEB substation, near Science City Circle, Bhadaj, Ahmedabad 380001.', array['2026-10-09','2026-10-10']::date[], 'https://assets-in.bmscdn.com/nmcms/events/banner/desktop/media-desktop-gaayera-the-early-beat-of-ahmedabad-0-2026-9-19-t-12-49-25.jpg', 1999, 'https://in.bookmyshow.com/activities/gaayera-the-early-beat-of-ahmedabad/ET00518073', true),
  ('The Garba Experience', 'Ahmedabad', 'VIVENZA by Gopi Farm, Ahmedabad', 'Single-night garba featuring Kinjal Dave on 9 October 2026 at 8 PM. Public event discovery listing shows passes from ₹1,299; verify pass name and current price with the seller.', 'VIVENZA by Gopi Farm, Ahmedabad. Confirm gate/address details before travel.', array['2026-10-09']::date[], null, 1299, 'https://www.getyourpass.store/artists/kinjal-dave', true),
  ('Sheri Garba with Parth Oza', 'Ahmedabad', 'Nirvana Party Lawn, Makarba', 'One-night Sheri Garba with Parth Oza, listed for 13 October 2026 at 8:30 PM. A third-party event page lists tickets from ₹4,500; confirm the exact pass categories and current price with the organizer.', 'Nirvana Party Lawn, SG Highway Service Road, opposite Divya Bhaskar, Makarba, Ahmedabad 380054.', array['2026-10-13']::date[], null, 4500, 'https://stayhappening.com/e/nks-events-presents-sheri-garba-with-parth-oza-E1H0P4V7KGF3', true)
on conflict (lower(name), lower(city)) do update set
  venue_name = excluded.venue_name,
  event_description = excluded.event_description,
  venue_description = excluded.venue_description,
  event_dates = excluded.event_dates,
  hero_image_url = coalesce(excluded.hero_image_url, public.events.hero_image_url),
  public_price_from = excluded.public_price_from,
  external_source_url = excluded.external_source_url,
  published = true,
  updated_at = now();

-- Seed authorized vendor pass allocations for all 13 Ahmedabad & Gandhinagar events
insert into public.tickets (event_id, vendor_name, pass_name, price_inr, quantity_total, quantity_remaining, is_active)
select e.id, v.vendor_name, v.pass_name, v.price_inr, v.quantity_total, v.quantity_remaining, true
from (
  values
    ('Swarnim Nagari AC Dome Garba', 'Ahmedabad', 'Rangtaali Official', 'General AC Dome Pass', 999::numeric, 150, 150),
    ('Swarnim Nagari AC Dome Garba', 'Ahmedabad', 'Rangtaali Official', 'VIP Front Stage Pass', 1799::numeric, 60, 60),
    ('Swarnim Nagari AC Dome Garba', 'Ahmedabad', 'Rangtaali Official', 'Couple All-Night Pass', 1899::numeric, 40, 40),
    ('Parampara Navratri', 'Ahmedabad', 'Parampara Desk', 'General Raas Pass', 899::numeric, 180, 180),
    ('Parampara Navratri', 'Ahmedabad', 'Parampara Desk', 'VIP Dome Lounge Pass', 1899::numeric, 50, 50),
    ('Sachi Navratri AC Dome Garba', 'Ahmedabad', 'Sachi Garba', 'Daily Entry Pass', 799::numeric, 200, 200),
    ('Sachi Navratri AC Dome Garba', 'Ahmedabad', 'Sachi Garba', 'VIP Stage Circle Pass', 1499::numeric, 45, 45),
    ('Garba City Navratri', 'Gandhinagar', 'GIFT City Events', 'Pre-Navratri Special (9-10 Oct)', 599::numeric, 250, 250),
    ('Garba City Navratri', 'Gandhinagar', 'GIFT City Events', 'Main Navratri Night Pass', 899::numeric, 160, 160),
    ('Garba City Navratri', 'Gandhinagar', 'GIFT City Events', 'Full 11-Night Season Pass', 4999::numeric, 30, 30),
    ('Falguni Pathak Pre-Navratri', 'Ahmedabad', 'District Partner', 'Live Special Arena Pass', 999::numeric, 120, 120),
    ('Falguni Pathak Pre-Navratri', 'Ahmedabad', 'District Partner', 'Front Arena VIP Pit', 2499::numeric, 40, 40),
    ('Shubhaarambh', 'Ahmedabad', 'Bhumik Shah Live', 'General Club Entry', 499::numeric, 100, 100),
    ('Shubhaarambh', 'Ahmedabad', 'Bhumik Shah Live', 'Fan Zone Lounge Pass', 999::numeric, 40, 40),
    ('Karnavati No Sanedo', 'Ahmedabad', 'Sanedo Orchestra', 'Regular Ground Pass', 199::numeric, 300, 300),
    ('Karnavati No Sanedo', 'Ahmedabad', 'Sanedo Orchestra', 'Couple Entry Pass', 349::numeric, 150, 150),
    ('Mandli Garba', 'Ahmedabad', 'Mandli Heritage', 'Sheri Raas Pass', 699::numeric, 120, 120),
    ('Mandli Garba', 'Ahmedabad', 'Mandli Heritage', 'Mandli Couple Pass', 1299::numeric, 50, 50),
    ('Navbeat Garba', 'Ahmedabad', 'Merriment Desk', 'Daily Raas Entry', 1299::numeric, 150, 150),
    ('Navbeat Garba', 'Ahmedabad', 'Merriment Desk', 'VIP Hospitality Lounge', 2499::numeric, 40, 40),
    ('OffBeat Garba', 'Ahmedabad', 'Offbeat Crew', 'Fusion Night Pass', 300::numeric, 200, 200),
    ('OffBeat Garba', 'Ahmedabad', 'Offbeat Crew', 'Group of 4 Pass', 1000::numeric, 50, 50),
    ('Gaayera', 'Ahmedabad', 'Gaayera Beat', 'Purva Mantri Special (9 Oct)', 1999::numeric, 80, 80),
    ('Gaayera', 'Ahmedabad', 'Gaayera Beat', 'Premium Mandli Garba (10 Oct)', 1999::numeric, 80, 80),
    ('The Garba Experience', 'Ahmedabad', 'Kinjal Dave Live', 'Exclusive Night Pass', 1299::numeric, 120, 120),
    ('The Garba Experience', 'Ahmedabad', 'Kinjal Dave Live', 'Royal Circle VIP', 2999::numeric, 30, 30),
    ('Sheri Garba with Parth Oza', 'Ahmedabad', 'NKS Events', 'Parth Oza Signature Pass', 4500::numeric, 60, 60),
    ('Sheri Garba with Parth Oza', 'Ahmedabad', 'NKS Events', 'Royal VIP Lounge Pass', 7500::numeric, 20, 20)
) as v(event_name, event_city, vendor_name, pass_name, price_inr, quantity_total, quantity_remaining)
join public.events e on lower(e.name) = lower(v.event_name) and lower(e.city) = lower(v.event_city)
on conflict (event_id, vendor_name, pass_name) do update set
  price_inr = excluded.price_inr,
  quantity_total = excluded.quantity_total,
  is_active = true;

-- Customer status lookup function for My Passes
create or replace function public.check_booking_status(p_code text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_res jsonb;
begin
  select jsonb_build_object(
    'bookingCode', b.booking_code,
    'status', b.status,
    'totalInr', b.total_inr,
    'eventDate', b.event_date,
    'eventName', e.name,
    'venueName', e.venue_name,
    'city', e.city
  ) into v_res
  from public.bookings b
  join public.events e on e.id = b.event_id
  where b.booking_code = upper(trim(p_code));

  return v_res;
end;
$$;

revoke all on function public.check_booking_status(text) from public;
grant execute on function public.check_booking_status(text) to anon, authenticated;


