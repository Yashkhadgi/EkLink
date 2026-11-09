import { loadPerson } from "@/lib/admin/people";
import {
  auditContext,
  dispatchAfterResponse,
  isUuid,
  json,
  jsonError,
  readJson,
  requireAdmin,
} from "@/lib/admin/session";
import { writeAuditLog } from "@/lib/security/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NextRequest } from "next/server";
import { z } from "zod";

// POST { login_id } — super admin only; goes through public.rename_login_id(), which
// emits person.login_id_changed so the apps re-key their records.
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request, { superOnly: true });
  if (guard.response) return guard.response;
  const { actor } = guard;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(400, "invalid_id");

  const body = await readJson(request, z.object({ login_id: z.string().trim().min(1).max(128) }));
  if (body.error) return body.error;

  const person = await loadPerson(id);
  if (!person) return jsonError(404, "not_found");
  if (person.login_id === body.data.login_id) return json({ ok: true, login_id: person.login_id });

  const admin = createAdminClient();
  const { error } = await admin.rpc("rename_login_id", { p_sub: id, p_new: body.data.login_id });
  if (error) {
    if (error.code === "23505") return jsonError(409, "login_id_in_use");
    return jsonError(400, "rename_failed", { reason: error.code ?? "error" });
  }

  await writeAuditLog({
    ...auditContext(request, actor),
    action: "login_id_renamed",
    target: id,
    details: { old_login_id: person.login_id, new_login_id: body.data.login_id },
  });
  dispatchAfterResponse();
  return json({ ok: true, login_id: body.data.login_id });
}
