# EkLink: Plan and Roadmap

## 1. Overview

EkLink is the central authentication and navigation portal for the college application suite. This document covers the scope, the phases, the integration plan, the risks and the open questions.

See also: `aim.md` (why), `architecture.md` (how), `rules.md` (constraints), `tracker.md` (progress).

## 2. The application suite

| App | Subdomain (final) | Purpose | Status |
|---|---|---|---|
| EkLink | `eklink.clg.edu.in` | Portal: auth, dashboard, redirection | Planning |
| TemplateOS | `templateos.eklink.clg.edu.in` | Form to formatted document/report | Existing project |
| Infivoice | `infivoice.eklink.clg.edu.in` | Finance paperwork and extraction | Partly built |
| ApproveIt | `approveit.eklink.clg.edu.in` | Multi-step approval, e-sign, tracking | Planning |
| Attendie | `attendie.eklink.clg.edu.in` | Attendance requests and event lists | Planning |
| SlotIt | `slotit.eklink.clg.edu.in` | Room and lab allotment | Planning |

Each app is a separate project with separate hosting. Shared pieces: identity (EkLink), a design system, and later a shared approval engine.

### Short overview of the other apps (for integration context)

- **TemplateOS:** users fill a form; a ready template produces the formatted document. Event reports can pull selected attendees from Attendie.
- **Infivoice:** vendor invoices and reimbursements with extraction, validation, duplicate detection and export. Student forms are out of scope. It already has its own login/register, which must be replaced by EkLink sign-in.
- **ApproveIt:** a student submits an application (e.g. hackathon permission); it goes through faculty incharge, admin staff (attendance check and sign), HOD (attendance threshold, special cases allowed), then director/PA. Authorities e-sign inside the app and the student can track progress. The chain should be configuration, not code, so other apps can reuse it.
- **Attendie:** event managers select who attended and send the list to admin; students request attendance from a faculty member; managers can request on behalf of a team. It is not an attendance marking system (Moodle remains the source).
- **SlotIt:** departments, clubs and faculty request rooms or labs, see availability, avoid clashes, and keep a written record. May reuse the approval engine for its approval step.

## 3. EkLink scope

### In scope

- Sign in with PRN/login ID or college email plus password
- Invite-based account creation from admin CSV
- First-time password setup, forgot password, change password
- Dashboard with role-filtered app cards
- Profile page
- App registry and secure redirect with one-time code
- Token issuing and verification for apps (JWKS)
- Admin panel: CSV import, user management, app registration, force logout, audit log
- Security controls (rate limits, lockout, allowlisted redirects, audit)

### Out of scope

- Any app business logic (approvals, invoices, templates, attendance, rooms)
- In-app permissions of other apps
- Public signup
- Legal-grade digital signatures
- Moodle integration (later, if ever)

## 4. Decisions made

| # | Decision | Date |
|---|---|---|
| 1 | Separate apps, each hosted independently; EkLink as the shared portal | 2026-10-10 |
| 2 | Subdomain-based structure, final form `<app>.eklink.clg.edu.in` | 2026-10-10 |
| 3 | App names: EkLink, TemplateOS, Infivoice, ApproveIt, Attendie, SlotIt | 2026-10-10 |
| 4 | Prototype on free tiers: Supabase (auth + DB), Vercel/Render (hosting) | 2026-10-10 |
| 5 | No fake emails. Real college email is the Supabase login; PRN/login ID is a linked unique identifier | 2026-10-10 |
| 6 | Accounts created only from admin CSV via invite; open signup disabled | 2026-10-10 |
| 7 | App sign-in via one-time authorization code now; shared cookie after the domain is available | 2026-10-10 |
| 8 | EkLink stack: Next.js (App Router) full-stack + Supabase, deployed on Vercel | 2026-10-10 |

## 5. Roadmap

Durations are estimates for a small student team and should be adjusted in `tracker.md`.

### Phase 0: Decisions and access (Week 0 to 1)

- [ ] Confirm every student and staff member has a working college email
- [ ] Decide the fallback for people without one (admin-verified manual onboarding)
- [ ] Confirm the staff login ID and that it is unique
- [ ] Decide the role list and who administers EkLink
- [ ] Request IT head / director permission for `eklink.clg.edu.in` and `*.eklink.clg.edu.in` (can run in parallel)
- [ ] Create GitHub repo, Supabase project, Vercel project

### Phase 1: Foundation (Week 1 to 2)

- [ ] Next.js project setup, environment variables, secrets handling
- [ ] Database: `profiles`, `apps`, `auth_codes`, `audit_log`, with Row Level Security
- [ ] Disable open signup in Supabase; configure site URL and redirect URLs
- [ ] Configure custom SMTP (Brevo/Resend free) to avoid the built-in email limit

### Phase 2: Users and login (Week 2 to 4)

- [ ] Admin CSV import with validation and a dry-run preview
- [ ] Batched invite sending
- [ ] Set-password page (from invite link)
- [ ] Login with PRN/email lookup on the server, same generic error, rate limit, lockout
- [ ] Forgot/reset password and change password
- [ ] Logout

### Phase 3: Dashboard and registry (Week 4 to 5)

- [ ] App registry table and admin screen to register apps
- [ ] Dashboard showing only role-allowed cards
- [ ] Profile page

### Phase 4: Redirect and app sign-in (Week 5 to 7)

- [ ] `/authorize` with return-URL allowlist check and `state`
- [ ] One-time code issuing (hashed, short expiry, single use)
- [ ] `/token` exchange authenticated with client ID and secret
- [ ] Signed identity token with `/.well-known/jwks.json`
- [ ] Short-lived app tokens plus refresh check (active user, role)
- [ ] Integration guide for app developers (SDK or snippet)

### Phase 5: First integration, Infivoice (Week 7 to 8)

- [ ] Replace Infivoice login/register with the EkLink flow
- [ ] Match or create the Infivoice user by login ID or email
- [ ] Decide what happens to existing Infivoice test users
- [ ] Test: logout, expired code, reused code, wrong role, wrong return URL, deactivated user

### Phase 6: Admin and hardening (Week 8 to 10)

- [ ] Admin panel: users, deactivate, force logout, audit log viewer
- [ ] Security review against `rules.md`
- [ ] Dependency scan, secret rotation, header and CORS check
- [ ] Backup and restore check for the Supabase project

### Phase 7: Remaining apps (ongoing)

- [ ] ApproveIt, TemplateOS, Attendie, SlotIt integrate one by one using the same checklist
- [ ] Shared navbar/design-system package

### Phase 8: Domain migration (when the domain is granted)

- [ ] DNS records and wildcard, HTTPS on every app
- [ ] Switch to shared cookie on `.eklink.clg.edu.in`
- [ ] Update the registry URLs and callback URLs
- [ ] Re-test every integrated app

## 6. App onboarding checklist (reuse for each app)

1. Host the app and note its URL.
2. Register it in the EkLink admin: name, URL, callback URL, icon, allowed roles.
3. Receive the client ID and secret; store the secret in the app's server environment only.
4. Add the sign-in redirect, callback handler and token verification.
5. Map the EkLink identity to the app's own user record.
6. Test: logout, expired token, wrong role, tampered return URL.
7. Record it in `tracker.md`.

## 7. Roles

Base roles stored in EkLink: `student`, `faculty`, `staff`, `hod`, `director`, `finance`, `admin`.

Event- or club-specific responsibilities (for example "hackathon incharge") are **not** EkLink roles. They are relations stored by the app that needs them (ApproveIt, Attendie). EkLink may later expose a designation field, but app-level relations stay in apps.

## 8. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| College does not grant the domain | No cookie SSO | One-time code flow works without it; keep it permanently as the fallback |
| Not everyone has a college email | Cannot invite them | Admin-verified manual onboarding path |
| Supabase free email limit | Invites fail in bulk | Custom SMTP, send in batches |
| Supabase free project pauses after inactivity | Demo breaks | Check before demos; keep light activity; upgrade if needed |
| Render free backends sleep | Slow first request | Warn users, or use always-on options later |
| Open redirect or code theft | Account takeover | Registry allowlist, single-use hashed codes, short expiry, `state` |
| Leaked service-role key or client secret | Full compromise | Server-only env vars, no commits, rotation procedure |
| Team scope creep into app logic | EkLink becomes bulky | Enforce "identity only" in `rules.md` |
| Free-tier limits change | Plan breaks | Re-check pricing pages before each phase |

## 9. Open questions

1. Do all students and staff have working college emails?
2. What is the staff login ID, and is it unique across staff?
3. Who is the EkLink admin (person and backup)?
4. When will the IT head be approached about the domain?
5. Is a college-wide privacy/data-handling policy required before real student data is loaded?
6. Should any role (director, HOD) require stronger sign-in (for example email OTP) later?

## 10. Definition of done for the prototype

Phases 1 to 5 complete, with Infivoice integrated and the test list in Phase 5 passing, and the tracker and docs up to date.
