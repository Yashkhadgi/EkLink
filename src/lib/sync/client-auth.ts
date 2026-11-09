import "server-only";

import { getAppByClientId, isAppLive, verifyClientSecret, type RegisteredApp } from "@/lib/auth/oauth";
import { writeAuditLog } from "@/lib/security/audit";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { getClientIp, getUserAgent } from "@/lib/security/request";
import type { NextRequest } from "next/server";

function parseBasic(header: string | null) {
  if (!header?.toLowerCase().startsWith("basic ")) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
  } catch {
    return null;
  }
  const colon = decoded.indexOf(":");
  if (colon <= 0) return null;
  let clientId = decoded.slice(0, colon);
  let clientSecret = decoded.slice(colon + 1);
  // RFC 6749 2.3.1: credentials may be form-urlencoded inside Basic.
  try {
    clientId = decodeURIComponent(clientId);
    clientSecret = decodeURIComponent(clientSecret);
  } catch {
    // keep raw values
  }
  return clientSecret ? { clientId, clientSecret } : null;
}

export function unauthorized() {
  return Response.json(
    { error: "invalid_client" },
    { status: 401, headers: { "www-authenticate": 'Basic realm="eklink-sync"' } },
  );
}

/** Basic client-credential auth for the pull API, checked like /token. */
export async function authenticateSyncClient(request: NextRequest): Promise<RegisteredApp | null> {
  const ip = getClientIp(request) ?? "unknown";
  if (!checkRateLimit({ key: `sync:${ip}`, limit: 120, windowMs: 60_000 }).allowed) return null;

  const credentials = parseBasic(request.headers.get("authorization"));
  const app = credentials ? await getAppByClientId(credentials.clientId) : null;
  if (!credentials || !app || !isAppLive(app) || !verifyClientSecret(app, credentials.clientSecret)) {
    await writeAuditLog({
      action: "sync_pull_rejected",
      target: credentials?.clientId ?? null,
      ip: getClientIp(request),
      userAgent: getUserAgent(request),
    });
    return null;
  }
  return app;
}
