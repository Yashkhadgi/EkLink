import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { canManagePerson, deriveMemberType, type Actor, type Placement } from "./scope";

export const PERSON_SELECT =
  "id, login_id, college_email, name, role, platform_role, member_type, batch, section, semester, designation, " +
  "is_active, is_demo, must_change_password, last_login_at, created_at, updated_at, deactivated_at, " +
  "organization_id, institute_id, department_id, " +
  "organization:organizations(code, name), institute:institutes(code, name), department:departments(code, name)";

type Node = { code: string; name: string } | null;

export type PersonRow = Placement & {
  id: string;
  login_id: string;
  college_email: string;
  name: string;
  role: string;
  platform_role: string | null;
  member_type: string | null;
  batch: string | null;
  section: string | null;
  semester: number | null;
  designation: string | null;
  is_active: boolean;
  is_demo: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
  organization: Node;
  institute: Node;
  department: Node;
};

export function presentPerson(row: PersonRow, actor: Actor) {
  return {
    ...row,
    effective_member_type: deriveMemberType(row.platform_role, row.role, row.member_type),
    can_manage: canManagePerson(actor, row) && row.id !== actor.id,
  };
}

export async function loadPerson(id: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("profiles").select(PERSON_SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(`profile_read_failed:${error.code ?? "error"}`);
  return data as unknown as PersonRow | null;
}
