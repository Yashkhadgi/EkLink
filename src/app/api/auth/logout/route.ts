import { writeAuditLog } from "@/lib/security/audit";
import { getClientIp, getUserAgent } from "@/lib/security/request";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  await supabase.auth.signOut();
  await writeAuditLog({
    actorId: user?.id,
    action: "logout",
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });

  return Response.json({ ok: true });
}
