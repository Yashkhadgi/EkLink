import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { constantTimeEqualHex, sha256Hex } from "./crypto";

export type RegisteredApp = {
  id: string;
  slug: string;
  name: string;
  callback_urls: string[];
  allowed_roles: string[];
  client_id: string;
  client_secret_hash: string;
  is_active: boolean;
  status: "live" | "coming_soon";
};

export type AuthProfile = {
  id: string;
  login_id: string;
  college_email: string;
  name: string;
  role: string;
  department: string | null;
  batch: string | null;
  section: string | null;
  is_active: boolean;
  must_change_password: boolean;
  token_version: number;
};

export async function getAppByClientId(clientId: string) {
  const admin = createAdminClient();
  const { data, error } = (await admin
    .from("apps")
    .select(
      "id, slug, name, callback_urls, allowed_roles, client_id, client_secret_hash, is_active, status",
    )
    .eq("client_id", clientId)
    .maybeSingle()) as { data: RegisteredApp | null; error: { code?: string } | null };

  if (error) throw new Error(`app_lookup_failed:${error.code ?? "error"}`);
  return data;
}

export async function getProfileById(userId: string) {
  const admin = createAdminClient();
  const { data, error } = (await admin
    .from("profiles")
    .select(
      "id, login_id, college_email, name, role, department, batch, section, is_active, must_change_password, token_version",
    )
    .eq("id", userId)
    .maybeSingle()) as { data: AuthProfile | null; error: { code?: string } | null };

  if (error) throw new Error(`profile_lookup_failed:${error.code ?? "error"}`);
  return data;
}

export function isAppLive(app: RegisteredApp) {
  return app.is_active && app.status === "live";
}

export function canProfileUseApp(profile: AuthProfile, app: RegisteredApp) {
  return (
    profile.is_active &&
    !profile.must_change_password &&
    app.allowed_roles.includes(profile.role)
  );
}

export function verifyClientSecret(app: RegisteredApp, clientSecret: string) {
  return constantTimeEqualHex(sha256Hex(clientSecret), app.client_secret_hash);
}
