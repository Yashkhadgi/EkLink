import { checkRateLimit } from "@/lib/security/rate-limit";
import { getClientIp } from "@/lib/security/request";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import { z } from "zod";

const forgotSchema = z.object({
  identifier: z.string().trim().min(1).max(320),
});

const WINDOW_MS = 15 * 60 * 1000;
const GENERIC_RESPONSE =
  "If the account exists, a password reset link has been sent.";

export async function POST(request: NextRequest) {
  const parsed = forgotSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return Response.json({ message: GENERIC_RESPONSE });
  }

  const identifier = parsed.data.identifier.includes("@")
    ? parsed.data.identifier.trim().toLowerCase()
    : parsed.data.identifier.trim();
  const ip = getClientIp(request) ?? "unknown";

  const allowed =
    checkRateLimit({
      key: `forgot:ip:${ip}`,
      limit: 5,
      windowMs: WINDOW_MS,
    }).allowed &&
    checkRateLimit({
      key: `forgot:id:${identifier.toLowerCase()}`,
      limit: 3,
      windowMs: WINDOW_MS,
    }).allowed;

  if (!allowed) {
    return Response.json({ message: GENERIC_RESPONSE });
  }

  const admin = createAdminClient();
  const query = parsed.data.identifier.includes("@")
    ? admin
        .from("profiles")
        .select("college_email")
        .eq("college_email", identifier)
        .maybeSingle()
    : admin
        .from("profiles")
        .select("college_email")
        .eq("login_id", identifier)
        .maybeSingle();

  const { data: profile } = (await query) as {
    data: { college_email: string } | null;
  };

  if (profile?.college_email) {
    const origin = process.env.EKLINK_ISSUER_URL ?? request.nextUrl.origin;
    const supabase = await createServerSupabaseClient();
    await supabase.auth.resetPasswordForEmail(profile.college_email, {
      redirectTo: `${origin}/auth/confirm?next=/reset-password`,
    });
  }

  return Response.json({ message: GENERIC_RESPONSE });
}
