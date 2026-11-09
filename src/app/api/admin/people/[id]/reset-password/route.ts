import { loadPerson } from "@/lib/admin/people";
import { canManagePerson, inScope } from "@/lib/admin/scope";
import { auditContext, isUuid, json, jsonError, requireAdmin } from "@/lib/admin/session";
import { resetTempPassword } from "@/lib/provisioning";
import type { NextRequest } from "next/server";

// POST — new temporary password (shown once), must change at next login, sessions revoked.
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if (guard.response) return guard.response;
  const { actor } = guard;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(400, "invalid_id");

  const person = await loadPerson(id);
  if (!person || !inScope(actor, person)) return jsonError(404, "not_found");
  if (id === actor.id) return jsonError(403, "cannot_edit_self");
  if (!canManagePerson(actor, person)) return jsonError(403, "not_allowed");

  try {
    const result = await resetTempPassword(id, auditContext(request, actor));
    return json({ temporary_password: result.temporaryPassword });
  } catch (error) {
    return jsonError(500, "reset_failed", { reason: error instanceof Error ? error.message : "error" });
  }
}
