import { randomCode, sha256Hex } from "@/lib/auth/crypto";
import {
  canProfileUseApp,
  getAppByClientId,
  getProfileById,
  isAppLive,
} from "@/lib/auth/oauth";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { getClientIp, getUserAgent } from "@/lib/security/request";
import { writeAuditLog } from "@/lib/security/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";

function htmlPage(title: string, message: string, status = 400) {
  return new Response(
    `<!doctype html><html><head><title>${title}</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="font-family:system-ui,sans-serif;margin:3rem;line-height:1.5;color:#0f172a"><main style="max-width:36rem"><h1>${title}</h1><p>${message}</p></main></body></html>`,
    {
      status,
      headers: { "content-type": "text/html; charset=utf-8" },
    },
  );
}

async function auditRejected(
  request: NextRequest,
  reason: string,
  actorId: string | null = null,
  target: string | null = null,
) {
  await writeAuditLog({
    actorId,
    action: "code_rejected",
    target,
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
    details: { reason },
  });
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request) ?? "unknown";
  const limited = checkRateLimit({
    key: `authorize:${ip}`,
    limit: 30,
    windowMs: 60_000,
  });

  if (!limited.allowed) {
    await auditRejected(request, "rate_limited");
    return htmlPage("Too many requests", "Please wait a minute and try again.", 429);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = `?next=${encodeURIComponent(`${request.nextUrl.pathname}${request.nextUrl.search}`)}`;
    return NextResponse.redirect(loginUrl);
  }

  const clientId = request.nextUrl.searchParams.get("client_id")?.trim() ?? "";
  const redirectUri = request.nextUrl.searchParams.get("redirect_uri")?.trim() ?? "";
  const state = request.nextUrl.searchParams.get("state")?.trim() ?? "";

  if (!clientId || !redirectUri || !state) {
    await auditRejected(request, "missing_required_parameter", user.id, clientId || null);
    return htmlPage("Invalid sign-in request", "The app sign-in request is missing required information.");
  }

  const [app, profile] = await Promise.all([
    getAppByClientId(clientId),
    getProfileById(user.id),
  ]);

  if (!profile?.is_active || profile.must_change_password) {
    await auditRejected(request, "account_blocked", user.id, clientId);
    return htmlPage("Sign-in blocked", "Your EkLink account cannot sign in to apps right now.", 403);
  }

  if (!app || !isAppLive(app)) {
    await auditRejected(request, "app_not_live", user.id, clientId);
    return htmlPage("App unavailable", "This app is not available for sign-in yet.", 404);
  }

  if (!app.callback_urls.includes(redirectUri)) {
    await auditRejected(request, "redirect_uri_mismatch", user.id, app.client_id);
    return htmlPage("Invalid redirect", "The app callback URL is not registered with EkLink.");
  }

  if (!canProfileUseApp(profile, app)) {
    await auditRejected(request, "role_not_allowed", user.id, app.client_id);
    return htmlPage("No access", "Your role does not have access to this app.", 403);
  }

  const code = randomCode();
  const admin = createAdminClient();
  const { error } = await admin.from("auth_codes").insert({
    code_hash: sha256Hex(code),
    user_id: profile.id,
    app_id: app.id,
    redirect_uri: redirectUri,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });

  if (error) {
    await auditRejected(request, "code_create_failed", user.id, app.client_id);
    return htmlPage("Sign-in failed", "EkLink could not create a sign-in code.", 500);
  }

  await writeAuditLog({
    actorId: user.id,
    action: "code_issued",
    target: app.client_id,
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
    details: { app_slug: app.slug },
  });

  const callback = new URL(redirectUri);
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", state);
  return NextResponse.redirect(callback);
}
