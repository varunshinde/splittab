# OSS Splitwise

Open-source Splitwise clone with the core (free-tier) feature set **and** the Pro-tier feature set (minus payment integrations). Next.js App Router + TypeScript, Tailwind CSS, Prisma 7 + PostgreSQL, Recharts.

> Money is always stored as **integer cents**. Exchange rates are stored as **scaled integers (rate × 1,000,000)**. No floats for money or rates anywhere in the core libs (`lib/splits.ts`, `lib/debt.ts`, `lib/balances.ts`, `lib/currency.ts`).

## What changed vs. the MVP mock version

The first cut used a demo "select a user" cookie with seeded sample users. **That is gone.** This version is a real product flow, modeled on Splitwise:

- **Real accounts**: sign up / log in with email + password (bcrypt), DB-backed sessions. No demo data anywhere — the seed now loads *reference data only* (currency rates + the multi-currency feature flag).
- **Friends by email**: add anyone by email, even before they have an account. Unregistered emails become *placeholder* accounts you can split with immediately; when that person signs up with the same email, they **claim** the placeholder and inherit its expenses and friendships.
- **Friend (non-group) expenses**: expenses can live outside groups — you + one or more friends, equal split, payer selectable.
- **Splitwise dashboard**: total balance / you owe / you are owed, per-friend owe & owed lists, and per-group balances.
- **Settle up everywhere**: record real payments between friends, inside groups, or from the global Settle Up page.
- **Design system**: Splitwise-style teal `#1CC29F` primary, "you owe" orange `#FF652F`, ink `#2E2E2E` text, white cards on a `#F7F7F7` app background, initial avatars with a deterministic color palette, left sidebar on desktop / top bar on mobile.

## Run it

### Option A — Docker Compose (DB + app)

```bash
cp .env.example .env
docker compose up --build
# app on http://localhost:3000 (compose runs db push, seed, then start)
```

### Option B — Local

```bash
cp .env.example .env          # DATABASE_URL for your Postgres
docker compose up db -d       # just Postgres, or point DATABASE_URL at your own
npm install
npx prisma generate
npx prisma db push            # or: npx prisma migrate dev
npm run db:seed               # reference data only: currency rates + feature flag
npm run dev                   # http://localhost:3000
```

Open the app, **sign up** for an account, then add friends by email or create a group.

## How it works

### Auth model
- `POST /signup` — name, email, password (min **10** chars), hashed with **bcryptjs cost 12**. If the email belongs to a placeholder (invited) account, signup *claims* it; if it belongs to a real account, a generic error is shown (no account-existence leak). The account is created **unverified and NOT logged in**: a verification link (24h, single-use, SHA-256-hashed token) is emailed via Resend (`lib/mail.ts`).
- `GET /verify-email?token=…` — consumes the token, sets `emailVerifiedAt`, redirects to login. The login page has a **resend** form (rate-limited: max 1/min, 5/day per email; always answers generically).
- `POST /login` — generic "Invalid email or password." for every credential failure. The password is checked **first**; only then, if the account is unverified, does login say so (so verification status is never an enumeration oracle). On success a **fresh** session is minted: 32-byte CSPRNG token, only its SHA-256 hash stored (`Session` table), sent as an `httpOnly` cookie named `session` (`SameSite=Lax`, `Secure` in production, `path=/`). Sessions expire after **30 days absolute** or **7 days idle** (`lastSeenAt` refreshed on use, throttled to hourly writes). Logout deletes the session row server-side. Changing your password revokes all other sessions.
- **Password reset** — `/forgot-password` always answers generically; the emailed link (1h, single-use, hashed token) opens `/reset-password`, and completing a reset **revokes ALL sessions** for the user (and verifies the email, since it proves inbox ownership).
- Mail transport: Resend REST API with `RESEND_API_KEY` / `RESEND_FROM` (see `.env.example`). With no key configured, **development** logs emails (including links) to the server console; **production** signup reports the verification email as unavailable instead of pretending it sent.
- Every page and server action resolves identity from the session via `lib/auth.ts` (`getCurrentUser` / `requireUser`). **No action trusts a client-supplied user id for identity.**

### Friends & expenses
- `Friendship` rows store a normalized user pair (unique). Adding by email creates an ACCEPTED friendship immediately (Splitwise behavior), creating a placeholder user first if needed.
- Expenses have a nullable `groupId`. Group expenses take participants from group members; friend expenses take participants from the `ExpenseSplit` rows (payer + selected friends). Splits use `lib/splits.ts` (equal / exact / percentage for group expenses; equal for the global add-expense flow).
- Balances are pairwise (`lib/balances.ts`): for an expense paid by P, each participant owes P their share; settlements move the pair balance. Per-friend nets therefore span friend *and* group expenses with no double counting, and dashboard totals are sums of pairwise nets.
- `Settlement` records a real payment (friend-level with `groupId = null`, or group-scoped).

### Receipt storage
Receipt **images** are files; receipt **metadata** is in Postgres (`Receipt` row).
- **Production (Vercel):** images go to [Vercel Blob](https://vercel.com/docs/vercel-blob) at full resolution via `VercelBlobStorageProvider` (`lib/storage.ts`), active when `BLOB_READ_WRITE_TOKEN` is set. `Receipt.filePath` holds the blob's public https URL.
- **Local dev:** falls back to `LocalStorageProvider` under `public/uploads`.
- Uploads are validated: image/PDF mime types only, extension must match, **10 MB hard per-file cap**, plus the per-user storage quota (default 10 GiB).

## Security model

Enforced in code and covered by tests (`tests/auth.test.ts`, `tests/idor.test.ts`, `tests/email-verification.test.ts`):

- **Passwords**: bcryptjs cost **12**, minimum length **10**. Hashes are never logged, returned, or included in exports (the export strips `passwordHash`).
- **Login throttling**: DB-backed `LoginAttempt` tracking (email + IP). **5 failed logins for an email within 15 minutes → 15-minute lockout**, answered with the same generic error (no lockout hint). A successful login clears the counter. **Signup is rate-limited to 10 attempts per IP per hour.**
- **Sessions**: 32-byte CSPRNG tokens, SHA-256 hashes at rest, `httpOnly` + `Secure` (prod) + `SameSite=Lax` cookies, 30-day absolute / 7-day idle expiry, server-side deletion on logout, fresh token on every login (no fixation), password change revokes all other sessions.
- **Authorization (IDOR)**: every resource is fetched scoped to the session user (`lib/data.ts`) — group pages 404 for non-members, receipt pages 404 for non-participants, settings/export only ever touch the session user's data, and every action re-validates membership/friendship server-side before writing. Two-user IDOR tests cover the group page, expense access, the group expense action, and the settlement action.
- **No user enumeration**: login errors are fully generic; duplicate-email signup returns a generic "check your details / try logging in" message.
- **Input validation**: strict server-side validation on every action (`lib/validate.ts`) — emails normalized (lowercase + trim) and format-checked, amounts positive integer cents bounded at $1M, strings length-capped, dates and currency codes validated. Actions read only their named fields. All DB access is through Prisma (parameterized).
- **Security headers** (`next.config.ts`): CSP (`default-src 'self'`; images `self`/https/blob/data for Blob receipts; `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `X-Frame-Options: DENY`. No `dangerouslySetInnerHTML` anywhere. CSP still allows `'unsafe-inline'` for scripts/styles because Next.js injects inline bootstrap code — a documented limitation.
- **Email verification (enforced)**: signup creates an unverified account and emails a single-use, SHA-256-hashed verification token (24h expiry) via Resend; **login is blocked until the email is verified** (status revealed only after a correct password). Resend-verification and password-reset emails are rate-limited per email (1/min, 5/day) and always answered generically. This also closes the placeholder-claiming gap: claiming an invited (placeholder) account now requires verifying the invited email, so the claimer must control that inbox.
- **Remaining operational requirement**: production sending needs `RESEND_API_KEY` set and a **verified sending domain** in Resend (`RESEND_FROM`). The default test sender (`onboarding@resend.dev`) only delivers to the Resend account owner's own email address, so real users won't receive mail until a domain is verified. Without a key, production signup honestly reports the verification email as unavailable (development logs the email + link to the console instead).

## Tests

```bash
npm test   # vitest
```
Suites: the original "grill" suite (settlement edge cases, split validation, currency round-trip, Trip Pass expiry, quota), storage provider selection (Blob mocked), `tests/auth.test.ts` (password hashing, session token/expiry/idle rules, lockout + signup throttle logic, input & upload validation), `tests/friends.test.ts` (friend-by-email decisions, placeholder claim decisions, friend-expense balance math), `tests/idor.test.ts` (DB-backed two-user authorization tests), and `tests/email-verification.test.ts` (token hash/expiry/single-use logic, send throttling, and the full DB-backed verify → login → reset flow with the mail layer mocked — no real API calls). DB suites require `DATABASE_URL`, use the dev database, and clean up after themselves.

## Routes

| Route | What |
|---|---|
| `/` | Landing (logged out) → redirects to `/dashboard` when logged in |
| `/signup`, `/login` | Real auth (see above); login page also hosts the resend-verification form |
| `/verify-email?token=…` | Consumes a verification token → verified, redirect to login |
| `/forgot-password`, `/reset-password?token=…` | Password reset via emailed single-use link (revokes all sessions) |
| `/dashboard` | Total balance / you owe / you are owed, per-friend lists, your groups |
| `/friends`, `/friends/[id]` | Friends by email, per-friend balance, history, add expense, settle up |
| `/expenses/new` | Global add-expense: group OR friends, payer, date, equal split, notes |
| `/settle` | Global settle-up: record a payment per outstanding balance |
| `/activity` | Your expense + settlement feed |
| `/groups`, `/groups/[id]?tab=…` | Groups (create + invite by email); tabs: Expenses · Balances · Settle Up · Charts · Members · Activity (+ Trip Pass) |
| `/search` | Search *your* expenses: description, amount range, date, participant |
| `/settings` | Profile, change password, default splits, storage, JSON export |
| `/receipts/[id]` | Receipt view + manual itemization (route param = expense id; participants only) |
| `/api/export` | Download the session user's data as JSON (no id parameter — session only) |

## Pro features: implemented vs stubbed

| Feature | Status |
|---|---|
| Unlimited expenses, ad-free UI | ✅ Implemented |
| Receipt scanning & itemization | 🟡 **Stubbed OCR** — `ocrReceipt()` returns `[]` + TODO; upload, storage and manual itemization are fully implemented |
| Transaction import | 🟡 **Stub** — CSV rows → expenses via `importTransactions()`; no live bank API |
| Default split settings (per group / per friend) | ✅ Implemented |
| Charts & graphs (time + category, per group) | ✅ Implemented (Recharts, brand palette) |
| Full expense search | ✅ Implemented (scoped to your expenses) |
| Currency conversion | 🟡 **Static rate table stub** — scaled-integer math, pluggable interface, TODO for a live rates API; rates seeded into `CurrencyRate`, gated by the `multi-currency` feature flag |
| High-res receipt cloud storage | ✅ **Vercel Blob in production** — behind a `StorageProvider` interface; local filesystem fallback; validated uploads + quota |
| Data backup / export | ✅ Implemented (JSON download, session-scoped, hash-stripped) |
| Early-access feature flags | ✅ Implemented (`FeatureFlag` table + `isFeatureEnabled` gate) |
| Trip Pass (Pro user grants a group 30 days of Pro) | ✅ Implemented (`grantTripPass`, `tripPassExpiry`, `hasProAccess`) |

Explicit non-goals (not built): Venmo/PayPal or any payment processing, websockets, live bank APIs, real OCR, live exchange-rate APIs, OAuth/social login. (Email verification and password reset ARE built — via Resend, see Security model.)

## Notes / deviations

- **shadcn/ui**: a full shadcn CLI init was replaced by hand-written shadcn-style primitives in `components/ui/ui.tsx` (Tailwind + clsx), restyled with the design tokens above.
- **Prisma 7**: uses the `prisma-client` generator (generated client in `lib/generated/prisma`, gitignored — run `npx prisma generate`) and driver adapters (`@prisma/adapter-neon` for Neon hosts, `@prisma/adapter-pg` otherwise); DB URL lives in `prisma.config.ts` / `.env`.
