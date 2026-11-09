import "server-only";

import { platformRoleOf } from "@/lib/auth/oauth";
import { getClientIp, getUserAgent } from "@/lib/security/request";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { triggerDispatch } from "@/lib/sync/events";
import { after, type NextRequest } from "next/server";
import type { z } from "zod";
import { isAdminRole, type Actor } from "./scope";

export type AdminActor = Actor & { name: string; login_id: string };

type ActorRow = {
  id: string;
  name: string;
  login_id: string;
  role: string;
  platform_role: string | null;
  organization_id: string | null;
  institute_id: string | null;
  department_id: string | null;
  is_active: boolean;
  must_change_password: boolean;
};

/** The signed-in user if they hold an admin platform role (else null). */
export async function getAdminActor(): Promise<AdminActor | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createAdminClient();
  const { data } = (await admin
    .from("profiles")
    .select(
      "id, name, login_id, role, platform_role, organization_id, institute_id, department_id, is_active, must_change_password",
    )
    .eq("id", user.id)
    .maybeSingle()) as { data: ActorRow | null };
  if (!data || !data.is_active || data.must_change_password) return null;

  const platformRole = platformRoleOf(data.role, data.platform_role);
  if (!isAdminRole(platformRole)) return null;
  return {
    id: data.id,
    name: data.name,
    login_id: data.login_id,
    platform_role: platformRole,
    organization_id: data.organization_id,
    institute_id: data.institute_id,
    department_id: data.department_id,
  };
}

export function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return Response.json({ error, ...extra }, { status, headers: { "cache-control": "no-store" } });
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

/** Rejects cross-site mutations (cookie-authenticated API). */
function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

type Guard = { actor: AdminActor; response?: never } | { actor?: never; response: Response };

export async function requireAdmin(request: NextRequest, options: { superOnly?: boolean } = {}): Promise<Guard> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (!sameOrigin(request)) return { response: jsonError(403, "cross_origin_rejected") };
  }
  const actor = await getAdminActor();
  if (!actor) return { response: jsonError(403, "admin_only") };
  if (options.superOnly && actor.platform_role !== "super_admin") {
    return { response: jsonError(403, "super_admin_only") };
  }
  return { actor };
}

export async function readJson<T extends z.ZodType>(request: NextRequest, schema: T) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: jsonError(400, "invalid_json") } as const;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      error: jsonError(400, "invalid_request", {
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      }),
    } as const;
  }
  return { data: parsed.data as z.infer<T> } as const;
}

export function auditContext(request: NextRequest, actor: AdminActor) {
  return { actorId: actor.id, ip: getClientIp(request), userAgent: getUserAgent(request) };
}

/** Pushes the queued change events after the response is sent. */
export function dispatchAfterResponse() {
  after(() => triggerDispatch());
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Local calendar date (YYYY-MM-DD). */
export function today(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return date.toLocaleDateString("en-CA");
}
