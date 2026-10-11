# EkLink: Aim

## One-line aim

EkLink is the single secure front door to every college application: **one login, one dashboard, one identity**, for students, faculty, staff and authorities.

## The problem

Official college work (applications, approvals, attendance requests, room bookings, finance paperwork, formatted reports) is slow, manual and scattered:

- Documents are written by hand or formatted manually, then carried from desk to desk.
- Nobody can see where an application is stuck.
- Each new software would need its own accounts, passwords and security, which is wasteful and unsafe.

The college is therefore building several small applications instead of one bulky one. They all need a common, trustworthy way to answer: **who is this person, what is their role, and which app should they go to?** EkLink answers exactly that, and nothing more.

## What EkLink must be

- **One identity:** a user signs in once and is recognised by every app.
- **Simple for users:** sign in with PRN (or login ID) or college email, plus a password they set themselves.
- **Secure by default:** only pre-approved college members can have accounts, and redirects go only to registered apps.
- **Easy to extend:** adding a new app means adding one registry row and following a short integration contract, with no EkLink code changes.
- **Free to run during the prototype** (Supabase and Vercel free tiers), with a clean path to the college domain.

## What EkLink must not be

- It does not do the work of any app (no approvals, invoices, templates, attendance or rooms).
- It does not decide what a user can do *inside* an app. Each app owns its own permissions. EkLink only supplies identity and base role.
- It is not a public signup site.
- It is not a legal digital-signature (Aadhaar eSign) system.

## The apps it connects

| App | Purpose |
|---|---|
| **TemplateOS** | Fill a form, get a correctly formatted official document or report |
| **Infivoice** | Finance paperwork: invoices, reimbursements, extraction, finance approval |
| **ApproveIt** | Paperless multi-step approval with e-sign and tracking |
| **Attendie** | Attendance *requests* and event attendance lists (not marking; Moodle handles that) |
| **SlotIt** | Clash-free room and lab requests and allotment |

## Final verdict (what "good" looks like)

The project is a success when all of the following are true:

1. A student or staff member can set a password from an invite email, sign in with PRN or email, and see a dashboard with only the apps their role allows.
2. Clicking an app card lands them inside that app already signed in, with no second login.
3. A tampered, unregistered or expired redirect/code is rejected every time.
4. An admin can import users by CSV, deactivate a user, force logout, register a new app, and read the audit log.
5. At least one real app (Infivoice) is integrated end to end and tested for logout, expired code, wrong role and wrong return URL.
6. Moving to the college domain (`eklink.clg.edu.in`) needs configuration changes only, not code rewrites.
7. Nothing sensitive (secrets, service-role key, tokens in URLs) is ever exposed in the browser or the repository.

## Guiding principles

1. **Identity only.** EkLink stays small. If a feature is not about who someone is or where they go next, it belongs in an app.
2. **Security before convenience.** When the two conflict, security wins.
3. **Config, not code.** New apps, roles and domains should be configuration.
4. **Free first, upgradeable later.** Prototype on free tiers without designing ourselves into a corner.
5. **Write it down.** Every decision and every piece of progress goes into the tracker.

## Success measures (after pilot)

- Login success rate and average time to sign in
- Number of users onboarded versus users imported
- Failed or blocked login attempts, and rejected redirects (should be non-zero, which shows the checks work)
- Number of apps integrated without changes to EkLink code
- Zero security incidents involving leaked tokens or secrets
