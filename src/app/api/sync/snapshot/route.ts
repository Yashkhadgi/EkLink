import { authenticateSyncClient, unauthorized } from "@/lib/sync/client-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NextRequest } from "next/server";

// GET /api/sync/snapshot (SYNC_CONTRACT.md 5.2): full current state, read in one
// database statement so last_event_id matches the data exactly.
export async function GET(request: NextRequest) {
  const app = await authenticateSyncClient(request);
  if (!app) return unauthorized();

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("sync_snapshot");
  if (error || !data) return Response.json({ error: "server_error" }, { status: 500 });

  return Response.json(data, { headers: { "cache-control": "no-store" } });
}
