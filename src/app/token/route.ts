import { sha256Hex } from "@/lib/auth/crypto";
import { signAccessToken, tokenResponse } from "@/lib/auth/jwt";
import {
  canProfileUseApp,
  getAppByClientId,
  getProfileById,
  isAppLive,
  verifyClientSecret,
} from "@/lib/auth/oauth";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { getClientIp, getUserAgent } from "@/lib/security/request";
import { writeAuditLog } from "@/lib/security/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { type NextRequest } from "next/server";

type TokenBody = {
  grant_type?: string;
  code?: string;
  redirect_uri?: string;
  client_id?: string;
  client_secret?: string;
};

async function readBody(request: NextRequest): Promise<TokenBody> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await request.json()) as TokenBody;
  }
  const form = await request.formData();
  return Object.fromEntries(form.entries()) as unknown as TokenBody;
}

function jsonError(error: string, status = 400) {
  return Response.json({ error }, { status });
}

async function audit(
  request: NextRequest,
  action: "code_used" | "code_rejected",
  reason: string | null,
  actorId: string | null,
  target: string | null,
) {
  await writeAuditLog({
    actorId,
    action,
    target,
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
    details: reason ? { reason } : null,
  });
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request) ?? "unknown";
  const limited = checkRateLimit({ key: `token:${ip}`, limit: 60, windowMs: 60_000 });
  if (!limited.allowed) {
    await audit(request, "code_rejected", "rate_limited", null, null);
    return jsonError("rate_limited", 429);
  }

  let body: TokenBody;
  try {
    body = await readBody(request);
  } catch {
    await audit(request, "code_rejected", "invalid_body", null, null);
    return jsonError("invalid_request");
  }

  const grantType = String(body.grant_type ?? "");
  const code = String(body.code ?? "");
  const redirectUri = String(body.redirect_uri ?? "");
  const clientId = String(body.client_id ?? "");
  const clientSecret = String(body.client_secret ?? "");

  if (grantType !== "authorization_code" || !code || !redirectUri || !clientId || !clientSecret) {
    await audit(request, "code_rejected", "missing_or_invalid_parameter", null, clientId || null);
    return jsonError("invalid_request");
  }

  const app = await getAppByClientId(clientId);
  if (!app || !isAppLive(app) || !app.callback_urls.includes(redirectUri)) {
    await audit(request, "code_rejected", "invalid_client_or_redirect", null, clientId);
    return jsonError("invalid_client", 401);
  }

  if (!verifyClientSecret(app, clientSecret)) {
    await audit(request, "code_rejected", "invalid_client_secret", null, clientId);
    return jsonError("invalid_client", 401);
  }

  const admin = createAdminClient();
  const { data, error } = (await admin.rpc("consume_auth_code", {
    p_code_hash: sha256Hex(code),
    p_app_id: app.id,
    p_redirect_uri: redirectUri,
  })) as { data: { user_id: string }[] | null; error: { code?: string } | null };

  const userId = data?.[0]?.user_id;
  if (error || !userId) {
    await audit(request, "code_rejected", "invalid_or_used_code", null, app.client_id);
    return jsonError("invalid_grant", 400);
  }

  const profile = await getProfileById(userId);
  if (!profile || !canProfileUseApp(profile, app)) {
    await audit(request, "code_rejected", "account_or_role_blocked", userId, app.client_id);
    return jsonError("access_denied", 403);
  }

  const accessToken = await signAccessToken({ clientId: app.client_id, profile });
  await audit(request, "code_used", null, userId, app.client_id);
  return Response.json(tokenResponse(accessToken));
}
