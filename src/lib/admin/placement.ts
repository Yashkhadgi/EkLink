import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Placement } from "./scope";

export type PlacementInput = {
  organization_id?: string | null;
  institute_id?: string | null;
  department_id?: string | null;
};

/**
 * Turns the most specific id given into a full, consistent placement.
 * Returns "invalid" when that id does not exist; all-null input = unplaced.
 */
export async function resolvePlacement(input: PlacementInput): Promise<Placement | "invalid"> {
  const admin = createAdminClient();
  if (input.department_id) {
    const { data } = (await admin
      .from("departments")
      .select("id, institute_id, institutes!inner(organization_id)")
      .eq("id", input.department_id)
      .maybeSingle()) as {
      data: { id: string; institute_id: string; institutes: { organization_id: string } } | null;
    };
    if (!data) return "invalid";
    return {
      organization_id: data.institutes.organization_id,
      institute_id: data.institute_id,
      department_id: data.id,
    };
  }
  if (input.institute_id) {
    const { data } = (await admin
      .from("institutes")
      .select("id, organization_id")
      .eq("id", input.institute_id)
      .maybeSingle()) as { data: { id: string; organization_id: string } | null };
    if (!data) return "invalid";
    return { organization_id: data.organization_id, institute_id: data.id, department_id: null };
  }
  if (input.organization_id) {
    const { data } = await admin.from("organizations").select("id").eq("id", input.organization_id).maybeSingle();
    if (!data) return "invalid";
    return { organization_id: input.organization_id, institute_id: null, department_id: null };
  }
  return { organization_id: null, institute_id: null, department_id: null };
}
