# EkLink ⚡

> **The Central Identity Provider (IdP) & Single Sign-On (SSO) Backbone for Campus Ecosystems**

[![Next.js](https://img.shields.io/badge/Next.js-16.4-black?style=flat&logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-blue?style=flat&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat&logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.0-38bdf8?style=flat&logo=tailwindcss)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL%20%7C%20Auth-3ECF8E?style=flat&logo=supabase)](https://supabase.com/)
[![Security](https://img.shields.io/badge/Cryptography-ES256%20%7C%20JWKS-green?style=flat&logo=auth0)](https://datatracker.ietf.org/doc/html/rfc7517)
[![OAuth 2.0](https://img.shields.io/badge/OAuth-2.0%20%7C%20OIDC-orange?style=flat&logo=openid)](https://oauth.net/2/)

EkLink eliminates fragmented campus software, duplicate student/faculty rosters, and password fatigue. Operating as an enterprise-grade identity gateway, EkLink enables students and faculty to authenticate once with their **PRN (Roll Number) or official college email** and securely navigate across independently hosted campus web applications.

---

## 🏛️ System Architecture

EkLink decouples identity and access management from application business logic. Connected sub-apps never store passwords, seed duplicate user rosters, or access EkLink's database directly.

```
                         ┌────────────────────────────────────┐
                         │              EkLink                │
                         │   Next.js (Edge & App Router)      │
                         │   • PRN & Email Smart Login        │
                         │   • Adaptive Role Dashboard        │
                         │   • /authorize  /token  /jwks      │
                         │   • Central Admin & CSV Importer   │
                         └───────────────┬────────────────────┘
                                         │
                               ┌──────────▼──────────┐
                               │      Supabase       │
                               │ • Auth & Sessions   │
                               │ • Postgres (RLS)    │
                               │ • apps & profiles   │
                               │ • audit_log & codes │
                               └──────────▲──────────┘
                                          │ (ES256 Signed Identity)
       ┌──────────────┬──────────────┬────┴─────────┬──────────────┐
       ▼              ▼              ▼              ▼              ▼
   TemplateOS     ApproveIt      Attendie        SlotIt        Infivoice
 (Live Hosted)  (Live Hosted)  (Coming Soon)  (Coming Soon)  (Finance Ops)
```

---

## ✨ Key Capabilities

### 🔐 Dual-Identifier Smart Authentication
* Authenticate with either **PRN / Employee ID** or **Official College Email**.
* Server-side identifier resolution ensures zero client-side credential exposure.
* Native brute-force rate-limiting and temporary account lockout protection.

### 🎯 Adaptive Role-Based Dashboard
* Dynamically filters visible tools based on verified college roles:
  `student` • `faculty` • `staff` • `hod` • `director` • `finance` • `admin`.
* Prioritizes **Live** tools on top with one-click SSO launch; clearly labels **Coming Soon** microservices.

### 🛡️ OIDC / OAuth 2.0 Authorization Code Flow
* Standards-compliant authorization code exchange.
* Single-use, cryptographically random, 60-second authorization codes (stored strictly as SHA-256 hashes).
* Compulsory `state` verification to neutralize Cross-Site Request Forgery (CSRF).

### 🔑 Cryptographic ES256 Tokens via JWKS
* Identity tokens signed using Elliptic Curve Cryptography (**ECDSA with P-256 and SHA-256**).
* Public verification keys published at standard endpoint: `/.well-known/jwks.json`.
* Client applications mathematically verify signatures without network bottlenecks or shared signing keys.

### 🏢 Central Directory & Bulk Provisioning
* 1-Click Excel / CSV bulk onboarding for thousands of students and faculty.
* Pre-flight dry-run engine checks syntax, duplicates, and role schemas before insertion.
* Safe invitation workflow: users set passwords through time-limited email links.

### ⚡ Central App Registry & Secret Lifecycle
* Register micro-services in seconds with custom slugs, callback URLs, and allowed roles.
* Exact string-match callback allowlisting (blocks open redirects and phishing).
* On-the-fly client secret rotation directly via administrative CLI tools.

### 🔍 Forensic Audit Logging
* Comprehensive audit trail tracking `login_ok`, `login_fail`, `code_issued`, `code_rejected`, and `force_logout`.
* Captures actors, IP addresses, user agents, target apps, and failure diagnostics for institutional compliance.

---

## 🚀 Connected Campus Ecosystem

| Application | Description | Integration Status | SSO Launch |
| :--- | :--- | :---: | :---: |
| **ApproveIt** | Paperless multi-step academic approvals with e-sign and tracking | 🟢 **Live** | One-Click SSO |
| **TemplateOS** | Form-to-document generator for circulars, reports, and notices | 🟢 **Live** | One-Click SSO |
| **Attendie** | Event participation, attendance lists, and student requests | 🟡 **Coming Soon** | In Progress |
| **SlotIt** | Academic room, lab, and equipment allotment scheduling | 🟡 **Coming Soon** | In Progress |
| **Infivoice** | Finance paperwork, reimbursement extraction, and verification | ⚪ **Planned** | Planned |

---

## 🔌 Integrating Sub-Apps (The 3-Step Model)

Sub-apps integrate with EkLink through standard OAuth 2.0 / OIDC protocols.

### 1. App Registration (EkLink Owner)
The EkLink administrator registers the client app with its exact redirect URL:
```bash
node --env-file=.env.local scripts/register-app.mjs \
  --slug your-app \
  --name "Your App Name" \
  --url "https://your-app.vercel.app" \
  --callback "https://your-app.vercel.app/auth/callback" \
  --roles all \
  --icon stamp \
  --description "Description of your application" \
  --status live
```
This produces the application's unique `EKLINK_CLIENT_ID` and server-only `EKLINK_CLIENT_SECRET`.

### 2. Initiate Sign-In (Redirect to EkLink)
The client app initiates sign-in by redirecting the user's browser:
```text
GET {EKLINK_URL}/authorize?client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&state={RANDOM_STATE}
```

### 3. Server-Side Token Exchange
When EkLink redirects back to `{REDIRECT_URI}?code={CODE}&state={STATE}`, the client server exchanges the code:
```http
POST {EKLINK_URL}/token
Content-Type: application/json

{
  "grant_type": "authorization_code",
  "code": "<ONE_TIME_CODE>",
  "redirect_uri": "https://your-app.vercel.app/auth/callback",
  "client_id": "<EKLINK_CLIENT_ID>",
  "client_secret": "<EKLINK_CLIENT_SECRET>"
}
```

#### Verified Identity Claims (Decoded ES256 JWT Payload):
```json
{
  "iss": "https://ek-link-nine.vercel.app",
  "aud": "your-app_client_id",
  "sub": "49b54b93-28d4-4b0f-a6e2-a7c7d20a03d8",
  "login_id": "24070521137",
  "email": "student@college.edu.in",
  "name": "Student Name",
  "role": "student",
  "department": "CSE",
  "batch": "2024-2028",
  "section": "A",
  "ver": 1,
  "iat": 1731234000,
  "exp": 1731234900
}
```

---

## 📂 Project Structure

```text
EkLink/
├── md/                            # Architecture, rules, and integration guides
│   ├── architecture.md            # System design & threat model
│   ├── rules.md                   # Strict architectural boundaries
│   ├── approveit-integration.md   # ApproveIt SSO specification
│   ├── attendie-integration.md    # Attendie SSO specification
│   └── tracker.md                 # Project decision and progress log
├── scripts/                       # Administrative & provisioning CLI tools
│   ├── register-app.mjs           # Register & rotate app client credentials
│   ├── import-users.mjs           # High-concurrency Excel/CSV user provisioning
│   └── generate-jwt-keys.mjs      # ES256 Keypair generator for JWKS
├── supabase/                      # Database configuration & migrations
│   └── migrations/                # Versioned SQL migrations (RLS, tables, RPCs)
├── src/
│   ├── app/
│   │   ├── (auth)/                # Login, password reset, and confirmation flows
│   │   ├── .well-known/jwks.json/ # Public JWKS key distribution endpoint
│   │   ├── admin/                 # Management panels (users, apps, audit log)
│   │   ├── authorize/             # OAuth2 /authorize endpoint
│   │   ├── dashboard/             # Role-adaptive application launcher
│   │   ├── token/                 # OAuth2 /token and /token/refresh endpoints
│   │   └── api/                   # Server-only route handlers
│   └── lib/
│       ├── auth/                  # JWT signing, crypto, and OAuth validation
│       ├── security/              # Rate-limiting, audit dispatch, redirect checks
│       └── supabase/              # Server & admin database clients
```

---

## 🛠️ Getting Started (Local Development)

### 1. Prerequisites
* **Node.js**: `v20.x` or later (LTS recommended)
* **npm**: `v10.x` or later
* **Supabase**: Active Supabase project with database & authentication enabled.

### 2. Installation
```bash
git clone https://github.com/Yashkhadgi/EkLink.git
cd EkLink
npm install
```

### 3. Generate Cryptographic Signing Keys
Generate an ES256 keypair for signing JWTs:
```bash
node scripts/generate-jwt-keys.mjs
```

### 4. Configure Environment Variables
Copy `.env.example` to `.env.local` and populate the values:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
SUPABASE_SECRET_KEY=your-supabase-service-role-key

EKLINK_ISSUER_URL=http://localhost:3000
EKLINK_JWT_KEY_ID=eklink-key-id-from-script
EKLINK_JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

### 5. Apply Database Migrations
Run the SQL scripts in `supabase/migrations/` sequentially in your Supabase SQL editor:
* `0001_init.sql` — Profiles, apps, auth codes, and audit tables with Row Level Security (RLS).
* `0002_user_provisioning.sql` — Password setup and invite tracking.
* `0003_revoke_user_sessions.sql` — Security revocation functions.
* `0004_app_registry_metadata.sql` — App status and display metadata.

### 6. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the portal.

---

## 🛡️ Security & Privacy Guarantees

* **Zero Password Leakage:** Passwords are never emailed, logged, or visible to administrators.
* **HttpOnly & SameSite Cookies:** All session cookies enforce `HttpOnly`, `Secure`, and `SameSite=Lax`.
* **Database Row Level Security (RLS):** Strict PostgreSQL RLS policies guarantee users can only read their own profile row.
* **Tamper-Evident Tokens:** Short 15-minute token TTL with cryptographic revocation via profile `token_version`.
* **Audience Isolation:** Each access token is bound to a single client application ID (`aud`).

---

## 📄 License

Internal Institutional Project — Designed and developed for campus administration and students.
All rights reserved.
