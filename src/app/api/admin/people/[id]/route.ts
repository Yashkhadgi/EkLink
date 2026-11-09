import { loadPerson, presentPerson } from "@/lib/admin/people";
import { resolvePlacement } from "@/lib/admin/placement";
import {
  LEGACY_ROLES,
  MEMBER_TYPES,
  PLATFORM_ROLES,
  assignableRoles,
  canAssignRole,
  canManagePerson,
  inScope,
} from "@/lib/admin/scope";
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

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if (guard.response) return guard.response;
  const { actor } = guard;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(400, "invalid_id");

  const person = await loadPerson(id);
  if (!person || !inScope(actor, person)) return jsonError(404, "not_found");

  const admin = createAdminClient();
  const { data: jobs } = await admin
    .from("approver_assignments")
    .select("id, title, scope_level, scope_key, valid_from, valid_to")
    .eq("profile_id", id)
    .order("valid_from", { ascending: false });

  const now = today();
  return json({
    person: presentPerson(person, actor),
    jobs: (jobs ?? []).map((job) => ({
      ...job,
      is_current: job.valid_from <= now && (job.valid_to === null || job.valid_to >= now),
    })),
    assignable_roles: assignableRoles(actor.platform_role),
  });
}

const optionalText = (max: number, pattern?: RegExp) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? undefined : value || null))
    .refine((value) => !pattern || value == null || pattern.test(value), { message: "invalid format" });

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(256).optional(),
    role: z.enum(LEGACY_ROLES).optional(),
    platform_role: z.enum(PLATFORM_ROLES).optional(),
    member_type: z.enum(MEMBER_TYPES).nullable().optional(),
    organization_id: z.string().uuid().nullable().optional(),
    institute_id: z.string().uuid().nullable().optional(),
    department_id: z.string().uuid().nullable().optional(),
    batch: optionalText(7, /^\d{4}-\d{2}$/),
    section: z
      .string()
      .trim()
      .toUpperCase()
      .max(1)
      .nullable()
      .optional()
      .transform((value) => (value === undefined ? undefined : value || null))
      .refine((value) => value == null || /^[A-Z]$/.test(value), { message: "invalid format" }),
    semester: z.number().int().min(1).max(12).nullable().optional(),
    designation: optionalText(128),
    is_demo: z.boolean().optional(),
  })
  .strict();

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if (guard.response) return guard.response;
  const { actor } = guard;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(400, "invalid_id");

  const body = await readJson(request, updateSchema);
  if (body.error) return body.error;
  const input = body.data;

  const person = await loadPerson(id);
  if (!person || !inScope(actor, person)) return jsonError(404, "not_found");
  if (id === actor.id) return jsonError(403, "cannot_edit_self");
  if (!canManagePerson(actor, person)) return jsonError(403, "not_allowed");

  const updates: Record<string, unknown> = {};
  for (const key of ["name", "role", "member_type", "batch", "section", "semester", "designation", "is_demo"] as const) {
    if (input[key] !== undefined) updates[key] = input[key];
  }

  if (input.platform_role !== undefined && input.platform_role !== person.platform_role) {
    if (!canAssignRole(actor, input.platform_role)) return jsonError(403, "role_not_allowed");
    updates.platform_role = input.platform_role;
  }

  if (input.organization_id !== undefined || input.institute_id !== undefined || input.department_id !== undefined) {
    const placement = await resolvePlacement({
      organization_id: input.organization_id ?? null,
      institute_id: input.institute_id ?? null,
      department_id: input.department_id ?? null,
    });
    if (placement === "invalid") return jsonError(400, "invalid_placement");
    if (!inScope(actor, placement)) return jsonError(403, "placement_out_of_scope");
    Object.assign(updates, placement);
  }

  const changed = Object.keys(updates).filter(
    (key) => (person as unknown as Record<string, unknown>)[key] !== updates[key],
  );
  if (!changed.length) return json({ person: presentPerson(person, actor), changed: [] });

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update(updates).eq("id", id);
  if (error) return jsonError(400, "update_failed", { reason: error.code ?? "error" });

  const details: Record<string, unknown> = { fields: changed };
  for (const key of ["role", "platform_role", "member_type", "organization_id", "institute_id", "department_id", "is_demo"]) {
    if (changed.includes(key)) details[key] = updates[key];
  }
  await writeAuditLog({ ...auditContext(request, actor), action: "user_updated", target: id, details });
  dispatchAfterResponse();

  const fresh = await loadPerson(id);
  return json({ person: fresh ? presentPerson(fresh, actor) : null, changed });
}
