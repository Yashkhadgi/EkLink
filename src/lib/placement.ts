import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type Placement = {
  organization: string | null;
  institute: string | null;
  department: string | null;
  platformRole: string | null;
  semester: number | null;
  batch: string | null;
  section: string | null;
};

const EMPTY: Placement = {
  organization: null,
  institute: null,
  department: null,
  platformRole: null,
  semester: null,
  batch: null,
  section: null,
};

async function nameOf(table: "organizations" | "institutes" | "departments", id: unknown) {
  if (typeof id !== "string" || !id) return null;
  const admin = createAdminClient();
  const { data, error } = (await admin.from(table).select("name").eq("id", id).maybeSingle()) as {
    data: { name: string } | null;
    error: unknown;
  };
  return error || !data ? null : data.name;
}

/**
 * Where a person sits in the organization tree (names for display). Works on
 * databases without migration 0005 too: everything is then null.
 */
export async function getPlacement(userId: string): Promise<Placement> {
  const admin = createAdminClient();
  const { data, error } = (await admin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle()) as { data: Record<string, unknown> | null; error: unknown };
  if (error || !data) return EMPTY;

  const [organization, institute, department] = await Promise.all([
    nameOf("organizations", data.organization_id),
    nameOf("institutes", data.institute_id),
    nameOf("departments", data.department_id),
  ]);
  return {
    organization,
    institute,
    department,
    platformRole: typeof data.platform_role === "string" ? data.platform_role : null,
    semester: typeof data.semester === "number" ? data.semester : null,
    batch: typeof data.batch === "string" ? data.batch : null,
    section: typeof data.section === "string" ? data.section : null,
  };
}

export function formatPlatformRole(role: string | null) {
  if (!role) return null;
  return role
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
