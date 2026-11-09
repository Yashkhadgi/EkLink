import { canManageDirectory, type ScopeLevel } from "@/lib/admin/scope";
import {
  auditContext,
  dispatchAfterResponse,
  json,
  jsonError,
  readJson,
  requireAdmin,
} from "@/lib/admin/session";
import { writeAuditLog } from "@/lib/security/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NextRequest } from "next/server";
import { z } from "zod";

type Org = { id: string; code: string; name: string; is_active: boolean; is_demo: boolean };
type Inst = Org & { organization_id: string };
type Dept = Org & { institute_id: string };

const TABLE: Record<ScopeLevel, "organizations" | "institutes" | "departments"> = {
  organization: "organizations",
  institute: "institutes",
  department: "departments",
};
const PROFILE_COLUMN: Record<ScopeLevel, string> = {
  organization: "organization_id",
  institute: "institute_id",
  department: "department_id",
};

async function peopleCount(level: ScopeLevel, id: string) {
  const admin = createAdminClient();
  const { count } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq(PROFILE_COLUMN[level], id);
  return count ?? 0;
}

// GET — the whole directory (it is small and not secret), with what the caller may change.
export async function GET(request: NextRequest) {
  const guard = await requireAdmin(request);
  if (guard.response) return guard.response;
  const { actor } = guard;

  const admin = createAdminClient();
  const [orgs, insts, depts] = await Promise.all([
    admin.from("organizations").select("id, code, name, is_active, is_demo").order("code"),
    admin.from("institutes").select("id, organization_id, code, name, is_active, is_demo").order("code"),
    admin.from("departments").select("id, institute_id, code, name, is_active, is_demo").order("code"),
  ]);
  if (orgs.error || insts.error || depts.error) return jsonError(500, "directory_query_failed");

  const organizations = (orgs.data ?? []) as Org[];
  const institutes = (insts.data ?? []) as Inst[];
  const departments = (depts.data ?? []) as Dept[];
  const orgOfInstitute = new Map(institutes.map((inst) => [inst.id, inst.organization_id]));

  const withCounts = async <T extends Org>(level: ScopeLevel, rows: T[], placementOf: (row: T) => {
    organization_id: string | null;
    institute_id: string | null;
    department_id: string | null;
  }) =>
    Promise.all(
      rows.map(async (row) => {
        const placement = placementOf(row);
        return {
          ...row,
          people: await peopleCount(level, row.id),
          can_manage: canManageDirectory(actor, level, placement),
          can_add_child:
            level === "organization"
              ? canManageDirectory(actor, "institute", { ...placement, institute_id: null })
              : level === "institute"
                ? canManageDirectory(actor, "department", placement)
                : false,
        };
      }),
    );

  return json({
    organizations: await withCounts("organization", organizations, (row) => ({
      organization_id: row.id,
      institute_id: null,
      department_id: null,
    })),
    institutes: await withCounts("institute", institutes, (row) => ({
      organization_id: row.organization_id,
      institute_id: row.id,
      department_id: null,
    })),
    departments: await withCounts("department", departments, (row) => ({
      organization_id: orgOfInstitute.get(row.institute_id) ?? null,
      institute_id: row.institute_id,
      department_id: row.id,
    })),
    can_add_organization: canManageDirectory(actor, "organization", {
      organization_id: null,
      institute_id: null,
      department_id: null,
    }),
  });
}

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{1,32}$/, "Use 1-32 characters: A-Z, 0-9 and -");

const createSchema = z.object({
  level: z.enum(["organization", "institute", "department"]),
  parent_id: z.string().uuid().optional(),
  code: codeSchema,
  name: z.string().trim().min(1).max(200),
  is_demo: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const guard = await requireAdmin(request);
  if (guard.response) return guard.response;
  const { actor } = guard;

  const body = await readJson(request, createSchema);
  if (body.error) return body.error;
  const input = body.data;
  const admin = createAdminClient();

  let row: Record<string, unknown> = { code: input.code, name: input.name, is_demo: input.is_demo ?? false };
  if (input.level === "organization") {
    if (!canManageDirectory(actor, "organization", { organization_id: null, institute_id: null, department_id: null })) {
      return jsonError(403, "not_allowed");
    }
  } else if (input.level === "institute") {
    if (!input.parent_id) return jsonError(400, "parent_required");
    const { data: org } = await admin.from("organizations").select("id").eq("id", input.parent_id).maybeSingle();
    if (!org) return jsonError(400, "invalid_parent");
    if (!canManageDirectory(actor, "institute", { organization_id: org.id, institute_id: null, department_id: null })) {
      return jsonError(403, "not_allowed");
    }
    row = { ...row, organization_id: org.id };
  } else {
    if (!input.parent_id) return jsonError(400, "parent_required");
    const { data: inst } = (await admin
      .from("institutes")
      .select("id, organization_id")
      .eq("id", input.parent_id)
      .maybeSingle()) as { data: { id: string; organization_id: string } | null };
    if (!inst) return jsonError(400, "invalid_parent");
    if (
      !canManageDirectory(actor, "department", {
        organization_id: inst.organization_id,
        institute_id: inst.id,
        department_id: null,
      })
    ) {
      return jsonError(403, "not_allowed");
    }
    row = { ...row, institute_id: inst.id };
  }

  const { data, error } = await admin.from(TABLE[input.level]).insert(row).select("id").single();
  if (error) {
    if (error.code === "23505") return jsonError(409, "code_in_use");
    return jsonError(400, "create_failed", { reason: error.code ?? "error" });
  }

  await writeAuditLog({
    ...auditContext(request, actor),
    action: "directory_created",
    target: data.id,
    details: { level: input.level, code: input.code },
  });
  dispatchAfterResponse();
  return json({ id: data.id }, 201);
}
