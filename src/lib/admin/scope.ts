// Scoped admin rules for the Admin Console (same ladder as TemplateOS).
// Pure functions: no server-only import, so `node --test` can run them.

export const PLATFORM_ROLES = [
  "super_admin",
  "org_admin",
  "institute_admin",
  "department_admin",
  "faculty",
  "staff",
  "student",
] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const ADMIN_ROLES: readonly PlatformRole[] = [
  "super_admin",
  "org_admin",
  "institute_admin",
  "department_admin",
];

export const LEGACY_ROLES = ["student", "faculty", "staff", "hod", "director", "finance", "admin"] as const;
export const MEMBER_TYPES = ["faculty", "staff", "student"] as const;

export const APPROVER_TITLES = [
  "HOD",
  "Director",
  "Dean",
  "Class Teacher",
  "Mentor",
  "Course Faculty",
  "Exam Cell",
  "Admin Staff",
  "Event In-charge",
  "Other",
] as const;
export const SCOPE_LEVELS = ["organization", "institute", "department"] as const;
export type ScopeLevel = (typeof SCOPE_LEVELS)[number];

export type Placement = {
  organization_id: string | null;
  institute_id: string | null;
  department_id: string | null;
};

export type Actor = Placement & { id: string; platform_role: string | null };

export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === "string" && (PLATFORM_ROLES as readonly string[]).includes(value);
}

export function isAdminRole(role: string | null | undefined) {
  return !!role && (ADMIN_ROLES as readonly string[]).includes(role);
}

/** Roles an admin may give: strictly below their own (a super admin may give all). */
export function assignableRoles(actorRole: string | null | undefined): PlatformRole[] {
  switch (actorRole) {
    case "super_admin":
      return [...PLATFORM_ROLES];
    case "org_admin":
      return ["institute_admin", "department_admin", "faculty", "staff", "student"];
    case "institute_admin":
      return ["department_admin", "faculty", "staff", "student"];
    case "department_admin":
      return ["faculty", "staff", "student"];
    default:
      return [];
  }
}

export function canAssignRole(actor: Pick<Actor, "platform_role">, role: string | null | undefined) {
  return !!role && (assignableRoles(actor.platform_role) as string[]).includes(role);
}

/** Whether a placement lies inside the actor's own scope. */
export function inScope(actor: Actor, target: Placement) {
  switch (actor.platform_role) {
    case "super_admin":
      return true;
    case "org_admin":
      return !!actor.organization_id && target.organization_id === actor.organization_id;
    case "institute_admin":
      return !!actor.institute_id && target.institute_id === actor.institute_id;
    case "department_admin":
      return !!actor.department_id && target.department_id === actor.department_id;
    default:
      return false;
  }
}

/** A person can be managed when inside the scope and of a role below the actor's. */
export function canManagePerson(actor: Actor, target: Placement & { platform_role: string | null }) {
  if (!isAdminRole(actor.platform_role)) return false;
  if (!inScope(actor, target)) return false;
  return canAssignRole(actor, target.platform_role);
}

/** The column/value that limits a people query to the actor's scope (null = everything). */
export function scopeFilter(actor: Actor): { column: keyof Placement; value: string } | "none" | null {
  switch (actor.platform_role) {
    case "super_admin":
      return null;
    case "org_admin":
      return actor.organization_id ? { column: "organization_id", value: actor.organization_id } : "none";
    case "institute_admin":
      return actor.institute_id ? { column: "institute_id", value: actor.institute_id } : "none";
    case "department_admin":
      return actor.department_id ? { column: "department_id", value: actor.department_id } : "none";
    default:
      return "none";
  }
}

/**
 * Directory changes: organizations are super-admin only; an org admin manages the
 * institutes and departments of their organization; an institute admin the
 * departments of their institute. Department admins only read.
 */
export function canManageDirectory(actor: Actor, level: ScopeLevel, node: Placement) {
  switch (actor.platform_role) {
    case "super_admin":
      return true;
    case "org_admin":
      return level !== "organization" && !!actor.organization_id && node.organization_id === actor.organization_id;
    case "institute_admin":
      return level === "department" && !!actor.institute_id && node.institute_id === actor.institute_id;
    default:
      return false;
  }
}

/** Approver jobs: the job's scope must lie inside the actor's scope. */
export function canManageApproverScope(actor: Actor, level: ScopeLevel, placement: Placement) {
  switch (actor.platform_role) {
    case "super_admin":
      return true;
    case "org_admin":
      return !!actor.organization_id && placement.organization_id === actor.organization_id;
    case "institute_admin":
      return level !== "organization" && !!actor.institute_id && placement.institute_id === actor.institute_id;
    case "department_admin":
      return level === "department" && !!actor.department_id && placement.department_id === actor.department_id;
    default:
      return false;
  }
}

/** Legacy `role` that matches a platform role (used when creating people). */
export function legacyRoleFor(platformRole: PlatformRole) {
  switch (platformRole) {
    case "faculty":
      return "faculty";
    case "staff":
      return "staff";
    case "student":
      return "student";
    default:
      return "admin";
  }
}

/** Same derivation as the SQL function public.sync_member_type. */
export function deriveMemberType(platformRole: string | null, role: string | null, stored: string | null) {
  if (platformRole === "faculty" || platformRole === "staff" || platformRole === "student") return platformRole;
  if (stored) return stored;
  switch (role) {
    case "student":
      return "student";
    case "faculty":
    case "hod":
    case "director":
      return "faculty";
    case "staff":
    case "finance":
      return "staff";
    default:
      return null;
  }
}

/** "Current" approver job: valid_from <= today and (valid_to null or >= today). */
export function isCurrentJob(job: { valid_from: string; valid_to: string | null }, today: string) {
  return job.valid_from <= today && (job.valid_to === null || job.valid_to >= today);
}
