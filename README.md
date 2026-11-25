<div align="center">

# OSS Splitwise

**An open-source Splitwise clone — real accounts, friends by email, groups, and settle-up.**
Split expenses with anyone, keep a running balance, and settle up. No demo data, no mock logins.

[Live app](https://oss-splitwise.vercel.app) · [Features](#-features) · [Quick start](#-quick-start) · [Security](#-security) · [Architecture](#-architecture)

</div>

---

## ✨ Features

- **Real sign-up & login** — email + password with mandatory email verification
- **Friends by email** — add anyone, even before they have an account; they claim their placeholder (and its expenses) when they sign up and verify
- **Expenses anywhere** — inside groups *or* directly between friends, with equal / exact / percentage splits
- **Splitwise-style dashboard** — total balance, *you owe*, *you are owed*, per-friend and per-group balances
- **Settle up** — record real payments between friends, in groups, or globally
- **Receipts** — upload receipt images (Vercel Blob in production), manual itemization
- **Charts, search & export** — per-group spending charts, full expense search, JSON data export
- **Pro-tier extras** — Trip Pass, default split settings, feature flags, multi-currency (static rates)

> 💰 **Money is always integer cents.** Exchange rates are scaled integers (rate × 1,000,000).
> No floats for money or rates anywhere in the core math (`lib/splits.ts`, `lib/debt.ts`, `lib/balances.ts`).

---

## 🚀 Quick start

### Option A — Docker Compose (app + database)

```bash
cp .env.example .env
docker compose up --build
# → http://localhost:3000  (compose pushes the schema, seeds reference data, starts the app)
```

### Option B — Local

```bash
cp .env.example .env          # point DATABASE_URL at your Postgres
docker compose up db -d       # just Postgres — or use your own / a Neon database
npm install
npx prisma generate
npx prisma db push            # or: npx prisma migrate dev
npm run db:seed               # reference data only: currency rates + feature flags
npm run dev                   # → http://localhost:3000
```

Then **sign up**, verify your email, and add friends by email or create a group.

> 📧 **Email in development:** with no `RESEND_API_KEY` set, verification and reset
> emails (including the links) are logged to the server console instead of sent.

---

## 🧱 Tech stack

| Layer | Choice |
|---|---|
| Framework | **Next.js 16** (App Router) + **React 19** + **TypeScript** |
| Styling | **Tailwind CSS v4**, hand-written shadcn-style primitives, Recharts |
| Database | **PostgreSQL** via **Prisma 7** (driver adapters: `@prisma/adapter-neon` for Neon, `@prisma/adapter-pg` otherwise) |
| Auth | Custom — bcryptjs (cost 12), DB-backed sessions, Resend for verification / reset email |
| Storage | **Vercel Blob** (production) · local filesystem (dev), behind a `StorageProvider` interface |
| Hosting | **Vercel** + **Neon** Postgres |
| Tests | **Vitest** — 67 tests, including DB-backed two-user authorization (IDOR) suites |

**Design system:** Splitwise teal `#1CC29F` primary · "you owe" orange `#FF652F` · ink `#2E2E2E` ·
white cards on `#F7F7F7` · initial avatars with a deterministic color palette · sidebar on desktop, top bar on mobile.

---

## 🏗 Architecture

```
app/            Routes (App Router) — pages + server actions
  auth-actions.ts   signup · login · logout · verify resend · password reset
  actions.ts        expenses · settlements · groups · friends · receipts
  api/export/       session-scoped JSON export
components/     UI primitives, charts, avatar, expense form
lib/
  auth.ts           session lifecycle (create / resolve / revoke)
  data.ts           every query scoped to the session user — the IDOR boundary
  splits.ts         split math (equal / exact / percentage), integer cents
  balances.ts       pairwise balances across friend + group expenses
  debt.ts           debt simplification
  ratelimit.ts      login lockout · signup throttle · email-send throttles
  validate.ts       strict input validation + safe redirect targets
  mail.ts           Resend REST client (no SDK)
  storage.ts        StorageProvider: Vercel Blob / local filesystem
prisma/         Schema + seed (reference data only — no demo users)
tests/          Unit + DB-backed suites (auth, friends, IDOR, email verification, storage)
```

### How the core flows work

**Auth.** Signup creates an *unverified* account and emails a verification link (token: 256-bit
random, SHA-256 hash stored, single-use, 24 h). Login checks the password **first** and only then
reveals unverified status — verification state is never an enumeration oracle. Sessions are 32-byte
CSPRNG tokens (hash at rest) in an `httpOnly` cookie: 30-day absolute / 7-day idle expiry, fresh
token per login, server-side deletion on logout, and a password change or reset revokes **all**
sessions.

**Friends & placeholders.** Adding an email creates an accepted `Friendship` immediately
(Splitwise behavior). If the email isn't registered, a *placeholder* user is created so you can
split with them right away; when they sign up with that email **and verify it**, they claim the
placeholder and inherit its expenses and friendships.

**Balances.** Balances are *pairwise*: for an expense paid by P, each participant owes P their
share; settlements move the pair balance. Per-friend nets span friend and group expenses with no
double counting, and dashboard totals are sums of pairwise nets.

**Receipts.** Metadata lives in Postgres (`Receipt` row); images are files. Production uploads go
to Vercel Blob at full resolution; dev falls back to `public/uploads`. Uploads are validated —
image/PDF only, extension must match the mime type, 10 MB cap, per-user storage quota.

---

## 🔐 Security

Security was a design priority — this app is built to be safe on the public internet.

| Area | What's enforced |
|---|---|
| **Passwords** | bcrypt cost **12**, minimum length **10**; hashes never logged, returned, or exported |
| **Sessions** | Hashed tokens at rest, `httpOnly` + `Secure` + `SameSite=Lax`, idle + absolute expiry, revocation on password change/reset |
| **Login throttling** | 5 failures / 15 min → 15-min lockout, generic errors only; signup capped at 10 / hour / IP |
| **Email-send throttling** | Verification-resend & password-reset: **1 / min and 5 / day per email**, plus **20 / day per IP** — always answered generically |
| **No enumeration** | Login, signup, resend, and reset responses never reveal whether an account exists |
| **Authorization (IDOR)** | Every read/write is scoped to the session user in `lib/data.ts`; non-members get **404**; covered by two-user DB tests |
| **Redirect safety** | Post-action redirects validated against an internal-path allowlist (no open redirects) |
| **Input validation** | Strict server-side validation on every action; all DB access via Prisma (parameterized) |
| **Headers** | CSP, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `X-Frame-Options: DENY`; zero `dangerouslySetInnerHTML` |
| **Database** | The app connects as a **limited-privilege role** (row CRUD only — no DDL, no DROP, no grant option); the owner credential is not in the app's environment |

Known limitation: the CSP still allows `'unsafe-inline'` for scripts/styles because Next.js injects
inline bootstrap code.

<details>
<summary><b>Production email requirement</b></summary>

Verification and reset mail is sent via Resend. The default test sender
(`onboarding@resend.dev`) only delivers to the Resend account owner's own inbox —
for real users, verify a sending domain in Resend (free plan includes 3) and set
`RESEND_FROM` to an address on it. Without `RESEND_API_KEY`, production signup
honestly reports that the verification email is unavailable instead of faking success.
</details>

---

## 🗺 Routes

| Route | What |
|---|---|
| `/` | Landing → redirects to `/dashboard` when logged in |
| `/signup` · `/login` | Auth; login also hosts the resend-verification form |
| `/verify-email?token=<redacted> | Consumes a verification token → login |
| `/forgot-password` · `/reset-password?token=<redacted> | Password reset via emailed single-use link |
| `/dashboard` | Total balance / you owe / you are owed, friends, groups |
| `/friends` · `/friends/[id]` | Friends by email, per-friend balance & history, settle up |
| `/expenses/new` | Add expense: group **or** friends, payer, date, equal split, notes |
| `/settle` | Record a payment against any outstanding balance |
| `/activity` | Your expense + settlement feed |
| `/groups` · `/groups/[id]?tab=…` | Groups; tabs: Expenses · Balances · Settle Up · Charts · Members · Activity · Trip Pass |
| `/search` | Search *your* expenses by description, amount, date, participant |
| `/settings` | Profile, change password, default splits, storage, JSON export |
| `/receipts/[id]` | Receipt view + itemization (param = expense id; participants only) |
| `/api/export` | Download your data as JSON (session only, password hashes stripped) |

---

## ⚙️ Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (pooled) |
| `DATABASE_URL_UNPOOLED` | Direct connection string (migrations / `db push`) |
| `RESEND_API_KEY` | Resend API key for verification & reset email |
| `RESEND_FROM` | Sender identity, e.g. `OSS Splitwise <noreply@yourdomain>` |
| `BLOB_READ_WRITE_TOKEN` | Enables Vercel Blob receipt storage (auto-set on Vercel) |
| `NEXT_PUBLIC_APP_URL` | Public base URL used in emailed links |

See [`.env.example`](.env.example) for the full template.

---

## 🧪 Tests

```bash
npm test   # vitest — 67 tests
```

- **Unit:** split & settlement math, currency round-trips, token lifecycle, lockout / throttle logic, input & upload validation, redirect safety
- **DB-backed:** two-user IDOR suite (group page, expense access, group expense & settlement actions), the full verify → login → reset flow (mail layer mocked — no real API calls), friend-by-email & placeholder-claim decisions, storage provider selection

DB suites require `DATABASE_URL`, run against the dev database, and clean up after themselves.

---

## 📦 Feature status

| Feature | Status |
|---|---|
| Expenses, groups, friends, settle-up, activity | ✅ Implemented |
| Receipt upload + cloud storage + manual itemization | ✅ Implemented |
| Receipt OCR auto-itemization | 🟡 Stub — `ocrReceipt()` returns `[]` (TODO) |
| Transaction import | 🟡 Stub — CSV rows → expenses; no live bank API |
| Currency conversion | 🟡 Static seeded rate table; interface ready for a live rates API |
| Charts, search, default splits, Trip Pass, feature flags | ✅ Implemented |

**Explicit non-goals:** payment processing (Venmo/PayPal), websockets, live bank APIs, real OCR, live exchange rates, OAuth/social login.

---

## 📄 License

[GPLv3](LICENSE)
