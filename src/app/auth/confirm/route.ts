import { getSafeRelativePath } from "@/lib/security/redirect";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const confirmSchema = z.object({
  token_hash: z.string().min(1),
  type: z.enum(["signup", "invite", "magiclink", "recovery", "email_change", "email"]),
  next: z.string().nullable(),
});

export async function GET(request: NextRequest) {
  const parsed = confirmSchema.safeParse({
    token_hash: request.nextUrl.searchParams.get("token_hash"),
    type: request.nextUrl.searchParams.get("type"),
    next: request.nextUrl.searchParams.get("next"),
  });

  if (!parsed.success) {
    return NextResponse.redirect(new URL("/login?error=link_invalid", request.url));
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: parsed.data.token_hash,
    type: parsed.data.type as EmailOtpType,
  });

  if (error) {
    return NextResponse.redirect(new URL("/login?error=link_invalid", request.url));
  }

  const defaultNext =
    parsed.data.type === "invite" ? "/set-password" : "/reset-password";
  const safeNext = getSafeRelativePath(parsed.data.next, defaultNext);

  return NextResponse.redirect(new URL(safeNext, request.url));
}
