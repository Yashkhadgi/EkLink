# Proposal: Central Admin & Delegated Sub-App Admin Architecture

**Status:** Under Consideration / Saved for Future Discussion  
**Date Logged:** 2026-11-02  
**Context:** Scale and permission management across 4–5 integrated sub-apps (ApproveIt, Attendie, SlotIt, Infivoice, TemplateOS).

---

## 1. The Core Problem Statement

Currently, sub-apps have to manually seed or manage roles, departments, and designations in their own databases. If a user’s role or department changes (e.g., a faculty member becomes HOD, or department is missing/null in the token), sub-apps experience permission mismatches and require manual database edits.

---

## 2. The Proposed Solution (2-Tier Admin System)

### Tier 1: EkLink Super Admin (Central Directory Admin)
- **Master User Directory:** College office / IT uploads students and faculty via Excel/CSV.
- **Single Source of Truth:** Central control over `login_id`, `name`, `college_email`, `role` (`student`, `faculty`, `hod`, `director`, `finance`, `admin`), and `department` (`CSE`, `AIML`, etc.).
- **App Registry & Admin Delegation:** Super admin registers sub-apps and assigns 1–2 App Admins per sub-app (e.g., assigning Workflow Admin for ApproveIt or Timetable Admin for Attendie).

### Tier 2: Delegated Sub-App Admins
- Each sub-app gets designated admins configured inside EkLink.
- When a user logs in via SSO, EkLink includes delegated app permissions inside identity token claims:
  ```json
  {
    "sub": "user-uuid",
    "name": "Dr. Nitin Rakesh",
    "role": "director",
    "department": "CSE",
    "app_roles": {
      "approveit": ["workflow_admin"],
      "attendie": ["viewer"]
    }
  }
  ```

---

## 3. Architectural Analysis & Review

### Strengths (Why this is valuable)
1. **Single Source of Truth:** Centralizing identity attributes (`login_id`, `role`, `department`) eliminates data drift and the need for manual user seeding across sub-apps.
2. **Just-In-Time (JIT) Provisioning:** Sub-apps can upsert local user records on initial login using the verified token claims (`sub`, `role`, `department`), completely eliminating manual DB pre-seeding.
3. **Delegated Administration:** Offloads day-to-day administrative burdens from Central IT to authorized sub-app leads.

### Critical Traps & Architectural Red Lines to Avoid
1. **Audience Leakage (Token Bloat & Security):**
   - *Trap:* Sending `{ "app_roles": { "approveit": [...], "attendie": [...] } }` leaks other app permissions to the client app and increases token size.
   - *Requirement:* Standard OAuth2 tokens must strictly scope claims to the token's `aud` (Audience / Client ID). In ApproveIt's token, include only ApproveIt's assigned roles (e.g., `"app_roles": ["admin"]`).
2. **Coarse-Grained vs Fine-Grained RBAC Boundary:**
   - *Trap:* Letting EkLink store granular app logic (e.g., `stage_2_approver`, `budget_signatory`). This violates `rules.md` (Section 1: "EkLink does identity only"). Any app feature change would require an EkLink DB/UI schema update.
   - *Requirement:* EkLink assigns top-level coarse roles (e.g., `app_role: "admin"` vs `app_role: "user"`). Domain-specific workflow rules stay inside the sub-app, driven by the user's verified central attributes (`role: hod`, `department: CSE`).
3. **IT Bottleneck Prevention:**
   - App-level permissions and delegations must not require filing tickets with college IT for every minor workflow adjustment.

---

## 4. Recommended Refined Implementation

### A. Scoped Token Payload (per Client ID)
```json
{
  "iss": "https://eklink.clg.edu.in",
  "aud": "approveit-client-id",
  "sub": "user-uuid",
  "login_id": "FAC1024",
  "email": "nitin.rakesh@clg.edu.in",
  "name": "Dr. Nitin Rakesh",
  "role": "director",
  "department": "CSE",
  "app_roles": ["admin"],
  "ver": 1,
  "exp": 1730536000
}
```

### B. EkLink Database Extension (Lightweight Junction)
```sql
-- Track delegated administrators per registered application
create table app_user_roles (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references apps(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'admin', -- 'admin', 'manager'
  created_at timestamptz default now(),
  unique(app_id, user_id, role)
);

create index idx_app_user_roles on app_user_roles(app_id, user_id);
```

---

## 5. Next Steps for Discussion
- [ ] Align with sub-app leads (ApproveIt, Attendie) on the distinction between coarse app roles (`admin`) vs in-app workflow permissions.
- [ ] Finalize UI screen in EkLink Admin (`/admin/apps/[id]/delegations`) for assigning app administrators.
- [ ] Update integration guidelines and token documentation once formally approved.
