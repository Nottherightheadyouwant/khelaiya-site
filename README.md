# Khelaiya Events

Full-stack event discovery and ticket-booking app built with Next.js and Supabase.

## What it does

- Public event listings with search and city filters.
- Event details, event dates, vendor pass prices, and live remaining inventory.
- Quantity selection and a 20-minute, transaction-safe pass hold.
- Manual UPI checkout with a UTR submission and booking reference.
- Admin sign-in, event and vendor-pass management, cover-image upload, and booking review.
- Rejecting an unverified payment returns reserved passes to inventory.

The event artwork field is a single event cover/hero image. There is no event photo gallery.

## Run locally

This app needs a Supabase project. Events and bookings are no longer stored in browser local storage.

1. Create a Supabase project.
2. In **SQL Editor**, run [`supabase/schema.sql`](supabase/schema.sql). It creates the tables, row-level security policies, inventory and payment functions, event-cover storage, and the 13 Ahmedabad/Gandhinagar events in the current catalogue. If you already ran an earlier version of this schema, run it again to apply the catalogue update. Older demo listings are unpublished; old rows with bookings are retained for booking history. Public “from” prices link to third-party event pages for reference only. They are not Khelaiya ticket inventory. Add your actual vendor pass types, prices, and available quantities in Admin before enabling sales.
3. In Supabase **Authentication → Users**, create the first admin user with an email and password. Then run this query in SQL Editor with that email:

   ```sql
   insert into public.admin_users (user_id)
   select id from auth.users where email = 'admin@example.com'
   on conflict (user_id) do nothing;
   ```

4. Copy `.env.example` to `.env.local` and enter the project URL, publishable/anon key, and your business UPI VPA. Set `NEXT_PUBLIC_SITE_URL` to the local URL for development.
5. Install dependencies and start the site:

   ```bash
   npm install
   npm run dev
   ```

6. Open `http://localhost:3000`. The admin panel is at `/admin`.

Do not put a Supabase service-role key in this app. Admin actions use the signed-in user session and database policies.

## Deploy

Deploy this as a Node.js Next.js app (Vercel works). Add the same `NEXT_PUBLIC_*` settings in the hosting provider’s environment variables, set `NEXT_PUBLIC_SITE_URL` to the real HTTPS domain, and add that domain to Supabase Auth’s allowed redirect/site URL settings. The database and image bucket stay in Supabase.

## Manual UPI boundary

The UPI flow opens a payment app, reserves the selected ticket quantity, collects a UTR, and queues the booking for an admin. The admin must match the UTR in the receiving account and mark it verified. This app never treats a customer-submitted UTR as proof of payment. `lib/payment.ts` is the checkout adapter boundary for a future Razorpay implementation; the rest of the event and booking records are gateway-independent.

Before going live, use the real business UPI ID, confirm event details with organizers, upload official event artwork where a listing has no cover, and enter your actual vendor pass prices and quantities. Public event details can change. Ticket inventory is deliberately not copied because third-party listings do not provide Khelaiya’s vendor stock allocations. The event cover image is a single hero image; it is not a photo gallery.
