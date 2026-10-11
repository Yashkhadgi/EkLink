import { writeAuditLog } from "@/lib/security/audit";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { getClientIp, getUserAgent } from "@/lib/security/request";
import { getSafeRelativePath } from "@/lib/security/redirect";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import { z } from "zod";

const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(1024),
});

const GENERIC_ERROR = "PRN/email or password is incorrect.";
const WINDOW_MS = 15 * 60 * 1000;

type Profile = {
  id: string;
  login_id: string;
  college_email: string;
  is_active: boolean;
  locked_until: string | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fail(request: NextRequest, profile: Profile | null, target: string) {
  await sleep(350);
  await writeAuditLog({
    actorId: profile?.id,
    action: "login_fail",
    target,
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });

  return Response.json({ error: GENERIC_ERROR }, { status: 401 });
}

function isLocked(profile: Profile) {
  return profile.locked_until
    ? new Date(profile.locked_until).getTime() > Date.now()
    : false;
}

export async function POST(request: NextRequest) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return fail(request, null, "invalid_body");
  }

  const identifier = parsed.data.identifier.includes("@")
    ? parsed.data.identifier.trim().toLowerCase()
    : parsed.data.identifier.trim();
  const ip = getClientIp(request) ?? "unknown";
  const ipLimit = checkRateLimit({
    key: `login:ip:${ip}`,
    limit: 10,
    windowMs: WINDOW_MS,
  });
  const identifierLimit = checkRateLimit({
    key: `login:id:${identifier.toLowerCase()}`,
    limit: 5,
    windowMs: WINDOW_MS,
  });

  if (!ipLimit.allowed || !identifierLimit.allowed) {
    return fail(request, null, "rate_limited");
  }

  const admin = createAdminClient();
  const profileQuery = parsed.data.identifier.includes("@")
    ? admin
        .from("profiles")
        .select("id, login_id, college_email, is_active, locked_until")
        .eq("college_email", identifier)
        .maybeSingle()
    : admin
        .from("profiles")
        .select("id, login_id, college_email, is_active, locked_until")
        .eq("login_id", identifier)
        .maybeSingle();

  const { data: profile } = (await profileQuery) as { data: Profile | null };

  if (!profile || !profile.is_active || isLocked(profile)) {
    return fail(request, profile, identifier);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: profile.college_email,
    password: parsed.data.password,
  });

  if (error) {
    await admin.rpc("record_failed_login", { p_user_id: profile.id });
    return fail(request, profile, profile.login_id);
  }

  await admin
    .from("profiles")
    .update({ failed_logins: 0, locked_until: null, last_login_at: new Date().toISOString() })
    .eq("id", profile.id);
  await writeAuditLog({
    actorId: profile.id,
    action: "login_ok",
    target: profile.login_id,
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });

  const safeNext = getSafeRelativePath(request.nextUrl.searchParams.get("next"));

  return Response.json({ ok: true, next: safeNext });
}
