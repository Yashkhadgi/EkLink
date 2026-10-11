import { writeAuditLog } from "@/lib/security/audit";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { getClientIp, getUserAgent } from "@/lib/security/request";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import { z } from "zod";

const MIN_LENGTH = 10;
const WINDOW_MS = 15 * 60 * 1000;

const bodySchema = z.object({
  newPassword: z.string().min(MIN_LENGTH).max(128),
});

type Profile = {
  id: string;
  login_id: string | null;
  college_email: string;
  is_active: boolean;
  must_change_password: boolean;
};

function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return bad("Please sign in again.", 401);
  }

  const limit = checkRateLimit({
    key: `change-password:user:${user.id}`,
    limit: 5,
    windowMs: WINDOW_MS,
  });
  if (!limit.allowed) {
    return bad("Too many attempts. Please wait a few minutes and try again.", 429);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return bad(`Use at least ${MIN_LENGTH} characters.`);
  }
  const newPassword = parsed.data.newPassword;

  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id, login_id, college_email, is_active, must_change_password")
    .eq("id", user.id)
    .maybeSingle();
  const profile = data as Profile | null;

  if (!profile || !profile.is_active) {
    return bad("This account cannot change its password.", 403);
  }

  // Basic policy: letters and numbers, and nothing derived from the user's own ID or email.
  if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    return bad("Use both letters and numbers.");
  }
  const lower = newPassword.toLowerCase();
  const emailName = profile.college_email.split("@")[0].toLowerCase();
  const loginId = (profile.login_id ?? "").toLowerCase();
  if ((loginId.length >= 4 && lower.includes(loginId)) || (emailName.length >= 4 && lower.includes(emailName))) {
    return bad("Do not use your ID or email in your password.");
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

  if (updateError) {
    switch (updateError.code) {
      case "same_password":
        return bad("Choose a password different from your current one.");
      case "weak_password":
        return bad("That password is too weak. Try a longer one with letters, numbers and a symbol.");
      case "reauthentication_needed":
        return bad("Please sign in again and retry.", 401);
      default:
        return bad("Could not change the password. Please try again.", 500);
    }
  }

  // The password is changed; now clear the flag (retry a few times, never log the password).
  let flagCleared = false;
  for (let attempt = 0; attempt < 3 && !flagCleared; attempt++) {
    const { error } = await admin
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", user.id);
    flagCleared = !error;
  }
  if (!flagCleared) {
    console.error("change-password: could not clear must_change_password flag");
    return bad("Password changed, but we could not finish. Please contact your administrator.", 500);
  }

  // Sign out every other device that might still hold a session.
  try {
    await supabase.auth.signOut({ scope: "others" });
  } catch {
    // best effort
  }

  await writeAuditLog({
    actorId: user.id,
    action: "password_changed",
    target: profile.login_id,
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
    details: { forced: profile.must_change_password },
  });

  return Response.json({ ok: true, next: "/dashboard" });
}