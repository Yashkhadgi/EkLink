import { auditContext, isUuid, json, jsonError, requireAdmin } from "@/lib/admin/session";
import { writeAuditLog } from "@/lib/security/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchPendingEvents } from "@/lib/sync/events";
import type { NextRequest } from "next/server";

// POST — failed deliveries of this app become due now, then a dispatch runs.
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request, { superOnly: true });
  if (guard.response) return guard.response;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(400, "invalid_id");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("event_deliveries")
    .update({ status: "pending", next_attempt_at: new Date().toISOString() })
    .eq("app_id", id)
    .eq("status", "failed")
    .select("id");
  if (error) return jsonError(500, "retry_failed");

  await writeAuditLog({
    ...auditContext(request, guard.actor),
    action: "sync_retry",
    target: id,
    details: { requeued: data?.length ?? 0 },
  });

  let results: Awaited<ReturnType<typeof dispatchPendingEvents>> = [];
  try {
    results = await dispatchPendingEvents();
  } catch (dispatchError) {
    return json({ requeued: data?.length ?? 0, dispatch_error: String(dispatchError) });
  }
  return json({ requeued: data?.length ?? 0, results });
}
