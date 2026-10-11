# EkLink: Architecture

## 1. System overview

```
                         ┌────────────────────────────────────┐
                         │              EkLink                │
                         │   Next.js (Vercel)                 │
                         │   • Login / set password / reset   │
                         │   • Dashboard + app registry       │
                         │   • /authorize  /token  /jwks      │
                         │   • Admin panel                    │
                         └───────────────┬────────────────────┘
                                         │
                              ┌──────────▼──────────┐
                              │      Supabase       │
                              │ • Auth (email+pass) │
                              │ • Postgres (RLS)    │
                              │ • profiles, apps,   │
                              │   auth_codes, audit │
                              └──────────▲──────────┘
                                         │ (users and roles)
      ┌──────────────┬──────────────┬────┴─────────┬──────────────┐
      ▼              ▼              ▼              ▼              ▼
 TemplateOS      Infivoice      ApproveIt       Attendie        SlotIt
 (own host)      (own host)     (own host)      (own host)      (own host)
```

Every app is a separate project with its own hosting and its own data. Apps never read EkLink's user table directly. They receive identity through EkLink's token and verify it with EkLink's public keys.

## 2. Components

| Component | Responsibility | Tech |
|---|---|---|
| EkLink web UI | Login, set/reset password, dashboard, profile, admin screens | Next.js App Router, React |
| EkLink server routes | PRN lookup, CSV import, `/authorize`, `/token`, JWKS, audit writes | Next.js route handlers (server only) |
| Supabase Auth | Email + password accounts, invites, password reset, sessions | Supabase |
| Supabase Postgres | `profiles`, `apps`, `auth_codes`, `audit_log` | Postgres with Row Level Security |
| Email | Invites and resets | Supabase built-in for testing, then Brevo/Resend SMTP |
| Client apps | Their own features; use EkLink only for identity | Any stack |

## 3. Why Next.js full-stack for EkLink

- One repo for the UI and the secure server code (PRN lookup, CSV import, code exchange).
- The Supabase service-role key and signing key stay on the server.
- Good Supabase cookie support for server-rendered pages.
- Free to start on Vercel (the free tier is meant for non-commercial use, which fits the prototype; review terms before any commercial use).
- Domain migration is configuration only.

## 4. Data model

```sql
-- Users known to the college. Supabase auth.users holds the credentials.
create table profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  login_id       text unique not null,          -- PRN (students) or employee/login ID (staff)
  college_email  text unique not null,
  name           text not null,
  role           text not null check (role in
                   ('student','faculty','staff','hod','director','finance','admin')),
  department     text,
  is_active      boolean not null default true,
  token_version  int not null default 1,        -- bump to invalidate issued app tokens
  failed_logins  int not null default 0,
  locked_until   timestamptz,
  last_login_at  timestamptz,
  created_at     timestamptz not null default now()
);

-- Registry of connected apps.
create table apps (
  id             uuid primary key default gen_random_uuid(),
  slug           text unique not null,          -- 'infivoice'
  name           text not null,
  url            text not null,
  callback_urls  text[] not null,               -- exact-match allowlist
  icon           text,
  allowed_roles  text[] not null,               -- who sees the card and may sign in
  client_id      text unique not null,
  client_secret_hash text not null,             -- store a hash, show the secret once
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

-- One-time authorization codes.
create table auth_codes (
  code_hash      text primary key,              -- hash of the code, never the code itself
  user_id        uuid not null references profiles(id),
  app_id         uuid not null references apps(id),
  redirect_uri   text not null,
  expires_at     timestamptz not null,          -- ~60 seconds
  used_at        timestamptz                    -- set on first exchange
);

create table audit_log (
  id             bigint generated always as identity primary key,
  at             timestamptz not null default now(),
  actor_id       uuid,
  action         text not null,                 -- login_ok, login_fail, code_issued, user_deactivated ...
  target         text,
  ip             inet,
  user_agent     text,
  details        jsonb
);
```

Row Level Security rules:

- `profiles`: a user may read only their own row; writes only through server routes using the service role; admin screens go through server routes that verify the caller's role.
- `apps`: readable through server routes only. Never expose `client_secret_hash`.
- `auth_codes` and `audit_log`: no direct client access at all.

## 5. Key flows

### 5.1 Account creation (invite)

1. Admin uploads a CSV: `login_id, name, college_email, role, department`.
2. Server validates every row (format, duplicates, allowed role) and shows a dry-run preview.
3. On confirm, server calls the Supabase admin API to invite each email (in batches) and inserts the matching `profiles` row.
4. User opens the invite link in their college mailbox and sets a password. Mailbox access is the proof of identity.
5. Open signup stays disabled in Supabase.

### 5.2 Login with PRN or email

1. User enters one identifier and a password.
2. Server route: if the input contains `@` it is an email; otherwise look up `profiles.login_id` to get `college_email`.
3. Check `is_active` and `locked_until`.
4. Authenticate with Supabase using email + password.
5. On failure: increment `failed_logins`, lock temporarily after a threshold, return the **same generic message** whether the ID, the email or the password was wrong.
6. On success: reset the counter, update `last_login_at`, write `login_ok`, set the Supabase session cookie (`HttpOnly`, `Secure`, `SameSite=Lax`).
7. The lookup route is rate-limited per IP and per identifier.

### 5.3 Signing in to an app (one-time code flow)

```
User        App (Infivoice)              EkLink                       Supabase
 │  open app      │                         │                              │
 │───────────────►│ no session              │                              │
 │◄───────────────│ redirect to EkLink      │                              │
 │  GET /authorize?client_id&redirect_uri&state                            │
 │────────────────────────────────────────►│ validate client + exact       │
 │                                         │ redirect_uri in apps table    │
 │                 (not logged in → login page, then continue)             │
 │                                         │ check role ∈ allowed_roles    │
 │                                         │ create code (60s, single use) │
 │◄────────────────────────────────────────│ 302 redirect_uri?code&state   │
 │  GET /auth/callback?code&state          │                              │
 │───────────────►│ verify state matches    │                              │
 │                │ POST /token (code, client_id, client_secret)           │
 │                │────────────────────────►│ hash code, check unused,      │
 │                │                         │ unexpired, matches app + uri  │
 │                │                         │ mark used                     │
 │                │◄────────────────────────│ signed identity token (JWT)   │
 │                │ verify via JWKS, map user, create own app session      │
 │◄───────────────│ signed in                                              │
```

Rules:

- `redirect_uri` must **exactly match** a value in `apps.callback_urls`. No wildcards, no partial matches.
- `state` is generated by the app and verified on return (blocks CSRF).
- The code is random, stored only as a hash, lives about 60 seconds and works once. A replayed code is rejected and logged.
- The code exchange happens server-to-server and requires the client secret. Tokens never travel in URLs.

### 5.4 Identity token (issued by `/token`)

Signed JWT, asymmetric (RS256 or ES256). EkLink holds the private key; apps verify using the public keys at `/.well-known/jwks.json`.

| Claim | Meaning |
|---|---|
| `iss` | EkLink issuer URL |
| `aud` | The app's `client_id` |
| `sub` | EkLink user ID |
| `login_id`, `email`, `name` | Identity |
| `role`, `department` | Base role and department |
| `ver` | `token_version` at issue time |
| `iat`, `exp` | Short life (about 15 minutes) |

Apps must check signature, `iss`, `aud`, `exp`, and use the role claim only for coarse access. Fine-grained permissions stay inside each app. When the token expires the app asks EkLink for a refresh; EkLink re-checks `is_active`, role and `token_version` before issuing a new one. This is how deactivation and force logout take effect within minutes.

### 5.5 Logout and force logout

- **User logout:** clears the EkLink session; apps' sessions end when their short-lived tokens expire or when the app calls the EkLink logout endpoint (the app clears its own session first).
- **Force logout (admin):** bump `token_version`, revoke Supabase sessions for that user, write `force_logout` to the audit log. Refresh fails everywhere from that point.

### 5.6 After the college domain is granted

- Cookie `Domain=.eklink.clg.edu.in`, `HttpOnly`, `Secure`, `SameSite=Lax`.
- Apps can read the shared session cookie and verify it, removing the redirect hop for already-signed-in users.
- The code flow stays available as the fallback for any app not on the domain.
- Only registry URLs and callback URLs change.

## 6. API surface (EkLink)

| Route | Purpose |
|---|---|
| `POST /api/auth/login` | PRN/email + password login |
| `POST /api/auth/logout` | End EkLink session |
| `POST /api/auth/forgot` | Send reset email (generic response) |
| `GET /authorize` | Start an app sign-in |
| `POST /token` | Exchange code for identity token (apps, server-to-server) |
| `POST /token/refresh` | Re-issue token after status/role re-check |
| `GET /.well-known/jwks.json` | Public keys for token verification |
| `GET /api/apps` | Apps visible to the current user's role |
| `/api/admin/*` | CSV import, users, apps, force logout, audit log (admin only, server-verified) |

## 7. Security architecture

| Layer | Control |
|---|---|
| Accounts | Invite-only from CSV, open signup disabled |
| Passwords | Handled by Supabase; minimum length policy; reset via email |
| Brute force | Rate limits (IP and identifier), temporary lockout, generic error |
| Redirects | Exact-match allowlist from the registry, `state` required |
| Codes | Random, hashed at rest, ~60s, single use |
| Tokens | Asymmetric signing, short expiry, `aud` bound to one app |
| Cookies | `HttpOnly`, `Secure`, `SameSite=Lax`; no tokens in localStorage |
| Secrets | Server environment variables only; client secrets stored hashed |
| Transport | HTTPS only, HSTS |
| Headers | CSP, `X-Frame-Options`/frame-ancestors, `Referrer-Policy`, `X-Content-Type-Options` |
| CORS | Only registered app origins where needed |
| Data access | Row Level Security on; service role only in server code |
| Auditing | Logins, failures, codes, admin actions, with actor, IP and time |
| Admin | Admin routes re-verify role on the server for every request |

## 8. Deployment

| Piece | Prototype | After domain |
|---|---|---|
| EkLink | Vercel (`*.vercel.app`) | Vercel with `eklink.clg.edu.in` |
| Database/Auth | Supabase free project | Same project (review plan limits) |
| Email | Supabase built-in then Brevo/Resend | Same SMTP |
| Other apps | Vercel/Render (`*.vercel.app`, `*.onrender.com`) | `<app>.eklink.clg.edu.in` |

Environments: `local`, `staging` (separate Supabase project if possible), `production`. Never share production keys with local or staging.

Environment variables (EkLink, server only unless noted):

```
NEXT_PUBLIC_SUPABASE_URL            (public)
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (public)
SUPABASE_SECRET_KEY                 (secret, server only)
EKLINK_ISSUER_URL
EKLINK_JWT_PRIVATE_KEY              (secret)
EKLINK_JWT_KEY_ID
RATE_LIMIT_STORE_URL                (secret, if using external store)
SMTP_* settings                     (secret, if custom SMTP)
```

## 9. Integration contract for an app

An app is "integrated" when it:

1. Is registered in the EkLink registry (URL, exact callback URLs, allowed roles) and holds its client ID and secret in server-only config.
2. Redirects unauthenticated users to `/authorize` with a fresh `state`.
3. Exposes a callback that verifies `state`, exchanges the code server-side, and verifies the returned token against JWKS.
4. Maps the EkLink identity to its own user record (by `sub`, with `login_id`/email as fallback), creating it on first sign-in.
5. Uses short sessions and refreshes through EkLink, so deactivation applies quickly.
6. Enforces its own permissions server-side and never trusts frontend checks.
7. Passes the test list: logout, expired token, reused code, wrong role, tampered return URL.

## 10. Known limits of the free prototype

- Supabase free projects can pause after inactivity.
- Built-in email sending is heavily limited; use custom SMTP before bulk invites.
- Render free services sleep when idle.
- Cookie SSO across different providers' domains is impossible until the shared parent domain exists; the code flow covers this.
- Free-tier terms and limits change. Re-check pricing pages before each phase.
