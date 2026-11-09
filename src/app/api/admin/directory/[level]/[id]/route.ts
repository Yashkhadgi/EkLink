import { canManageDirectory, type Placement, type ScopeLevel } from "@/lib/admin/scope";
import {
  auditContext,
  dispatchAfterResponse,
  isUuid,
  json,
  jsonError,
  readJson,
  requireAdmin,
  type AdminActor,
} from "@/lib/admin/session";
import { writeAuditLog } from "@/lib/security/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NextRequest } from "next/server";
import { z } from "zod";

const TABLE = {
  organization: "organizations",
  institute: "institutes",
  department: "departments",
} as const;
const PROFILE_COLUMN = {
  organization: "organization_id",
  institute: "institute_id",
  department: "department_id",
} as const;

type Node = { id: string; code: string; name: string; is_active: boolean; placement: Placement };

async function loadNode(level: ScopeLevel, id: string): Promise<Node | null> {
  const admin = createAdminClient();
  if (level === "organization") {
    const { data } = await admin.from("organizations").select("id, code, name, is_active").eq("id", id).maybeSingle();
    return data ? { ...data, placement: { organization_id: data.id, institute_id: null, department_id: null } } : null;
  }
  if (level === "institute") {
    const { data } = await admin
      .from("institutes")
      .select("id, code, name, is_active, organization_id")
      .eq("id", id)
      .maybeSingle();
    return data
      ? { ...data, placement: { organization_id: data.organization_id, institute_id: data.id, department_id: null } }
      : null;
  }
  const { data } = (await admin
    .from("departments")
    .select("id, code, name, is_active, institute_id, institutes!inner(organization_id)")
    .eq("id", id)
    .maybeSingle()) as {
    data: { id: string; code: string; name: string; is_active: boolean; institute_id: string; institutes: { organization_id: string } } | null;
  };
  return data
    ? {
        id: data.id,
        code: data.code,
        name: data.name,
        is_active: data.is_active,
        placement: { organization_id: data.institutes.organization_id, institute_id: data.institute_id, department_id: data.id },
      }
    : null;
}

async function guardNode(request: NextRequest, ctx: { params: Promise<{ level: string; id: string }> }) {
  const guard = await requireAdmin(request);
  if (guard.response) return { response: guard.response } as const;
  const { level, id } = await ctx.params;
  if (!(level in TABLE) || !isUuid(id)) return { response: jsonError(404, "not_found") } as const;
  const node = await loadNode(level as ScopeLevel, id);
  if (!node) return { response: jsonError(404, "not_found") } as const;
  if (!canManageDirectory(guard.actor, level as ScopeLevel, node.placement)) {
    return { response: jsonError(403, "not_allowed") } as const;
  }
  return { actor: guard.actor as AdminActor, level: level as ScopeLevel, node } as const;
}

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

// PATCH { name?, is_active? } — codes are keys in every app, so they never change.
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ level: string; id: string }> }) {
  const found = await guardNode(request, ctx);
  if (found.response) return found.response;
  const { actor, level, node } = found;

  const body = await readJson(request, updateSchema);
  if (body.error) return body.error;
  const updates: Record<string, unknown> = {};
  if (body.data.name !== undefined && body.data.name !== node.name) updates.name = body.data.name;
  if (body.data.is_active !== undefined && body.data.is_active !== node.is_active) updates.is_active = body.data.is_active;
  if (!Object.keys(updates).length) return json({ ok: true, changed: [] });

  const admin = createAdminClient();
  const { error } = await admin.from(TABLE[level]).update(updates).eq("id", node.id);
  if (error) return jsonError(400, "update_failed", { reason: error.code ?? "error" });

  await writeAuditLog({
    ...auditContext(request, actor),
    action: "directory_updated",
    target: node.id,
    details: { level, code: node.code, ...updates },
  });
  dispatchAfterResponse();
  return json({ ok: true, changed: Object.keys(updates) });
}

// DELETE — only when nothing uses the node (no people, children or approver jobs).
// It is first marked inactive so the apps' mirrors see it go away.
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ level: string; id: string }> }) {
  const found = await guardNode(request, ctx);
  if (found.response) return found.response;
  const { actor, level, node } = found;
  const admin = createAdminClient();

  const counts = await Promise.all([
    admin.from("profiles").select("id", { count: "exact", head: true }).eq(PROFILE_COLUMN[level], node.id),
    admin.from("approver_assignments").select("id", { count: "exact", head: true }).eq(PROFILE_COLUMN[level], node.id),
    level === "organization"
      ? admin.from("institutes").select("id", { count: "exact", head: true }).eq("organization_id", node.id)
      : level === "institute"
        ? admin.from("departments").select("id", { count: "exact", head: true }).eq("institute_id", node.id)
        : Promise.resolve({ count: 0, error: null }),
  ]);
  if (counts.some((result) => result.error)) return jsonError(500, "usage_check_failed");
  if (counts.some((result) => (result.count ?? 0) > 0)) return jsonError(409, "in_use");

  if (node.is_active) {
    const deactivated = await admin.from(TABLE[level]).update({ is_active: false }).eq("id", node.id);
    if (deactivated.error) return jsonError(400, "delete_failed", { reason: deactivated.error.code ?? "error" });
  }
  const { error } = await admin.from(TABLE[level]).delete().eq("id", node.id);
  if (error) return jsonError(409, "in_use", { reason: error.code ?? "error" });

  await writeAuditLog({
    ...auditContext(request, actor),
    action: "directory_deleted",
    target: node.id,
    details: { level, code: node.code },
  });
  dispatchAfterResponse();
  return json({ ok: true });
}
