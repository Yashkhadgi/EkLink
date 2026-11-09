import { canManageApproverScope, type ScopeLevel } from "@/lib/admin/scope";
import {
  auditContext,
  dispatchAfterResponse,
  isUuid,
  json,
  jsonError,
  readJson,
  requireAdmin,
  today,
} from "@/lib/admin/session";
import { writeAuditLog } from "@/lib/security/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NextRequest } from "next/server";
import { z } from "zod";

function dayBefore(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

// POST { valid_to? } — ends a job (never deleted). valid_to is the job's last day;
// by default yesterday, so the job stops counting as "current" right away.
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if (guard.response) return guard.response;
  const { actor } = guard;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(400, "invalid_id");

  const body = await readJson(
    request,
    z.object({ valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  );
  if (body.error) return body.error;

  const admin = createAdminClient();
  const { data: job } = (await admin
    .from("approver_assignments")
    .select("id, title, scope_level, valid_from, valid_to, organization_id, institute_id, department_id")
    .eq("id", id)
    .maybeSingle()) as {
    data: {
      id: string;
      title: string;
      scope_level: ScopeLevel;
      valid_from: string;
      valid_to: string | null;
      organization_id: string;
      institute_id: string | null;
      department_id: string | null;
    } | null;
  };
  if (!job) return jsonError(404, "not_found");
  if (!canManageApproverScope(actor, job.scope_level, job)) return jsonError(403, "not_allowed");

  const now = today();
  if (job.valid_to !== null && job.valid_to < now) return jsonError(409, "already_ended");

  const earliest = dayBefore(job.valid_from);
  let validTo = body.data.valid_to ?? dayBefore(now);
  if (validTo < earliest) validTo = earliest;

  const { error } = await admin.from("approver_assignments").update({ valid_to: validTo }).eq("id", id);
  if (error) return jsonError(400, "end_failed", { reason: error.code ?? "error" });

  await writeAuditLog({
    ...auditContext(request, actor),
    action: "approver_ended",
    target: id,
    details: { title: job.title, valid_to: validTo },
  });
  dispatchAfterResponse();
  return json({ ok: true, valid_to: validTo });
}
