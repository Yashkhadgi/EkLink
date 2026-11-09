import "server-only";

import {
  SignJWT,
  compactVerify,
  decodeJwt,
  exportJWK,
  importJWK,
  importPKCS8,
  type JWTPayload,
} from "jose";

const ALG = "ES256";
const TOKEN_TTL_SECONDS = 15 * 60;

export type TokenProfile = {
  id: string;
  login_id: string;
  college_email: string;
  name: string;
  role: string;
  department: string | null;
  batch: string | null;
  section: string | null;
  token_version: number;
  // Organization tree (optional so older callers keep compiling).
  platform_role?: string | null;
  semester?: number | null;
  org_code?: string | null;
  institute_code?: string | null;
  department_code?: string | null;
};

export type EklinkTokenPayload = JWTPayload & {
  sub: string;
  login_id: string;
  email: string;
  name: string;
  role: string;
  department: string | null;
  batch: string | null;
  section: string | null;
  ver: number;
  platform_role: string | null;
  semester: number | null;
  org_code: string | null;
  institute_code: string | null;
  department_code: string | null;
};

function issuer() {
  const value = process.env.EKLINK_ISSUER_URL;
  if (!value) throw new Error("EKLINK_ISSUER_URL is not set");
  return value;
}

function keyId() {
  const value = process.env.EKLINK_JWT_KEY_ID;
  if (!value) throw new Error("EKLINK_JWT_KEY_ID is not set");
  return value;
}

async function privateKey() {
  const pem = process.env.EKLINK_JWT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!pem) throw new Error("EKLINK_JWT_PRIVATE_KEY is not set");
  return importPKCS8(pem, ALG, { extractable: true });
}

async function publicKey() {
  const jwk = await exportJWK(await privateKey());
  delete jwk.d;
  return importJWK(jwk, ALG);
}

/** The access-token signing key, kid and issuer (reused for sync event pushes). */
export async function signingMaterial() {
  return { key: await privateKey(), kid: keyId(), issuer: issuer() };
}

export async function publicJwk() {
  const jwk = await exportJWK(await privateKey());
  delete jwk.d;
  return {
    ...jwk,
    kid: keyId(),
    alg: ALG,
    use: "sig",
  };
}

export async function signAccessToken({
  clientId,
  profile,
}: {
  clientId: string;
  profile: TokenProfile;
}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    login_id: profile.login_id,
    email: profile.college_email,
    name: profile.name,
    role: profile.role,
    department: profile.department,
    batch: profile.batch,
    section: profile.section,
    ver: profile.token_version,
    // Added for the central user directory; `role` above keeps its old values.
    platform_role: profile.platform_role ?? null,
    semester: profile.semester ?? null,
    org_code: profile.org_code ?? null,
    institute_code: profile.institute_code ?? null,
    department_code: profile.department_code ?? null,
  })
    .setProtectedHeader({ alg: ALG, kid: keyId(), typ: "JWT" })
    .setIssuer(issuer())
    .setAudience(clientId)
    .setSubject(profile.id)
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_TTL_SECONDS)
    .sign(await privateKey());
}

export async function verifySignatureAllowExpired(token: string) {
  await compactVerify(token, await publicKey(), { algorithms: [ALG] });
  return decodeJwt<EklinkTokenPayload>(token);
}

export function tokenResponse(accessToken: string) {
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: TOKEN_TTL_SECONDS,
  };
}
