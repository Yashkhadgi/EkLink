# Attendie + EkLink Integration Guide

This document is for the Attendie team. EkLink is the college identity portal;
Attendie remains responsible for attendance data, event rules, organisation
membership, coordinator permissions and its own application session. Attendie
must not access EkLink's Supabase database directly.

## What The EkLink Owner Provides Privately

Before enabling sign-in, the EkLink owner registers Attendie and sends the
following values only through a private channel:

```env
EKLINK_URL=https://ek-link-nine.vercel.app
EKLINK_ISSUER_URL=exact-deployed-value-confirmed-by-eklink-owner
EKLINK_CLIENT_ID=provided-by-eklink
EKLINK_CLIENT_SECRET=provided-once-by-eklink
EKLINK_REDIRECT_URI=https://YOUR-ATTENDIE-DOMAIN/auth/callback
```

`EKLINK_CLIENT_SECRET` is server-only. Never commit it, expose it through a
`NEXT_PUBLIC_` variable, put it in browser code, or send it to the client.

The production issuer must be confirmed from the deployed
`EKLINK_ISSUER_URL` configuration. Do not assume it from the visible portal
URL. It must equal the token's `iss` claim character-for-character.

## Register Attendie

EkLink checks callback URLs as exact registered strings. Differences in
protocol, hostname, port, path, trailing slash or query string are rejected.

The EkLink owner can register production Attendie with this template:

```bash
node --env-file=.env.local scripts/register-app.mjs \
  --slug attendie \
  --name "Attendie" \
  --url "https://YOUR-ATTENDIE-DOMAIN/" \
  --callback "https://YOUR-ATTENDIE-DOMAIN/auth/callback" \
  --roles student,faculty,staff,hod,director,finance,admin \
  --icon user-check \
  --description "Attendance, event participation and coordination" \
  --status live
```

For local development, register a separate client. The local callback is not
a wildcard: the exact localhost URL and port must be registered.

```bash
node --env-file=.env.local scripts/register-app.mjs \
  --slug attendie-local \
  --name "Attendie Local" \
  --url "http://localhost:3000/" \
  --callback "http://localhost:3000/auth/callback" \
  --roles student,faculty,staff,hod,director,finance,admin \
  --icon user-check \
  --description "Local Attendie development app" \
  --status live
```

Use the deployed EkLink URL while testing Attendie locally. EkLink and
Attendie cannot both bind to localhost port `3000` at the same time.

## Launch URL From The Portal

For a live app card, EkLink opens the app registration's configured `url`
directly. It does not append an SSO code and it does not force a route such as
`/auth/login`.

Recommended registration value:

```text
https://YOUR-ATTENDIE-DOMAIN/
```

Attendie's `/` route should check its local session. When there is no session,
it can redirect internally to `/auth/login` or immediately begin the EkLink
flow. The public callback route remains `/auth/callback`.

## Sign-In Flow

```text
Browser -> Attendie -> EkLink /authorize -> Attendie callback
                                      |             |
                                      |             -> Attendie server POST /token
                                      |                            |
                                      +----------------------------+-> signed JWT
```

1. User opens the Attendie card from EkLink.
2. Attendie sees no valid local session, creates a high-entropy `state`, stores
   it in an HttpOnly Secure cookie or server session, then redirects the
   browser to EkLink.
3. EkLink checks the portal session, account status, password-change status,
   registered callback and role eligibility.
4. EkLink redirects to Attendie's callback with `code` and `state`.
5. Attendie verifies and consumes `state` before using the code.
6. Attendie's server exchanges the one-time code for a short-lived JWT.
7. Attendie verifies the JWT and creates an Attendie-owned session.

Redirect URL format:

```text
{EKLINK_URL}/authorize?client_id={EKLINK_CLIENT_ID}&redirect_uri={EKLINK_REDIRECT_URI}&state={STATE}
```

The `state` value is mandatory and must be unique for every sign-in attempt.

## Token Exchange And Confirmed Errors

Exchange codes from the Attendie server only. EkLink accepts JSON or form data.

```bash
curl -X POST "$EKLINK_URL/token" \
  -H "content-type: application/json" \
  -d '{
    "grant_type": "authorization_code",
    "code": "CODE_FROM_CALLBACK",
    "redirect_uri": "'"$EKLINK_REDIRECT_URI"'",
    "client_id": "'"$EKLINK_CLIENT_ID"'",
    "client_secret": "'"$EKLINK_CLIENT_SECRET"'"
  }'
```

Successful response:

```json
{
  "access_token": "SIGNED_JWT",
  "token_type": "Bearer",
  "expires_in": 900
}
```

`/token` and `/token/refresh` return JSON errors in this shape:

```json
{ "error": "error_code" }
```

| Situation | Endpoint response |
|---|---|
| Malformed or missing required request fields | `400 { "error": "invalid_request" }` |
| Invalid app, inactive/not-live app, bad client secret, or unregistered callback at `/token` | `401 { "error": "invalid_client" }` |
| Reused, expired, mismatched or otherwise invalid authorization code | `400 { "error": "invalid_grant" }` |
| Bad token signature or invalid `iss`/`aud`/`sub`/`ver` at refresh | `400 { "error": "invalid_grant" }` |
| Inactive user, forced password change, disallowed role, missing profile, or revoked token version after a code/token was otherwise valid | `403 { "error": "access_denied" }` |
| Rate limited | `429 { "error": "rate_limited" }` |

An authorization code lasts 60 seconds and is single use. A user who becomes
inactive or has a forced password change cannot complete `/authorize`; the
portal shows an HTML `403` page before a code is issued. If the account is
blocked after a code has been issued, `/token` returns `403 access_denied`.

## JWT Verification

EkLink signs tokens using `ES256`. Fetch the public key set from:

```text
{EKLINK_URL}/.well-known/jwks.json
```

Verify on the Attendie server:

- signature against the JWKS key selected by `kid`;
- `alg` is exactly `ES256`;
- `iss` equals `EKLINK_ISSUER_URL` exactly;
- `aud` equals Attendie's assigned `EKLINK_CLIENT_ID`;
- `exp` is still valid; and
- `sub` exists.

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(
  new URL(`${process.env.EKLINK_URL}/.well-known/jwks.json`),
);

const { payload } = await jwtVerify(accessToken, jwks, {
  algorithms: ["ES256"],
  issuer: process.env.EKLINK_ISSUER_URL,
  audience: process.env.EKLINK_CLIENT_ID,
});
```

The endpoint returns the currently active public signing key with `kid`,
`alg: "ES256"` and `use: "sig"`. Key rotation is not yet a documented
multi-key rollover contract. Attendie should use a JWKS client that caches and
refetches keys when it sees an unfamiliar `kid`; the EkLink owner must notify
app teams before rotating the signing key.

## Confirmed JWT Claims

After verification, the JWT contains:

| Claim | Meaning |
|---|---|
| `iss` | Exact configured EkLink issuer URL. |
| `aud` | Attendie's registered client ID. |
| `sub` | Stable EkLink user UUID. Store as `eklink_user_id`. |
| `login_id` | Student PRN or staff login ID. |
| `email` | College email address. |
| `name` | User name. |
| `role` | Broad EkLink role. |
| `department` | Department or `null`. |
| `batch` | Student batch or `null`. |
| `section` | Student section or `null`. |
| `ver` | Token version; changes after force logout/security actions. |
| `iat`, `exp` | Standard issue and expiry timestamps. |

The currently supported roles are:

```text
student, faculty, staff, hod, director, finance, admin
```

Organisation/club membership and event coordinator are not EkLink global
roles today. Model them as Attendie-specific membership and coordinator
assignments using `eklink_user_id`. Do not infer them from `faculty` or `staff`
without an Attendie-side assignment.

There is no `semester` JWT claim and no general app API for reading arbitrary
EkLink profiles. On verified sign-in, create or update a minimal local
Attendie user record keyed by `sub`. Do not use email as the permanent key.

## Expiry, Refresh And Logout

Access tokens expire in 900 seconds (15 minutes). There is no separately
issued refresh token. Instead, Attendie's backend submits the current access
token to EkLink's refresh endpoint along with its client credentials:

```bash
curl -X POST "$EKLINK_URL/token/refresh" \
  -H "content-type: application/json" \
  -d '{
    "client_id": "'"$EKLINK_CLIENT_ID"'",
    "client_secret": "'"$EKLINK_CLIENT_SECRET"'",
    "access_token": "OLD_ACCESS_TOKEN"
  }'
```

EkLink verifies the old token's signature even when it has expired, then
checks issuer, audience, user existence, account activity, forced-password
change, allowed role and token version. On success it returns a newly signed
15-minute access token. On `access_denied` or `invalid_grant`, clear the
Attendie session and start sign-in again when appropriate.

Portal logout does not erase Attendie's separate-site cookie. Attendie must
clear its own session on Attendie logout. Short expiry plus refresh-time checks
ensure that deactivation and force logout take effect.

## Attendie Authorization Boundary

EkLink's `allowed_roles` decides only broad access to the app. Attendie must
enforce all detailed access rules on its own backend, including:

- event creation and editing;
- attendance marking and correction;
- organisation/club membership;
- event coordinator permissions;
- visibility of event and attendance records; and
- reports or exports.

Never use client-supplied role data as authorization proof. Never make
frontend-only permission checks the enforcement layer.

## Read-Only Information To Confirm With The EkLink Owner

The following is ready to send. It deliberately asks only for implementation
information and excludes credentials, passwords and production secrets.

```text
For Attendie integration, please confirm these read-only details:

1. Exact production JWT iss value (the deployed EKLINK_ISSUER_URL).
2. Confirmed JWT claim schema: sub, login_id, email, name, role, department,
   batch, section, ver, exp and aud; please mention any nullable fields.
3. Allowed role values, and whether organisation/club and event-coordinator
   responsibilities remain Attendie-side assignments rather than EkLink roles.
4. Access-token expiry and /token/refresh behaviour. We understand it is a
   15-minute access token and refresh uses the old access token, not a separate
   refresh token; please confirm.
5. /token and /token/refresh error format plus status codes.
6. Expected result for an inactive user, a reused/expired code and a revoked
   user/token version.
7. JWKS URL and signing-key rotation process, including advance notice and
   whether old/new keys overlap during rotation.
8. The exact portal-card launch URL for Attendie. We expect the registered app
   URL to open directly, with Attendie routing unauthenticated users itself.
9. Confirm that redirect URI matching is exact, including localhost port and
   trailing slash, and list the localhost callback URLs approved for testing.
10. The latest integration guide without credentials or production secrets.
```

## Pre-Launch Checklist

- [ ] Production and local callbacks are registered exactly.
- [ ] Attendie app status is `live` and its configured launch URL is correct.
- [ ] `client_secret` is server-only and absent from commits/logs/browser code.
- [ ] A fresh cryptographic `state` is stored and verified once per sign-in.
- [ ] JWT verification checks signature, `ES256`, `iss`, `aud`, `exp` and `sub`.
- [ ] Local Attendie users are keyed by JWT `sub`.
- [ ] Organisation and coordinator permissions live in Attendie's backend.
- [ ] Reused code, inactive account, forced password change and revoked token
  version are tested.
- [ ] Attachment/storage decisions, if Attendie accepts files, are approved.
