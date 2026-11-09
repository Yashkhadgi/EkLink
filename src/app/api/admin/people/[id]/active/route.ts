import { loadPerson } from "@/lib/admin/people";
import { canManagePerson, inScope } from "@/lib/admin/scope";
import {
  auditContext,
  dispatchAfterResponse,
  isUuid,
  json,
  jsonError,
  readJson,
  requireAdmin,
} from "@/lib/admin/session";
import { setUserActive } from "@/lib/provisioning";
import type { NextRequest } from "next/server";
import { z } from "zod";

// POST { active: boolean } — deactivate / reactivate. Bumps token_version and, on
// deactivation, revokes the person's EkLink sessions (setUserActive).
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if (guard.response) return guard.response;
  const { actor } = guard;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(400, "invalid_id");

  const body = await readJson(request, z.object({ active: z.boolean() }));
  if (body.error) return body.error;

  const person = await loadPerson(id);
  if (!person || !inScope(actor, person)) return jsonError(404, "not_found");
  if (id === actor.id) return jsonError(403, "cannot_edit_self");
  if (!canManagePerson(actor, person)) return jsonError(403, "not_allowed");
  if (person.is_active === body.data.active) return json({ ok: true, is_active: person.is_active });

  try {
    await setUserActive(id, body.data.active, auditContext(request, actor));
  } catch (error) {
    return jsonError(500, "update_failed", { reason: error instanceof Error ? error.message : "error" });
  }
  dispatchAfterResponse();
  return json({ ok: true, is_active: body.data.active });
}
