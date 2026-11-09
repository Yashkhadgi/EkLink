import { authenticateSyncClient, unauthorized } from "@/lib/sync/client-auth";
import { toSyncEvent } from "@/lib/sync/events";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NextRequest } from "next/server";

// GET /api/sync/changes?after=<last_event_id>&limit=500 (SYNC_CONTRACT.md 5.2)
export async function GET(request: NextRequest) {
  const app = await authenticateSyncClient(request);
  if (!app) return unauthorized();

  const params = request.nextUrl.searchParams;
  const afterRaw = params.get("after") ?? "0";
  const limitRaw = params.get("limit") ?? "500";
  if (!/^\d{1,18}$/.test(afterRaw) || !/^\d{1,4}$/.test(limitRaw)) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const after = Number(afterRaw);
  const limit = Math.min(Math.max(Number(limitRaw), 1), 500);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("change_events")
    .select("id, type, at, data")
    .gt("id", after)
    .order("id", { ascending: true })
    .limit(limit + 1);
  if (error) return Response.json({ error: "server_error" }, { status: 500 });

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const events = rows.slice(0, limit).map(toSyncEvent);
  // Nothing new: echo `after` (never report an id the caller has not received).
  const lastEventId = events.length ? events[events.length - 1].id : after;

  return Response.json(
    { events, last_event_id: lastEventId, has_more: hasMore },
    { headers: { "cache-control": "no-store" } },
  );
}
