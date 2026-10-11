import {
  signAccessToken,
  tokenResponse,
  verifySignatureAllowExpired,
} from "@/lib/auth/jwt";
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
import { type NextRequest } from "next/server";

type RefreshBody = {
  client_id?: string;
  client_secret?: string;
  access_token?: string;
  token?: string;
};

async function readBody(request: NextRequest): Promise<RefreshBody> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await request.json()) as RefreshBody;
  }
  const form = await request.formData();
  return Object.fromEntries(form.entries()) as unknown as RefreshBody;
}

function jsonError(error: string, status = 400) {
  return Response.json({ error }, { status });
}

async function auditRefresh(
  request: NextRequest,
  reason: string | null,
  actorId: string | null,
  target: string | null,
) {
  await writeAuditLog({
    actorId,
    action: reason ? "code_rejected" : "token_refreshed",
    target,
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
    details: reason ? { reason } : null,
  });
}

function audienceMatches(aud: string | string[] | undefined, clientId: string) {
  return Array.isArray(aud) ? aud.includes(clientId) : aud === clientId;
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request) ?? "unknown";
  const limited = checkRateLimit({ key: `token-refresh:${ip}`, limit: 60, windowMs: 60_000 });
  if (!limited.allowed) {
    await auditRefresh(request, "rate_limited", null, null);
    return jsonError("rate_limited", 429);
  }

  let body: RefreshBody;
  try {
    body = await readBody(request);
  } catch {
    await auditRefresh(request, "invalid_body", null, null);
    return jsonError("invalid_request");
  }

  const clientId = String(body.client_id ?? "");
  const clientSecret = String(body.client_secret ?? "");
  const oldToken = String(body.access_token ?? body.token ?? "");

  if (!clientId || !clientSecret || !oldToken) {
    await auditRefresh(request, "missing_parameter", null, clientId || null);
    return jsonError("invalid_request");
  }

  const app = await getAppByClientId(clientId);
  if (!app || !isAppLive(app) || !verifyClientSecret(app, clientSecret)) {
    await auditRefresh(request, "invalid_client", null, clientId);
    return jsonError("invalid_client", 401);
  }

  let payload;
  try {
    payload = await verifySignatureAllowExpired(oldToken);
  } catch {
    await auditRefresh(request, "invalid_token_signature", null, app.client_id);
    return jsonError("invalid_grant", 400);
  }

  if (
    payload.iss !== process.env.EKLINK_ISSUER_URL ||
    !audienceMatches(payload.aud, app.client_id) ||
    !payload.sub ||
    typeof payload.ver !== "number"
  ) {
    await auditRefresh(request, "invalid_token_claims", null, app.client_id);
    return jsonError("invalid_grant", 400);
  }

  const profile = await getProfileById(payload.sub);
  if (!profile || !canProfileUseApp(profile, app) || profile.token_version !== payload.ver) {
    await auditRefresh(request, "account_role_or_version_blocked", payload.sub, app.client_id);
    return jsonError("access_denied", 403);
  }

  const accessToken = await signAccessToken({ clientId: app.client_id, profile });
  await auditRefresh(request, null, profile.id, app.client_id);
  return Response.json(tokenResponse(accessToken));
}
