import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { constantTimeEqualHex, sha256Hex } from "./crypto";

export type RegisteredApp = {
  id: string;
  slug: string;
  name: string;
  callback_urls: string[];
  allowed_roles: string[];
  /** New-role access list (migration 0006); when set it replaces allowed_roles. */
  allowed_platform_roles?: string[] | null;
  client_id: string;
  client_secret_hash: string;
  is_active: boolean;
  status: "live" | "coming_soon";
};

export type AuthProfile = {
  id: string;
  login_id: string;
  college_email: string;
  name: string;
  role: string;
  department: string | null;
  batch: string | null;
  section: string | null;
  is_active: boolean;
  must_change_password: boolean;
  token_version: number;
  /** Organization tree (migration 0005). Absent on a database without it. */
  platform_role: string | null;
  semester: number | null;
  org_code: string | null;
  institute_code: string | null;
  department_code: string | null;
};

type ProfileRow = Omit<AuthProfile, "platform_role" | "semester" | "org_code" | "institute_code" | "department_code"> & {
  platform_role?: string | null;
  semester?: number | null;
  organization_id?: string | null;
  institute_id?: string | null;
  department_id?: string | null;
};

/** Old EkLink role -> platform role, for profiles not yet backfilled. */
const PLATFORM_ROLE: Record<string, string> = {
  student: "student",
  faculty: "faculty",
  hod: "faculty",
  director: "faculty",
  staff: "staff",
  finance: "staff",
  admin: "super_admin",
};

export function platformRoleOf(role: string, platformRole?: string | null) {
  return platformRole || PLATFORM_ROLE[role] || null;
}

async function codeOf(table: "organizations" | "institutes" | "departments", id?: string | null) {
  if (!id) return null;
  const admin = createAdminClient();
  const { data, error } = (await admin.from(table).select("code").eq("id", id).maybeSingle()) as {
    data: { code: string } | null;
    error: unknown;
  };
  // A missing table (database before 0005) just means "no code".
  return error || !data ? null : data.code;
}

export async function getAppByClientId(clientId: string) {
  const admin = createAdminClient();
  const { data, error } = (await admin
    .from("apps")
    .select(
      "id, slug, name, callback_urls, allowed_roles, allowed_platform_roles, client_id, client_secret_hash, is_active, status",
    )
    .eq("client_id", clientId)
    .maybeSingle()) as { data: RegisteredApp | null; error: { code?: string } | null };

  if (error) throw new Error(`app_lookup_failed:${error.code ?? "error"}`);
  return data;
}

export async function getProfileById(userId: string) {
  const admin = createAdminClient();
  // "*" so this works on databases with and without migration 0005.
  const { data, error } = (await admin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle()) as { data: ProfileRow | null; error: { code?: string } | null };

  if (error) throw new Error(`profile_lookup_failed:${error.code ?? "error"}`);
  if (!data) return null;

  const [org_code, institute_code, department_code] = await Promise.all([
    codeOf("organizations", data.organization_id),
    codeOf("institutes", data.institute_id),
    codeOf("departments", data.department_id),
  ]);
  const profile: AuthProfile = {
    id: data.id,
    login_id: data.login_id,
    college_email: data.college_email,
    name: data.name,
    role: data.role,
    department: data.department,
    batch: data.batch,
    section: data.section,
    is_active: data.is_active,
    must_change_password: data.must_change_password,
    token_version: data.token_version,
    platform_role: platformRoleOf(data.role, data.platform_role),
    semester: data.semester ?? null,
    org_code,
    institute_code,
    department_code,
  };
  return profile;
}

export function isAppLive(app: RegisteredApp) {
  return app.is_active && app.status === "live";
}

/** App access: allowed_platform_roles when the app has it, else the legacy allowed_roles. */
export function appAllowsRole(
  app: Pick<RegisteredApp, "allowed_roles" | "allowed_platform_roles">,
  role: string,
  platformRole: string | null,
) {
  const platformRoles = app.allowed_platform_roles;
  if (platformRoles && platformRoles.length > 0) {
    return !!platformRole && platformRoles.includes(platformRole);
  }
  return app.allowed_roles.includes(role);
}

export function canProfileUseApp(profile: AuthProfile, app: RegisteredApp) {
  return (
    profile.is_active &&
    !profile.must_change_password &&
    appAllowsRole(app, profile.role, profile.platform_role)
  );
}

export function verifyClientSecret(app: RegisteredApp, clientSecret: string) {
  return constantTimeEqualHex(sha256Hex(clientSecret), app.client_secret_hash);
}
