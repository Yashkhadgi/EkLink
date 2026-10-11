# EkLink: Rules

These rules apply to everyone working on EkLink and to every app that integrates with it. If a rule must be broken, record the reason and approval in `tracker.md` first.

## 1. Scope rules

1. EkLink does **identity only**: who the user is, their base role, and where they go next.
2. EkLink never contains approval, invoice, template, attendance or room-booking logic.
3. Fine-grained permissions inside an app belong to that app, enforced on its server.
4. Event- or club-specific roles (for example "hackathon incharge") live in the app that needs them, not in EkLink.
5. New features are added only if they serve the aim in `aim.md`. When in doubt, leave it out.

## 2. Account rules

1. Open signup is **disabled**. Accounts exist only for people in an admin-approved CSV.
2. `login_id` (PRN or employee/login ID) is the permanent unique key. Email may change.
3. The college email is the real Supabase login. No fake or placeholder emails.
4. A user sets their own password from the invite email. Admins never see or set passwords.
5. Deactivated users (`is_active = false`) cannot sign in or refresh tokens.
6. Role changes are made only by admins and are audit-logged.

## 3. Login and password rules

1. One field accepts PRN/login ID or college email.
2. PRN lookup happens on the **server**, never in the browser.
3. Wrong ID, wrong email and wrong password all return the **same generic message**.
4. Login, lookup and reset endpoints are rate limited; repeated failures cause a temporary lockout.
5. "Forgot password" always responds generically and never reveals whether an account exists.
6. Enforce a sensible minimum password length and block trivially weak passwords.
7. Never email passwords. Only send time-limited links.

## 4. Redirect and token rules

1. Redirect **only** to URLs registered in the `apps` table, using **exact match**.
2. No wildcards, no partial matches, no redirecting to a URL taken straight from user input.
3. Every `/authorize` request carries a `state` that the app verifies on return.
4. Authorization codes are random, stored hashed, valid about 60 seconds and single use. A reused code is rejected and logged.
5. Tokens never appear in URLs. The code is exchanged server-to-server with the client secret.
6. Identity tokens are signed asymmetrically, bound to one app by `aud`, and short-lived (about 15 minutes).
7. Apps must verify signature, `iss`, `aud` and `exp` on every token, on their backend.
8. Apps must not trust the role from a token for sensitive actions without their own server-side checks.

## 5. Secrets rules

1. No secret is ever committed to Git: service-role key, signing key, SMTP credentials, client secrets.
2. Secrets live only in server environment variables (Vercel/Render settings).
3. The Supabase **service-role key is never used in browser code** and never given a `NEXT_PUBLIC_` prefix.
4. Client secrets are stored hashed and shown to the app owner once at registration.
5. Rotate secrets on suspected leak, when a team member leaves, and at least once per semester.
6. Local, staging and production use different keys.
7. `.env*` files are in `.gitignore` from the first commit.

## 6. Cookie and browser rules

1. Session cookies are `HttpOnly`, `Secure`, `SameSite=Lax`.
2. Do not store tokens or personal data in `localStorage` or `sessionStorage`.
3. HTTPS only, with HSTS once the final domain is live.
4. Set security headers: CSP, frame protection, `Referrer-Policy`, `X-Content-Type-Options`.
5. CORS allows only registered app origins, and only where needed.

## 7. Database rules

1. Row Level Security is **on** for every table.
2. Users read only their own profile. All other access goes through server routes.
3. `auth_codes` and `audit_log` are never directly accessible from the client.
4. Schema changes are made through versioned migration files, never by hand-editing production.
5. Back up before bulk imports and before migrations.
6. Collect only the personal data EkLink needs (ID, name, email, role, department).

## 8. Admin rules

1. Admin routes re-check the caller's role on the server for every request.
2. Keep admins to the minimum number; name a primary and a backup admin.
3. Every admin action (import, role change, deactivate, force logout, app registration) is audit-logged with actor and time.
4. CSV imports use a dry-run preview before anything is written.
5. Bulk invites are sent in batches to stay within email limits.

## 9. App integration rules

1. Every app follows the contract in `architecture.md` section 9 and the onboarding checklist in `plan.md`.
2. Each app keeps its own sessions short and refreshes through EkLink.
3. Each app maps users by EkLink `sub` (with `login_id`/email as fallback) and never keeps its own password system once integrated.
4. An app must pass the standard test list before being listed on the dashboard: logout, expired token, reused code, wrong role, tampered return URL.
5. App authors never ask EkLink for direct database access.

## 10. Audit and privacy rules

1. Log: login success/failure, code issued/used/rejected, token refresh, admin actions, with time, actor and IP.
2. Never log passwords, codes, tokens or secrets.
3. Audit logs are readable only by authorised admins.
4. Real student and staff data is loaded only after the college agrees on data handling and retention.
5. Use dummy data for development and demos.

## 11. Code and repository rules

1. Work on branches; merge to `main` only through reviewed pull requests.
2. At least one other team member reviews every change that touches auth, redirects, tokens or secrets.
3. Keep dependencies minimal and run a dependency vulnerability scan regularly.
4. Write the code for the security rules first (redirect check, code exchange, rate limit), then the screens.
5. No `console.log` of sensitive values, even temporarily.
6. Naming: app names are `EkLink`, `TemplateOS`, `Infivoice`, `ApproveIt`, `Attendie`, `SlotIt`. Slugs are lowercase (`infivoice`).

## 12. Free-tier operating rules

1. Re-check Supabase, Vercel and Render pricing and limits before each phase, since they change.
2. Before any demo, confirm the Supabase project is not paused and backend services are awake.
3. Use custom SMTP before bulk invites.
4. Vercel's free tier is for non-commercial use; review terms before any commercial or paid deployment.

## 13. Documentation and tracking rules

1. After **every** meaningful piece of work, add an entry to `tracker.md` with date, time, author, what changed and what is next.
2. Any decision that changes the plan is recorded in the decision log in `tracker.md` and, if needed, in `plan.md` and `architecture.md`.
3. The five documents stay consistent: `aim.md` (why), `plan.md` (what and when), `architecture.md` (how), `rules.md` (constraints), `tracker.md` (what happened).
4. Do not delete tracker history; add corrections as new entries.

## 14. Decision rules

1. When security and convenience conflict, security wins.
2. When a feature could live in EkLink or in an app, it lives in the app.
3. Prefer configuration over code for apps, roles and domains.
4. Changes to this file need agreement from the whole team and a tracker entry.
