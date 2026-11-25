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

## Scope notes

The Docker setup is for local development: Postgres is bound to localhost
and the app runs as a non-root user. Production runs on Vercel + Neon with
a least-privilege database role (CRUD only, no DDL).
