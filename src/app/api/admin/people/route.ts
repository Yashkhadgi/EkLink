import { PERSON_SELECT, presentPerson, type PersonRow } from "@/lib/admin/people";
import { resolvePlacement } from "@/lib/admin/placement";
import {
  LEGACY_ROLES,
  MEMBER_TYPES,
  PLATFORM_ROLES,
  canAssignRole,
  inScope,
  isPlatformRole,
  legacyRoleFor,
  scopeFilter,
} from "@/lib/admin/scope";
import {
  auditContext,
  dispatchAfterResponse,
  isUuid,
  json,
  jsonError,
  readJson,
  requireAdmin,
} from "@/lib/admin/session";
import { createUser } from "@/lib/provisioning";
import { writeAuditLog } from "@/lib/security/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NextRequest } from "next/server";
import { z } from "zod";

function cleanSearch(value: string) {
  // Characters with a meaning in PostgREST filter syntax are dropped.
  return value.replace(/[,()*%\\:"'.]/g, " ").replace(/\s+/g, " ").trim().slice(0, 64);
}

export async function GET(request: NextRequest) {
  const guard = await requireAdmin(request);
  if (guard.response) return guard.response;
  const { actor } = guard;

  const params = request.nextUrl.searchParams;
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(params.get("page_size") ?? "25", 10) || 25));

  const scope = scopeFilter(actor);
  if (scope === "none") return json({ items: [], total: 0, page, page_size: pageSize });

  const admin = createAdminClient();
  let query = admin.from("profiles").select(PERSON_SELECT, { count: "exact" });
  if (scope) query = query.eq(scope.column, scope.value);

  for (const column of ["organization_id", "institute_id", "department_id"] as const) {
    const value = params.get(column);
    if (value) {
      if (!isUuid(value)) return jsonError(400, "invalid_filter");
      query = query.eq(column, value);
    }
  }
  const role = params.get("platform_role");
  if (role) {
    if (!isPlatformRole(role)) return jsonError(400, "invalid_filter");
    query = query.eq("platform_role", role);
  }
  const status = params.get("status") ?? "all";
  if (status === "active") query = query.eq("is_active", true);
  else if (status === "inactive") query = query.eq("is_active", false);
  const demo = params.get("is_demo");
  if (demo === "true" || demo === "false") query = query.eq("is_demo", demo === "true");

  const loginId = params.get("login_id");
  if (loginId) query = query.eq("login_id", loginId.trim());
  const q = cleanSearch(params.get("q") ?? "");
  if (q) {
    query = query.or(`name.ilike.*${q}*,college_email.ilike.*${q}*,login_id.ilike.*${q}*`);
  }

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query.order("login_id", { ascending: true }).range(from, from + pageSize - 1);
  if (error) return jsonError(500, "people_query_failed");

  const items = ((data ?? []) as unknown as PersonRow[]).map((row) => presentPerson(row, actor));
  return json({ items, total: count ?? items.length, page, page_size: pageSize });
}

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => value || null);

const createSchema = z.object({
  login_id: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(256),
  college_email: z.string().trim().toLowerCase().email().max(320),
  platform_role: z.enum(PLATFORM_ROLES),
  role: z.enum(LEGACY_ROLES).optional(),
  member_type: z.enum(MEMBER_TYPES).nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  institute_id: z.string().uuid().nullable().optional(),
  department_id: z.string().uuid().nullable().optional(),
  batch: nullableText(7),
  section: nullableText(1),
  semester: z.number().int().min(1).max(12).nullable().optional(),
  designation: nullableText(128),
  is_demo: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const guard = await requireAdmin(request);
  if (guard.response) return guard.response;
  const { actor } = guard;

  const body = await readJson(request, createSchema);
  if (body.error) return body.error;
  const input = body.data;

  if (!canAssignRole(actor, input.platform_role)) return jsonError(403, "role_not_allowed");
  const placement = await resolvePlacement(input);
  if (placement === "invalid") return jsonError(400, "invalid_placement");
  if (!inScope(actor, placement)) return jsonError(403, "placement_out_of_scope");

  const admin = createAdminClient();
  const [byLogin, byEmail] = await Promise.all([
    admin.from("profiles").select("id").eq("login_id", input.login_id).limit(1),
    admin.from("profiles").select("id").eq("college_email", input.college_email).limit(1),
  ]);
  if (byLogin.data?.length) return jsonError(409, "login_id_in_use");
  if (byEmail.data?.length) return jsonError(409, "email_in_use");

  try {
    const result = await createUser(
      {
        login_id: input.login_id,
        name: input.name,
        college_email: input.college_email,
        role: input.role ?? legacyRoleFor(input.platform_role),
        batch: input.batch ?? "",
        section: input.section ?? "",
        organization_id: placement.organization_id,
        institute_id: placement.institute_id,
        department_id: placement.department_id,
        platform_role: input.platform_role,
        member_type: input.member_type ?? null,
        semester: input.semester ?? null,
        designation: input.designation ?? null,
        is_demo: input.is_demo ?? false,
      },
      auditContext(request, actor),
    );
    dispatchAfterResponse();
    return json({ id: result.userId, temporary_password: result.temporaryPassword }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "create_failed";
    if (message.startsWith("auth_create_failed:422") || message.endsWith(":23505")) {
      return jsonError(409, "login_id_or_email_in_use");
    }
    if (error instanceof z.ZodError) return jsonError(400, "invalid_request");
    await writeAuditLog({ ...auditContext(request, actor), action: "user_create_failed", details: { reason: message } });
    return jsonError(500, "create_failed", { reason: message });
  }
}
