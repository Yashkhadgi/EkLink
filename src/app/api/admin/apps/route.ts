import { json, jsonError, requireAdmin } from "@/lib/admin/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NextRequest } from "next/server";

type AppRow = {
  id: string;
  slug: string;
  name: string;
  client_id: string;
  is_active: boolean;
  status: string;
  sync_url: string | null;
  allowed_roles: string[];
  allowed_platform_roles: string[] | null;
};

// GET — registered apps with their push delivery status (super admin only).
export async function GET(request: NextRequest) {
  const guard = await requireAdmin(request, { superOnly: true });
  if (guard.response) return guard.response;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("apps")
    .select("id, slug, name, client_id, is_active, status, sync_url, allowed_roles, allowed_platform_roles")
    .order("name");
  if (error) return jsonError(500, "apps_query_failed");

  const countOf = async (appId: string, status: string) => {
    const { count } = await admin
      .from("event_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("app_id", appId)
      .eq("status", status);
    return count ?? 0;
  };

  const head = await admin.from("change_events").select("id").order("id", { ascending: false }).limit(1);

  const apps = await Promise.all(
    ((data ?? []) as AppRow[]).map(async (app) => {
      const [pending, failed, delivered, lastFailure, lastDelivery] = await Promise.all([
        countOf(app.id, "pending"),
        countOf(app.id, "failed"),
        countOf(app.id, "delivered"),
        admin
          .from("event_deliveries")
          .select("event_id, attempts, last_error, next_attempt_at")
          .eq("app_id", app.id)
          .eq("status", "failed")
          .order("event_id", { ascending: true })
          .limit(1),
        admin
          .from("event_deliveries")
          .select("event_id, delivered_at")
          .eq("app_id", app.id)
          .eq("status", "delivered")
          .order("event_id", { ascending: false })
          .limit(1),
      ]);
      return {
        ...app,
        counts: { pending, failed, delivered },
        oldest_failure: lastFailure.data?.[0] ?? null,
        last_delivery: lastDelivery.data?.[0] ?? null,
      };
    }),
  );

  return json({ apps, last_event_id: Number(head.data?.[0]?.id ?? 0) });
}
