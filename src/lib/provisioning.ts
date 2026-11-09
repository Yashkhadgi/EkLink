import "server-only";

import { writeAuditLog } from "@/lib/security/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import crypto from "node:crypto";
import { z } from "zod";

const UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGIT = "23456789";
const SYMBOL = "!@#$%&*?";
const ALL_PASSWORD_CHARS = UPPER + LOWER + DIGIT + SYMBOL;

const roleSchema = z.enum([
  "student",
  "faculty",
  "staff",
  "hod",
  "director",
  "finance",
  "admin",
]);

const createUserSchema = z.object({
  login_id: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(256),
  college_email: z.string().trim().toLowerCase().email().max(320),
  role: roleSchema,
  department: z
    .string()
    .trim()
    .max(128)
    .optional()
    .transform((value) => value || null),
  batch: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}$/)
    .optional()
    .or(z.literal(""))
    .transform((value) => value || null),
  section: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]$/)
    .optional()
    .or(z.literal(""))
    .transform((value) => value || null),
  // Placement in the organization tree (migration 0005), by code. Optional.
  org_code: z.string().trim().toUpperCase().max(32).optional(),
  institute_code: z.string().trim().toUpperCase().max(32).optional(),
  department_code: z.string().trim().toUpperCase().max(32).optional(),
  // Admin Console (migration 0006). All optional; the database derives what is missing.
  organization_id: z.string().uuid().nullable().optional(),
  institute_id: z.string().uuid().nullable().optional(),
  department_id: z.string().uuid().nullable().optional(),
  platform_role: z
    .enum(["super_admin", "org_admin", "institute_admin", "department_admin", "faculty", "staff", "student"])
    .optional(),
  member_type: z.enum(["faculty", "staff", "student"]).nullable().optional(),
  semester: z.number().int().min(1).max(12).nullable().optional(),
  designation: z
    .string()
    .trim()
    .max(128)
    .nullable()
    .optional()
    .transform((value) => value || null),
  is_demo: z.boolean().optional(),
});

async function departmentIdFor(org?: string, institute?: string, department?: string) {
  if (!org || !institute || !department) return null;
  const admin = createAdminClient();
  const { data, error } = (await admin
    .from("departments")
    .select("id, code, institutes!inner(code, organizations!inner(code))")
    .eq("code", department)
    .eq("institutes.code", institute)
    .eq("institutes.organizations.code", org)
    .maybeSingle()) as { data: { id: string } | null; error: unknown };
  return error || !data ? null : data.id;
}

type AuditOptions = {
  actorId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

export type CreateUserInput = z.input<typeof createUserSchema>;

function pick(set: string) {
  return set[crypto.randomInt(set.length)];
}

function shuffle(chars: string[]) {
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [chars[index], chars[swapIndex]] = [chars[swapIndex], chars[index]];
  }

  return chars;
}

export function generateTempPassword() {
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SYMBOL)];

  while (chars.length < 12) {
    chars.push(pick(ALL_PASSWORD_CHARS));
  }

  return shuffle(chars).join("");
}

export async function createUser(input: CreateUserInput, audit: AuditOptions = {}) {
  const user = createUserSchema.parse(input);
  const admin = createAdminClient();
  const temporaryPassword = generateTempPassword();

  const created = await admin.auth.admin.createUser({
    email: user.college_email,
    password: temporaryPassword,
    email_confirm: true,
  });

  if (created.error) {
    throw new Error(`auth_create_failed:${created.error.status ?? created.error.code ?? "error"}`);
  }

  const userId = created.data.user.id;
  const departmentId =
    user.department_id ??
    (await departmentIdFor(user.org_code, user.institute_code, user.department_code));
  const placement = departmentId
    ? { department_id: departmentId }
    : user.institute_id
      ? { institute_id: user.institute_id }
      : user.organization_id
        ? { organization_id: user.organization_id }
        : {};
  const inserted = await admin.from("profiles").insert({
    id: userId,
    login_id: user.login_id,
    college_email: user.college_email,
    name: user.name,
    role: user.role,
    department: user.department,
    batch: user.batch,
    section: user.section,
    must_change_password: true,
    // The database derives institute, organization and platform_role.
    ...placement,
    ...(user.platform_role ? { platform_role: user.platform_role } : {}),
    ...(user.member_type !== undefined ? { member_type: user.member_type } : {}),
    ...(user.semester !== undefined ? { semester: user.semester } : {}),
    ...(user.designation !== undefined ? { designation: user.designation } : {}),
    ...(user.is_demo !== undefined ? { is_demo: user.is_demo } : {}),
  });

  if (inserted.error) {
    await admin.auth.admin.deleteUser(userId);
    throw new Error(`profile_insert_failed:${inserted.error.code ?? "error"}`);
  }

  await writeAuditLog({
    actorId: audit.actorId,
    action: "user_created",
    target: userId,
    ip: audit.ip,
    userAgent: audit.userAgent,
    details: { role: user.role, platform_role: user.platform_role ?? null },
  });

  return { userId, temporaryPassword };
}

export async function resetTempPassword(userId: string, audit: AuditOptions = {}) {
  const id = z.string().uuid().parse(userId);
  const admin = createAdminClient();
  const temporaryPassword = generateTempPassword();

  const { data: profile, error: readError } = await admin
    .from("profiles")
    .select("token_version")
    .eq("id", id)
    .maybeSingle();

  if (readError || !profile) {
    throw new Error(`profile_read_failed:${readError?.code ?? "not_found"}`);
  }

  const updated = await admin.auth.admin.updateUserById(id, {
    password: temporaryPassword,
  });

  if (updated.error) {
    throw new Error(`auth_password_update_failed:${updated.error.status ?? updated.error.code ?? "error"}`);
  }

  const profileUpdate = await admin
    .from("profiles")
    .update({
      must_change_password: true,
      token_version: (profile.token_version ?? 1) + 1,
    })
    .eq("id", id);

  if (profileUpdate.error) {
    throw new Error(`profile_password_reset_failed:${profileUpdate.error.code ?? "error"}`);
  }

  const revoked = await admin.rpc("revoke_user_sessions", { p_user_id: id });
  if (revoked.error) {
    throw new Error(`session_revoke_failed:${revoked.error.code ?? "error"}`);
  }

  await writeAuditLog({
    actorId: audit.actorId,
    action: "password_reset",
    target: id,
    ip: audit.ip,
    userAgent: audit.userAgent,
  });

  return { userId: id, temporaryPassword };
}

export async function setUserActive(
  userId: string,
  isActive: boolean,
  audit: AuditOptions = {},
) {
  const id = z.string().uuid().parse(userId);
  const admin = createAdminClient();
  const { data: profile, error: readError } = await admin
    .from("profiles")
    .select("token_version")
    .eq("id", id)
    .maybeSingle();

  if (readError || !profile) {
    throw new Error(`profile_read_failed:${readError?.code ?? "not_found"}`);
  }

  const { error } = await admin
    .from("profiles")
    .update({
      is_active: isActive,
      token_version: (profile.token_version ?? 1) + 1,
    })
    .eq("id", id);

  if (error) {
    throw new Error(`profile_active_update_failed:${error.code ?? "error"}`);
  }

  await writeAuditLog({
    actorId: audit.actorId,
    action: isActive ? "user_reactivated" : "user_deactivated",
    target: id,
    ip: audit.ip,
    userAgent: audit.userAgent,
  });

  if (!isActive) {
    const revoked = await admin.rpc("revoke_user_sessions", { p_user_id: id });
    if (revoked.error) {
      throw new Error(`session_revoke_failed:${revoked.error.code ?? "error"}`);
    }
  }
}

export async function forceLogout(userId: string, audit: AuditOptions = {}) {
  const id = z.string().uuid().parse(userId);
  const admin = createAdminClient();
  const { data: profile, error: readError } = await admin
    .from("profiles")
    .select("token_version")
    .eq("id", id)
    .maybeSingle();

  if (readError || !profile) {
    throw new Error(`profile_read_failed:${readError?.code ?? "not_found"}`);
  }

  const { error: updateError } = await admin
    .from("profiles")
    .update({ token_version: (profile.token_version ?? 1) + 1 })
    .eq("id", id);

  if (updateError) {
    throw new Error(`token_version_bump_failed:${updateError.code ?? "error"}`);
  }

  const revoked = await admin.rpc("revoke_user_sessions", { p_user_id: id });
  if (revoked.error) {
    throw new Error(`session_revoke_failed:${revoked.error.code ?? "error"}`);
  }

  await writeAuditLog({
    actorId: audit.actorId,
    action: "force_logout",
    target: id,
    ip: audit.ip,
    userAgent: audit.userAgent,
  });
}
