import { EventsExplorer } from "@/app/components/EventsExplorer";
import type { Event } from "@/lib/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SEED_EVENTS } from "@/lib/seedData";

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  let events: Event[] = [];
  let isSupabaseLive = false;

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("events")
        .select("*, tickets(*)")
        .eq("published", true)
        .order("created_at", { ascending: false });

      if (!error && data && data.length > 0) {
        events = (data as unknown as Event[]).map((event) => ({
          ...event,
          tickets: (event.tickets || []).filter((ticket) => ticket.is_active),
        }));
        isSupabaseLive = true;
      }
    } catch {
      // Fallback to seed events if connection fails
    }
  }

  if (events.length === 0) {
    events = SEED_EVENTS;
  }

  return (
    <EventsExplorer
      events={events}
      isSupabaseConfigured={isSupabaseLive}
    />
  );
}
