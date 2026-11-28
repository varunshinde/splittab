# Security policy

## Reporting a vulnerability

Please report security issues privately to the repository owner via GitHub
(Security → Report a vulnerability, or a direct message to @varunshinde).
Do not open a public issue for a vulnerability. You'll get an acknowledgement
within a few days; please allow reasonable time for a fix before disclosing.

## Security model (summary)

- **Passwords** are hashed with bcrypt (cost 12), minimum 10 characters,
  maximum 72 bytes (bcrypt's truncation point). No password is ever set
  before email ownership is proven: signup collects only name + email, and
  the password is chosen on the emailed setup link's landing page.
- **Sessions** are 256-bit random tokens, stored only as SHA-256 hashes, in
  an `httpOnly`/`Secure`/`SameSite=Lax` cookie; 30-day absolute and 7-day
  idle expiry; password change/reset revokes all sessions.
- **New-device logins** require a 6-digit email code (hashed at rest,
  10-minute expiry, 5 attempts). Successful verification trusts the device;
  sign-ins from a new device or a new location trigger an alert email.
  Trusted devices can be reviewed and revoked in Settings.
- **Email tokens** (account setup, password reset) are single-use, hashed
  at rest, consumed atomically, and never consumed by a GET (link scanners
  can't burn them).
- **Consent**: friendships start as pending requests and must be accepted
  before anyone can be put on an expense. Users can decline, block, delete
  expenses they're part of, and leave groups.
- **Anti-enumeration**: auth and invite responses are generic; login runs a
  dummy bcrypt compare for unknown accounts; forgot-password and resend
  sends happen after the response (`after()`), and friend/group/invite
  actions are rate-limited per user.
- **Receipts** are stored as private blobs and served only through an
  authenticated route to the expense's participants; uploads are verified
  against magic bytes, not the declared type.
- **Headers**: nonce-based CSP (`script-src` has no `'unsafe-inline'`),
  HSTS, `nosniff`, `frame-ancestors 'none'`, restrictive `Permissions-Policy`.
- **Flash messages** travel as short codes mapped to fixed strings, so
  crafted links can't spoof messages on app pages.

## Re-audit 2 hardening

- **Activity** stores user ids and non-PII parameters, never names or
  emails in free text; feeds render names from current user rows, so a
  deleted account reads as "Deleted user" everywhere with no text
  scrubbing of other people's messages.
- **Group invitations** confer nothing until accepted — including the
  data export, which only includes groups the user actually belongs to.
  A decline is remembered per group (no re-invite loop), the invitation
  card offers a block, and an invitation from someone the invitee has
  blocked is recorded as a suppressed pending invite (indistinguishable
  to the inviter, never surfaced to the invitee).
- **Settlements** are two-party facts at every step: recording starts
  them pending, and voiding a confirmed settlement is itself a request
  the other party must agree to. Pending settlements are capped per pair.
- **Receipts** belong to the payer: only the payer can upload/replace,
  voided expenses reject uploads and items, and quota accounting clamps
  at zero. A voided expense shows who voided it and when, and the payer
  can restore it.
- **Client IPs** are trusted only when `TRUST_PROXY=1` (a proxy that
  overwrites `X-Forwarded-For`); a per-email login failure backstop
  applies regardless of IP. Settings password checks share the login
  lockout. Trusted-device rows expire after 90 days (sliding).
- **Friend expenses** cannot place two people who are not friends with
  each other into a shared ledger; that is what groups are for.

## Scope notes

The Docker setup is for local development: Postgres is bound to localhost
and the app runs as a non-root user. Production runs on Vercel + Neon with
a least-privilege database role (CRUD only, no DDL).
