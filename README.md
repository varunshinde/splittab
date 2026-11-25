# OSS Splitwise

Open-source Splitwise clone with the core (free-tier) feature set **and** the Pro-tier feature set (minus payment integrations). Next.js App Router + TypeScript, Tailwind CSS, Prisma 7 + PostgreSQL, Recharts.

> Money is always stored as **integer cents**. Exchange rates are stored as **scaled integers (rate × 1,000,000)**. No floats for money or rates anywhere in the core libs (`lib/splits.ts`, `lib/debt.ts`, `lib/currency.ts`).

## Run it

### Option A — Docker Compose (DB + app)

```bash
cp .env.example .env
docker compose up --build
# app on http://localhost:3000 (compose runs migrate/db push, seed, then start)
```

### Option B — Local

```bash
cp .env.example .env          # DATABASE_URL for your Postgres
docker compose up db -d       # just Postgres, or point DATABASE_URL at your own
npm install
npx prisma generate
npx prisma db push            # or: npx prisma migrate dev
npm run db:seed               # 3 users (Alice = Pro), 2 groups, expenses, rates…
npm run dev                   # http://localhost:3000
```

Open the app, **select a user** on the home page (MVP session — a cookie, no passwords/OAuth by design), then use Groups / Search / Settings.

## Receipt storage

Receipt **images** are files; receipt **metadata** (owning expense, file size, upload time, itemization) is always stored in Postgres (`Receipt` row).

- **Production (Vercel):** images go to [Vercel Blob](https://vercel.com/docs/vercel-blob) at full resolution via `VercelBlobStorageProvider` (`lib/storage.ts`). It activates automatically when `BLOB_READ_WRITE_TOKEN` is set (create a Blob store in the Vercel dashboard — never commit a real token). `Receipt.filePath` then holds the blob's public https URL, and the receipt page links to it directly.
- **Local dev / Docker:** with no token set, uploads fall back to `LocalStorageProvider` writing under `public/uploads`, unchanged from before.
- The per-user storage quota (default 10 GiB) is enforced on upload in both modes, based on the uploaded byte size.

### Tests (the “grill” suite)

```bash
npm test   # vitest — settlement edge cases, split validation, currency round-trip, Trip Pass expiry, quota, storage provider selection (Blob mocked)
```

## Routes

| Route | What |
|---|---|
| `/` | Select-user session |
| `/groups` | Dashboard + create group |
| `/groups/[id]?tab=…` | Tabs: Expenses · Balances · Settle Up · Charts · Activity (+ Trip Pass grant) |
| `/search` | Full expense search: description, amount range, date, participant |
| `/settings` | Default splits, currency info, JSON data export |
| `/receipts/[id]` | Receipt view + manual itemization (route param = expense id) |
| `/api/export?userId=…` | Download all of a user's data as JSON |

## Pro features: implemented vs stubbed

| Feature | Status |
|---|---|
| Unlimited expenses, ad-free UI | ✅ Implemented (no caps, no ad slots by design) |
| Receipt scanning & itemization | 🟡 **Stubbed OCR** — `ocrReceipt()` returns `[]` + TODO (Tesseract/Google Vision); upload, storage and manual itemization are fully implemented |
| Transaction import | 🟡 **Stub** — CSV rows → expenses via `importTransactions()`; no live bank API |
| Default split settings (per group / per friend) | ✅ Implemented |
| Charts & graphs (time + category, per group) | ✅ Implemented (Recharts) |
| Full expense search | ✅ Implemented |
| Currency conversion | 🟡 **Static rate table stub** — scaled-integer math, pluggable provider interface, TODO for Open Exchange Rates; rates also seeded into `CurrencyRate` |
| High-res receipt cloud storage | ✅ **Vercel Blob in production** — full-resolution images behind a `StorageProvider` interface; local filesystem (`public/uploads`) fallback for dev; 10 GiB per-user quota enforced via `receiptStorageUsedBytes` |
| Data backup / export | ✅ Implemented (JSON download) |
| Early-access feature flags | ✅ Implemented (`FeatureFlag` table + `isFeatureEnabled` gate) |
| Trip Pass (Pro user grants a group 30 days of Pro) | ✅ Implemented (`grantTripPass`, `tripPassExpiry`, `hasProAccess`) |

Explicit non-goals (not built): Venmo/PayPal, websockets, live bank APIs, real OCR, live exchange-rate APIs, OAuth/social login, payment processing.

## Notes / deviations

- **shadcn/ui**: a full shadcn CLI init was replaced by hand-written shadcn-style primitives in `components/ui/ui.tsx` (Tailwind + clsx, cva-style variants). Same look/usage, fewer moving parts.
- **Prisma 7**: uses the `prisma-client` generator (generated client in `lib/generated/prisma`, gitignored — run `npx prisma generate`) and the `@prisma/adapter-pg` driver adapter; DB URL lives in `prisma.config.ts` / `.env`.
- **Auth**: intentionally a select-user cookie session for the MVP, per spec.
