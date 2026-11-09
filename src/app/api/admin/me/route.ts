import { assignableRoles } from "@/lib/admin/scope";
import { json, requireAdmin } from "@/lib/admin/session";
import type { NextRequest } from "next/server";

// GET — who the admin is and what the console may offer them.
export async function GET(request: NextRequest) {
  const guard = await requireAdmin(request);
  if (guard.response) return guard.response;
  const { actor } = guard;
  return json({
    actor,
    assignable_roles: assignableRoles(actor.platform_role),
    is_super_admin: actor.platform_role === "super_admin",
  });
}
