import { resolvePlacement } from "@/lib/admin/placement";
import {
  APPROVER_TITLES,
  SCOPE_LEVELS,
  canManageApproverScope,
  deriveMemberType,
  scopeFilter,
} from "@/lib/admin/scope";
import {
  auditContext,
  dispatchAfterResponse,
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

const JOB_SELECT =
  "id, title, scope_level, scope_key, valid_from, valid_to, created_at, organization_id, institute_id, department_id, " +
  "person:profiles(id, login_id, name, platform_role, is_active), " +
  "organization:organizations(code, name), institute:institutes(code, name), department:departments(code, name)";

type JobRow = {
  id: string;
  scope_level: "organization" | "institute" | "department";
  valid_from: string;
  valid_to: string | null;
  organization_id: string;
  institute_id: string | null;
  department_id: string | null;
};

export async function GET(request: NextRequest) {
  const guard = await requireAdmin(request);
  if (guard.response) return guard.response;
  const { actor } = guard;

  const params = request.nextUrl.searchParams;
  const status = params.get("status") ?? "current";
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const pageSize = 50;
  const now = today();

  const scope = scopeFilter(actor);
  if (scope === "none") return json({ items: [], total: 0, page, page_size: pageSize });

  const admin = createAdminClient();
  let query = admin.from("approver_assignments").select(JOB_SELECT, { count: "exact" });
  if (scope) query = query.eq(scope.column, scope.value);
  if (status === "current") query = query.lte("valid_from", now).or(`valid_to.is.null,valid_to.gte.${now}`);
  else if (status === "ended") query = query.lt("valid_to", now);
  else if (status === "upcoming") query = query.gt("valid_from", now);

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query
    .order("valid_from", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) return jsonError(500, "approvers_query_failed");

  const items = ((data ?? []) as unknown as JobRow[]).map((job) => ({
    ...job,
    is_current: job.valid_from <= now && (job.valid_to === null || job.valid_to >= now),
    can_manage: canManageApproverScope(actor, job.scope_level, job),
  }));
  return json({ items, total: count ?? items.length, page, page_size: pageSize });
}

const createSchema = z.object({
  profile_id: z.string().uuid(),
  title: z.enum(APPROVER_TITLES),
  scope_level: z.enum(SCOPE_LEVELS),
  organization_id: z.string().uuid().nullable().optional(),
  institute_id: z.string().uuid().nullable().optional(),
  department_id: z.string().uuid().nullable().optional(),
  scope_key: z
    .string()
    .trim()
    .max(64)
    .nullable()
    .optional()
    .transform((value) => value || null),
  valid_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function POST(request: NextRequest) {
  const guard = await requireAdmin(request);
  if (guard.response) return guard.response;
  const { actor } = guard;

  const body = await readJson(request, createSchema);
  if (body.error) return body.error;
  const input = body.data;

  const placement = await resolvePlacement(
    input.scope_level === "department"
      ? { department_id: input.department_id }
      : input.scope_level === "institute"
        ? { institute_id: input.institute_id }
        : { organization_id: input.organization_id },
  );
  if (placement === "invalid" || !placement.organization_id) return jsonError(400, "invalid_scope");
  if (input.scope_level === "department" && !placement.department_id) return jsonError(400, "invalid_scope");
  if (input.scope_level === "institute" && !placement.institute_id) return jsonError(400, "invalid_scope");
  if (!canManageApproverScope(actor, input.scope_level, placement)) return jsonError(403, "scope_not_allowed");

  const admin = createAdminClient();
  const { data: person } = (await admin
    .from("profiles")
    .select("id, login_id, role, platform_role, member_type, is_active")
    .eq("id", input.profile_id)
    .maybeSingle()) as {
    data: {
      id: string;
      login_id: string;
      role: string;
      platform_role: string | null;
      member_type: string | null;
      is_active: boolean;
    } | null;
  };
  if (!person) return jsonError(400, "person_not_found");
  if (!person.is_active) return jsonError(400, "person_inactive");
  const memberType = deriveMemberType(person.platform_role, person.role, person.member_type);
  if (memberType !== "faculty" && memberType !== "staff") return jsonError(400, "person_must_be_faculty_or_staff");

  const { data, error } = await admin
    .from("approver_assignments")
    .insert({
      profile_id: person.id,
      title: input.title,
      scope_level: input.scope_level,
      organization_id: placement.organization_id,
      institute_id: input.scope_level === "organization" ? null : placement.institute_id,
      department_id: input.scope_level === "department" ? placement.department_id : null,
      scope_key: input.scope_key,
      valid_from: input.valid_from ?? today(),
      created_by: actor.id,
    })
    .select("id")
    .single();
  if (error) return jsonError(400, "create_failed", { reason: error.code ?? "error" });

  await writeAuditLog({
    ...auditContext(request, actor),
    action: "approver_assigned",
    target: data.id,
    details: { person: person.id, login_id: person.login_id, title: input.title, scope_level: input.scope_level, scope_key: input.scope_key },
  });
  dispatchAfterResponse();
  return json({ id: data.id }, 201);
}
