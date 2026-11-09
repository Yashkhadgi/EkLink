import { json, jsonError, requireAdmin } from "@/lib/admin/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NextRequest } from "next/server";

type AuditRow = {
  id: number;
  at: string;
  actor_id: string | null;
  action: string;
  target: string | null;
  ip: string | null;
  details: Record<string, unknown> | null;
};

// GET ?page=&action= — super admins see everything; other admins see their own actions.
export async function GET(request: NextRequest) {
  const guard = await requireAdmin(request);
  if (guard.response) return guard.response;
  const { actor } = guard;

  const params = request.nextUrl.searchParams;
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const pageSize = 50;
  const action = params.get("action")?.trim();

  const admin = createAdminClient();
  let query = admin.from("audit_log").select("id, at, actor_id, action, target, ip, details", { count: "exact" });
  if (actor.platform_role !== "super_admin") query = query.eq("actor_id", actor.id);
  if (action && /^[a-z_]{1,64}$/.test(action)) query = query.eq("action", action);

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query.order("id", { ascending: false }).range(from, from + pageSize - 1);
  if (error) return jsonError(500, "audit_query_failed");
  const rows = (data ?? []) as AuditRow[];

  // Show login IDs for actors and person targets.
  const ids = [
    ...new Set(
      rows
        .flatMap((row) => [row.actor_id, row.target])
        .filter((value): value is string => !!value && /^[0-9a-f-]{36}$/i.test(value)),
    ),
  ];
  const people = new Map<string, string>();
  if (ids.length) {
    const { data: found } = await admin.from("profiles").select("id, login_id").in("id", ids);
    for (const person of found ?? []) people.set(person.id, person.login_id);
  }

  return json({
    items: rows.map((row) => ({
      ...row,
      actor_login_id: row.actor_id ? (people.get(row.actor_id) ?? null) : null,
      target_login_id: row.target ? (people.get(row.target) ?? null) : null,
    })),
    total: count ?? rows.length,
    page,
    page_size: pageSize,
    scope: actor.platform_role === "super_admin" ? "all" : "own",
  });
}
