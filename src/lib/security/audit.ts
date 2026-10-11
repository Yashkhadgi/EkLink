import { createAdminClient } from "@/lib/supabase/admin";

type AuditInput = {
  actorId?: string | null;
  action: "login_ok" | "login_fail" | "logout" | string;
  target?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown> | null;
};

export async function writeAuditLog({
  actorId = null,
  action,
  target = null,
  ip = null,
  userAgent = null,
  details = null,
}: AuditInput) {
  const admin = createAdminClient();

  await admin.from("audit_log").insert({
    actor_id: actorId,
    action,
    target,
    ip,
    user_agent: userAgent,
    details,
  });
}
