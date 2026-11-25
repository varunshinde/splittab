// Strict server-side input validation, shared by all server actions.
// Every action reads only the named fields it expects (extra form fields are
// ignored by construction) and validates them through these helpers.

export const MAX_AMOUNT_CENTS = 100_000_000; // $1,000,000 sanity bound
export const MAX_NAME_LEN = 100;
export const MAX_DESCRIPTION_LEN = 200;
export const MAX_NOTES_LEN = 1000;
export const MAX_CATEGORY_LEN = 50;
export const MAX_GROUP_NAME_LEN = 100;
export const MAX_GROUP_INVITEES = 20; // per group-create request (F3: bulk-invite / DB-bloat guard)

export function capString(value: unknown, max: number, label: string): string {
  const s = String(value ?? "").trim();
  if (s.length > max) throw new Error(`${label} must be at most ${max} characters`);
  return s;
}

export function requireString(value: unknown, max: number, label: string): string {
  const s = capString(value, max, label);
  if (!s) throw new Error(`${label} is required`);
  return s;
}

/** Parse a decimal form amount ("12.34") into positive integer cents. */
export function parseAmountCents(raw: unknown): number {
  const n = parseFloat(String(raw ?? ""));
  const cents = Math.round(n * 100);
  if (!Number.isFinite(n) || !Number.isInteger(cents) || cents <= 0 || cents > MAX_AMOUNT_CENTS) {
    throw new Error(`amount must be between 0.01 and ${MAX_AMOUNT_CENTS / 100}`);
  }
  return cents;
}

/** Parse a YYYY-MM-DD date (or empty -> now). Rejects invalid dates. */
export function parseDate(raw: unknown): Date {
  const s = String(raw ?? "").trim();
  if (!s) return new Date();
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error("invalid date");
  return d;
}

export function parseCurrency(raw: unknown): string {
  const c = String(raw ?? "USD").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) throw new Error("currency must be a 3-letter code");
  return c;
}

/**
 * Validate a post-action "back" redirect target. Only same-origin absolute
 * paths are allowed through: a string starting with exactly one "/".
 * Protocol-relative URLs ("//evil.com"), backslash tricks ("/\\evil"),
 * absolute URLs ("https://evil.com") and anything with control characters
 * all fall back to "/dashboard" — an open-redirect guard for form-supplied
 * redirect targets.
 */
export function safeBackPath(raw: unknown): string {
  if (typeof raw !== "string") return "/dashboard";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  if (raw.includes("\\") || raw.includes("://")) return "/dashboard";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return "/dashboard";
  return raw;
}

// --- Receipt uploads ---------------------------------------------------------

export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024; // 10 MB hard per-file cap
export const ALLOWED_RECEIPT_MIME: Record<string, string[]> = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
  "application/pdf": [".pdf"],
};

// Magic-byte signatures per allowed type. The client-declared mime type is
// never trusted on its own (F7): the file's leading bytes must match the
// type it claims to be, so an HTML file renamed to .png is rejected.
const MAGIC: Record<string, (d: Buffer) => boolean> = {
  "image/png": (d) => d.length >= 8 && d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47,
  "image/jpeg": (d) => d.length >= 3 && d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff,
  "image/webp": (d) => d.length >= 12 && d.toString("ascii", 0, 4) === "RIFF" && d.toString("ascii", 8, 12) === "WEBP",
  "image/gif": (d) => d.length >= 6 && (d.toString("ascii", 0, 6) === "GIF87a" || d.toString("ascii", 0, 6) === "GIF89a"),
  "application/pdf": (d) => d.length >= 5 && d.toString("ascii", 0, 5) === "%PDF-",
};

export function sniffReceiptMime(data: Buffer): string | null {
  for (const [mime, check] of Object.entries(MAGIC)) {
    if (check(data)) return mime;
  }
  return null;
}

/** Validate a receipt upload: size cap, a DECLARED type is required, the
 *  extension must match it, and the file bytes must actually be that type. */
export function assertValidUpload(fileName: string, data: Buffer, mimeType?: string): void {
  const sizeBytes = data.byteLength;
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) throw new Error("empty file");
  if (sizeBytes > MAX_RECEIPT_BYTES) throw new Error(`file exceeds the ${MAX_RECEIPT_BYTES / (1024 * 1024)}MB limit`);
  if (!mimeType) throw new Error("a file type is required");
  const exts = ALLOWED_RECEIPT_MIME[mimeType];
  if (!exts) throw new Error("only image or PDF receipts are allowed");
  const lower = fileName.toLowerCase();
  if (!exts.some((e) => lower.endsWith(e))) throw new Error("file extension does not match its type");
  const sniffed = sniffReceiptMime(data);
  if (sniffed !== mimeType) {
    throw new Error(`file contents do not match its declared type (${mimeType})`);
  }
}
