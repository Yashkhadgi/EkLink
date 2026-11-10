# ApproveIt + EkLink Integration Guide

This document is for the ApproveIt team. EkLink is the college identity portal;
ApproveIt remains responsible for its own approval data, permissions and app
sessions. ApproveIt must not access EkLink's Supabase database directly.

## What You Will Receive From EkLink

Before enabling sign-in, the EkLink owner registers ApproveIt and shares these
values through a private channel only:

```env
EKLINK_URL=https://ek-link-nine.vercel.app
EKLINK_ISSUER_URL=exact-deployed-value-confirmed-by-eklink-owner
EKLINK_CLIENT_ID=provided-by-eklink
EKLINK_CLIENT_SECRET=provided-once-by-eklink
EKLINK_REDIRECT_URI=https://YOUR-APP-DOMAIN/auth/callback
```

`EKLINK_CLIENT_SECRET` is server-only. Never commit it, put it in browser code,
send it in a client-side request, or store it in localStorage.

The EkLink owner must confirm the production issuer value. It is the exact
value configured as `EKLINK_ISSUER_URL` in the deployed portal; it must match
the JWT `iss` claim exactly, including protocol and any path.

## Register ApproveIt

The callback URL must be an exact string match. Different protocol, hostname,
port, path, trailing slash or query string means EkLink will reject it.

The EkLink owner can register production ApproveIt with this template:

```bash
node --env-file=.env.local scripts/register-app.mjs \
  --slug approveit \
  --name "ApproveIt" \
  --url "https://YOUR-APP-DOMAIN" \
  --callback "https://YOUR-APP-DOMAIN/auth/callback" \
  --roles student,faculty,staff,hod,director,finance,admin \
  --icon stamp \
  --description "Paperless multi-step approvals with e-sign and tracking" \
  --status live
```

If the existing `approveit` entry was already created as `coming_soon`, the
same command changes it to `live` while preserving its client secret. Use
`--rotate-secret` only after a suspected leak or when intentionally rotating a
secret.

For local development, register a separate app such as `approveit-local`:

```bash
node --env-file=.env.local scripts/register-app.mjs \
  --slug approveit-local \
  --name "ApproveIt Local" \
  --url "http://localhost:3000" \
  --callback "http://localhost:3000/auth/callback" \
  --roles student,faculty,staff,hod,director,finance,admin \
  --icon stamp \
  --description "Local ApproveIt development app" \
  --status live
```

Use the live EkLink URL while running ApproveIt locally. A local portal and a
local ApproveIt app cannot both use port `3000` at the same time.

## Sign-In Flow

```text
Browser -> ApproveIt -> EkLink /authorize -> ApproveIt callback
                                      |             |
                                      |             -> ApproveIt server POST /token
                                      |                            |
                                      +----------------------------+-> signed JWT
```

1. A user opens ApproveIt without an ApproveIt session.
2. ApproveIt generates a cryptographically random `state`, stores it in an
   HttpOnly, Secure cookie or server-side session, then redirects the browser
   to EkLink.
3. EkLink checks the user session, account status, forced-password-change flag,
   registered callback URL and allowed role.
4. EkLink redirects to ApproveIt's callback with `code` and `state`.
5. ApproveIt verifies `state` before doing anything with the code.
6. ApproveIt's server exchanges the code for a short-lived JWT.
7. ApproveIt verifies the JWT and creates its own app session.

### Redirect To EkLink

Build this URL on the ApproveIt server:

```text
{EKLINK_URL}/authorize?client_id={EKLINK_CLIENT_ID}&redirect_uri={EKLINK_REDIRECT_URI}&state={STATE}
```

`state` is mandatory. Generate a new high-entropy value for every sign-in
attempt and reject the callback if it does not match the saved value.

## Callback Handling

ApproveIt's callback route receives:

```text
GET /auth/callback?code=ONE_TIME_CODE&state=STATE
```

Required callback checks:

1. Check that `state` exists and equals the stored value.
2. Consume/delete the stored state immediately after a successful comparison.
3. Exchange `code` only from the ApproveIt server. Never exchange it from the
   browser.
4. Create an ApproveIt session only after JWT verification succeeds.

## Exchange The Authorization Code

Send either JSON or form data to EkLink:

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

Success response:

```json
{
  "access_token": "SIGNED_JWT",
  "token_type": "Bearer",
  "expires_in": 900
}
```

Important behavior:

- An authorization code is random, valid for 60 seconds and usable once.
- A reused, expired or mismatched code returns `invalid_grant`.
- An incorrect client secret or callback URL is rejected.
- Access is denied if the account is inactive, needs a password change or the
  current role is not allowed for ApproveIt.

## Verify The JWT

EkLink signs access tokens with `ES256`. Fetch the public signing key from:

```text
{EKLINK_URL}/.well-known/jwks.json
```

ApproveIt's backend must verify all of these before trusting claims:

- Signature using the JWKS public key selected by `kid`.
- Algorithm is `ES256`.
- `iss` exactly equals `EKLINK_ISSUER_URL`.
- `aud` exactly equals this ApproveIt registration's `EKLINK_CLIENT_ID`.
- `exp` has not passed.
- `sub` is present.

Example with `jose` on the ApproveIt server:

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

## Identity Claims

After successful verification, EkLink provides:

| Claim | Meaning |
|---|---|
| `sub` | Stable EkLink user UUID; use this as the primary external identity key. |
| `login_id` | Student PRN or staff login ID. |
| `email` | College email. |
| `name` | User name. |
| `role` | `student`, `faculty`, `staff`, `hod`, `director`, `finance` or `admin`. |
| `department` | Department, possibly `null`. |
| `batch` | Student batch, possibly `null`. |
| `section` | Student section, possibly `null`. |
| `ver` | Token version; changes after force logout/security actions. |
| `iat`, `exp` | Issued and expiry times. |

Create or update the local ApproveIt user on first sign-in. Map by `sub` first.
Use `login_id`, then `email`, only as migration fallbacks. Do not use email as
the permanent primary key.

## Roles And ApproveIt Permissions

EkLink controls whether a broad role may sign in to ApproveIt. ApproveIt must
still enforce its own detailed permissions on its backend, for example:

- who can start an approval;
- who is an approver for a specific document;
- approval order and escalation;
- access to individual records.

Never rely solely on frontend role checks or on a role sent from a browser.

## EkLink Platform Reference For ApproveIt

This section answers the implementation questions that usually come up before
an app team starts building. It reflects the current EkLink codebase. A point
marked **not available yet** is deliberately not a promise or an API contract.

### 1. Stack

| Area | EkLink today | What it means for ApproveIt |
|---|---|---|
| Frontend | Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4 and Lucide icons | Next.js + TypeScript is a good fit, but matching the stack is optional. The SSO contract is HTTP/JWT based. |
| Backend | Next.js Route Handlers and server-only TypeScript modules | There is no separate Express/Django API service to call. |
| Authentication | Supabase Auth, with EkLink login routes around it | ApproveIt must use EkLink SSO, not share Supabase Auth credentials. |
| Database | Supabase Postgres with Row Level Security | Do not connect ApproveIt directly to EkLink's database. Keep ApproveIt's workflow data in its own database. |
| Hosting | Vercel for the current EkLink deployment | ApproveIt can deploy independently to Vercel or another compatible host. |

### 2. Authentication Contract

EkLink has its own college login experience backed by Supabase Auth. A user
signs into the portal with a PRN/login ID or college email and password; the
portal session is a server-managed Supabase cookie. ApproveIt does not receive
that cookie or a Supabase token.

Instead, ApproveIt uses the authorization-code flow documented above:

1. Redirect the browser to `GET {EKLINK_URL}/authorize` with `client_id`,
   exact `redirect_uri` and a fresh `state`.
2. Receive a one-time code at ApproveIt's callback.
3. Have the ApproveIt server call `POST {EKLINK_URL}/token` with its client
   secret.
4. Verify the returned ES256 JWT through EkLink's JWKS endpoint.
5. Create an ApproveIt-owned session.

The access token is a short-lived JWT (currently 15 minutes). It is not stored
in browser localStorage. An app can obtain a replacement through
`POST {EKLINK_URL}/token/refresh`, from its server only. See the refresh
section below for the exact request.

The production `iss` value is the exact deployed `EKLINK_ISSUER_URL`
configuration, not an assumed URL. The EkLink owner must provide it together
with the production client credentials. Verify `ES256`, `iss`, `aud`, `exp`
and `sub` on every token; do not use a shared JWT secret or Supabase service
key.

Illustrative decoded payload shape, using placeholders rather than a real
user's data:

```json
{
  "iss": "https://issuer-confirmed-by-eklink-owner",
  "aud": "approveit-client-id",
  "sub": "EKLINK-USER-UUID",
  "login_id": "PRN-OR-STAFF-ID",
  "email": "college-email@example.edu",
  "name": "User Name",
  "role": "student",
  "department": "Department Name",
  "batch": "2026",
  "section": "A",
  "ver": 1,
  "iat": 0,
  "exp": 0
}
```

Portal logout cannot directly erase ApproveIt's cookie because the apps are
separate sites. ApproveIt clears its own session on local logout. On refresh,
EkLink rejects inactive users, users with `must_change_password`, users whose
role no longer has access and users with a changed token version. Treat that
failure as a forced sign-out in ApproveIt.

### 3. User And Role Data

EkLink currently has these broad roles:

```text
student, faculty, staff, hod, director, finance, admin
```

They are stored in the EkLink profile and included as the `role` JWT claim.
An app registration also has an `allowed_roles` list, which controls who can
see/open that app and complete SSO. This is broad eligibility only; ApproveIt
must implement its own per-workflow and per-record authorization.

The available profile claims are `sub`, `login_id`, `email`, `name`, `role`,
`department`, `batch` and `section`. `sub` is a UUID and is the stable key to
store as `eklink_user_id`. There is currently no `semester` claim. Student
batch/section may be null; faculty records use the same profile model, and
batch/section are normally null for faculty.

There is no public "get profile by user ID" API for apps, and no permission for
apps to query `profiles` directly. Provision or update a minimal local
ApproveIt user record at SSO sign-in. Keep only the identity fields that are
needed for the product; do not make email the permanent identity key.

Do not add office-specific titles such as HOD office staff, Hack-o-week
incharge, Exam Department or Director office as global EkLink roles without a
schema change and EkLink team approval. Model these as ApproveIt-specific
assignments or permissions tied to `eklink_user_id`.

### 4. App Structure, Navigation And Notifications

ApproveIt should be a separate application with its own URL/subdomain and
deployment, not an iframe and not a route inside the EkLink codebase. EkLink
dashboard cards send the user into the SSO flow, then to ApproveIt.

EkLink has its own portal header/layout, but no reusable shared component,
package or design system is published for external apps today. ApproveIt may
visually align with it, but should own its own layout and UI code. There is
also no shared cross-app notification tab or notification API currently.
ApproveIt should build and store its own application notifications until the
college team defines a shared service.

### 5. Hosting, Environments, CORS And Files

EkLink is currently deployed on Vercel. The intended arrangement is for every
college app to deploy independently, commonly on its own subdomain. The exact
production hostname for ApproveIt must be decided before registration because
the callback URL is an exact-match allowlist entry.

The SSO exchange does not require browser CORS: it is a browser redirect,
followed by a server-to-server `/token` request. Keep the client secret and
token exchange route on ApproveIt's server. If ApproveIt later adds browser
calls to its own backend, configure CORS only for its actual frontend origins.

EkLink has no shared attachment-storage service today. Do not assume Firebase
Storage, S3, Cloudinary or Supabase Storage is already available for ApproveIt.
ApproveIt needs its own approved storage decision before handling application
attachments. Store file metadata and authorization in ApproveIt's database,
protect downloads with server-side authorization and prefer short-lived signed
URLs rather than public file URLs.

### 6. Database Boundaries And Future Shared Services

EkLink's identity data lives in Supabase Postgres. Its profile primary key is
a UUID, and that UUID appears as JWT `sub`. This is the cross-app user ID
format to use. EkLink itself uses tables such as `profiles`, `apps`,
`auth_codes` and `audit_log`; they are not a shared app database.

There is no approved common business database, common schema or migration plan
for all college apps today. The current plan is: each app owns its data and
integrates identity via EkLink SSO. A future shared approval engine or design
system is a possible later project, not a dependency for ApproveIt's first
release. Do not couple ApproveIt migrations, workflow tables or attachments to
EkLink tables.

### 7. Repository And Coding Conventions

ApproveIt should be a separate repository/project, with its own environment
variables, database migrations, deployment and release process. Use feature
branches and code review before merging to its default branch.

For consistency with EkLink, prefer TypeScript, server-side secret handling,
explicit validation at API boundaries and concise JSON responses. EkLink
generally returns successful JSON as `{ "ok": true, ... }` and failures as
`{ "error": "..." }`, but there is no formal cross-repository response
standard yet. Never commit secrets, log JWTs/codes/passwords, or expose
server-only variables with a public browser prefix.

### Availability And Decisions Still Needed

| Topic | Current answer |
|---|---|
| Local test app | Supported. Register a separate `approveit-local` entry with `http://localhost:3000/auth/callback`, provided that exact callback is approved and registered. |
| Staging | No independent shared staging environment is confirmed yet. Use separate credentials and, when available, a separate Supabase project for staging. Never reuse production secrets. |
| Test users | The EkLink owner must provide them privately if needed. Do not place login credentials in docs, repositories or group chats. |
| Production issuer | Must be supplied by the EkLink owner from deployed `EKLINK_ISSUER_URL`; do not infer it from the portal's visible URL. |
| Profile lookup API | Not available. Use verified JWT claims and local provisioning. |
| Shared notifications | Not available. |
| Shared file storage | Not available. |
| Common app database | Not planned for the initial integration. |

## Short Message For The ApproveIt Team

```text
ApproveIt will be a separate app and will sign users in through EkLink SSO.
EkLink is Next.js + TypeScript + Tailwind on Vercel, backed by Supabase Auth
and Postgres. Do not connect to EkLink's Supabase database directly.

Please build the login as an authorization-code flow: redirect to EkLink
/authorize, validate state in /auth/callback, exchange the one-time code from
the ApproveIt server at /token, then verify the ES256 JWT against EkLink JWKS.
Verify issuer, audience, expiry and sub. Use JWT sub (UUID) as
eklink_user_id; the token also includes login_id, email, name, role,
department, batch and section. Semester and a profile lookup API are not
available today.

EkLink roles only control broad access. Keep all approval chains, office
assignments, notifications, files and detailed permissions in ApproveIt's own
database. We do not currently have a shared notification service, file storage
service, common business database or reusable UI package.

Before implementation, we need to register both the production and local
callback URLs, receive client_id/client_secret and the exact production issuer
privately, and confirm the final ApproveIt hostname and attachment storage.
```

## Sessions, Refresh And Logout

EkLink access tokens expire after 15 minutes. ApproveIt should keep its own
session in an HttpOnly, Secure cookie and refresh on its server before expiry.

```bash
curl -X POST "$EKLINK_URL/token/refresh" \
  -H "content-type: application/json" \
  -d '{
    "client_id": "'"$EKLINK_CLIENT_ID"'",
    "client_secret": "'"$EKLINK_CLIENT_SECRET"'",
    "access_token": "OLD_ACCESS_TOKEN"
  }'
```

During refresh, EkLink checks the signature of the old token, even if it has
expired, then checks the user is still active, has no forced password change,
still has an allowed role and has the same token version.

On ApproveIt logout, clear the ApproveIt session. Portal logout does not
directly delete another app's cookie; short token lifetimes and failed refresh
handle deactivation and force logout.

## Error Handling

Treat token and refresh failure as a signed-out state:

- `invalid_client`: configuration or client-secret problem; log safely for the
  ApproveIt operator, never show the secret.
- `invalid_grant`: bad, expired or reused code/token; begin sign-in again.
- `access_denied`: user inactive, password change required, role no longer
  allowed, or token version changed; clear the local session and explain that
  portal access is unavailable.
- `429`: wait and retry later; do not automatically loop requests.

Do not log authorization codes, access tokens, client secrets or passwords.

## Pre-Launch Checklist

- [ ] Production callback URL is registered exactly.
- [ ] ApproveIt registration status is `live`.
- [ ] `client_secret` exists only in server-side environment variables.
- [ ] `state` is generated, stored and verified once per login attempt.
- [ ] JWT signature, `ES256`, issuer, audience and expiry are verified server-side.
- [ ] Local user mapping uses `sub`.
- [ ] App session uses an HttpOnly, Secure cookie.
- [ ] Reused code is rejected.
- [ ] Invalid `state` is rejected.
- [ ] Tampered callback URL is rejected by EkLink.
- [ ] Wrong-role, inactive-user and forced-password-change cases are tested.
- [ ] Expired-token refresh and force-logout behavior are tested.

## Support Boundary

EkLink owns authentication, identity and broad role eligibility. ApproveIt owns
its database, approval workflows, app-level authorization and its own session.
For registration, callback changes, secret rotation or user-access incidents,
contact the EkLink owner.
