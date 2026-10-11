# EkLink: Tracker

The single source of truth for what has been done, when, by whom, and what comes next. Update it after every meaningful piece of work (see `rules.md` section 13). Never delete old entries; add corrections as new entries.

## How to log an entry

Copy this template to the top of the **Progress log** (newest first):

```
### YYYY-MM-DD HH:MM (IST) | Author | Phase / area
**Work done:** what was actually completed
**Files / links:** commits, pull requests, docs, URLs
**Decisions:** any decision taken (also add to the Decision log)
**Problems:** issues faced, blockers, how they were handled
**Tests:** what was tested and the result
**Next:** the next concrete step and who owns it
```

Status keys: `Not started` | `In progress` | `Blocked` | `Done`

---

## Status board

| Phase | Area | Status | Owner | Updated |
|---|---|---|---|---|
| 0 | Decisions and access | In progress | TBD | 2026-10-10 |
| 1 | Foundation (repo, Supabase, tables, SMTP) | Not started | TBD | |
| 2 | Users and login (CSV, invite, PRN/email login, reset) | Not started | TBD | |
| 3 | Dashboard and app registry | Not started | TBD | |
| 4 | Redirect and one-time code flow, JWKS | Not started | TBD | |
| 5 | First integration: Infivoice | Not started | TBD | |
| 6 | Admin panel and hardening | Not started | TBD | |
| 7 | Remaining apps (ApproveIt, TemplateOS, Attendie, SlotIt) | Not started | TBD | |
| 8 | Domain migration (`eklink.clg.edu.in`) | Blocked (waiting for college IT) | TBD | 2026-10-10 |

## App integration board

| App | Registered | Sign-in flow added | Tests passed | Status |
|---|---|---|---|---|
| Infivoice | No | No | No | Not started |
| ApproveIt | No | No | No | Not started |
| TemplateOS | No | No | No | Not started |
| Attendie | No | No | No | Not started |
| SlotIt | No | No | No | Not started |

## Open questions

| # | Question | Owner | Status |
|---|---|---|---|
| 1 | Do all students and staff have working college emails? | TBD | Open |
| 2 | Fallback for people without a college email? | TBD | Open |
| 3 | What is the staff login ID, and is it unique? | TBD | Open |
| 4 | Who is the primary EkLink admin, and who is the backup? | TBD | Open |
| 5 | When will the IT head be approached about `eklink.clg.edu.in` and the wildcard? | TBD | Open |
| 6 | Is a college data-handling policy needed before loading real data? | TBD | Open |
| 7 | Should HOD/director sign-in require stronger verification later? | TBD | Open |

## Decision log

| # | Date | Decision | Reason |
|---|---|---|---|
| 1 | 2026-10-10 | Separate apps, each hosted independently, with EkLink as the shared portal | Keeps each app small and independently deployable |
| 2 | 2026-10-10 | Subdomain structure `<app>.eklink.clg.edu.in` | Branding under EkLink, cookie sharing limited to EkLink's apps |
| 3 | 2026-10-10 | Names: EkLink, TemplateOS, Infivoice, ApproveIt, Attendie, SlotIt | Team choice; Infivoice spelling confirmed (not InfoInvoice) |
| 4 | 2026-10-10 | Prototype on Supabase + Vercel/Render free tiers | No domain until the prototype is ready |
| 5 | 2026-10-10 | Real college email as Supabase login; PRN/login ID as linked unique identifier; no fake emails | Real email proves ownership for invite and reset |
| 6 | 2026-10-10 | Invite-only accounts from admin CSV; open signup disabled | Prevents anyone claiming someone else's PRN |
| 7 | 2026-10-10 | One-time code flow now, shared cookie after the domain exists | Works across different hosting domains, no rewrite later |
| 8 | 2026-10-10 | EkLink stack: Next.js (App Router) full-stack + Supabase on Vercel | One repo, server-only secrets, free to start |
| 9 | 2026-10-10 | Identity tokens signed asymmetrically and verified by apps via JWKS | Apps never hold a shared signing secret |

---

## Progress log (newest first)

### 2026-10-10 | Planning session | Phase 0
**Work done:**
- Defined the five-app suite and EkLink's role as identity-only portal.
- Finalised app names and the subdomain structure.
- Chose the sign-in model (college email + linked PRN/login ID, invite-only from CSV).
- Chose the app sign-in model (one-time code flow now, cookie SSO after the domain).
- Recommended and recorded the stack (Next.js full-stack + Supabase on Vercel).
- Drafted the project documents: `aim.md`, `plan.md`, `architecture.md`, `rules.md`, `tracker.md`.

**Files / links:** the five documents above.

**Decisions:** Decision log entries 1 to 9.

**Problems:** Domain not yet available; college email coverage and staff login ID unconfirmed (see Open questions).

**Tests:** None yet (planning only).

**Next:**
1. Team reviews the five documents and answers the Open questions.
2. Assign owners in the Status board.
3. Create the GitHub repo, Supabase project and Vercel project (Phase 1).
4. Approach the IT head about the domain in parallel.

*(Add new entries above this line.)*
