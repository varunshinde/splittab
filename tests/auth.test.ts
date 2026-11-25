import { describe, it, expect } from "vitest";
import {
  hashPassword, verifyPassword, generateSessionToken, hashToken,
  sessionExpiry, isSessionExpired, isSessionDead, shouldTouchLastSeen,
  MIN_PASSWORD_LENGTH, SESSION_TTL_MS, SESSION_IDLE_MS,
} from "../lib/auth-utils";
import { isLockedOut, isSignupThrottled, LOGIN_MAX_FAILURES } from "../lib/ratelimit";
import { assertValidUpload, parseAmountCents, parseCurrency, parseDate, safeBackPath } from "../lib/validate";

describe("password hashing", () => {
  it("hashes with bcrypt $2b$12$ and verifies", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("$2b$12$")).toBe(true);
    expect(hash).not.toContain("correct horse");
    await expect(verifyPassword("correct horse battery", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong password!!", hash)).resolves.toBe(false);
  });
  it("rejects passwords shorter than the minimum", async () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    await expect(hashPassword("short")).rejects.toThrow(/at least 10/);
  });
  it("rejects passwords past bcrypt's 72-byte truncation point (F6)", async () => {
    await expect(hashPassword("a".repeat(73))).rejects.toThrow(/too long/);
    // Multi-byte characters count as bytes, not characters.
    await expect(hashPassword("é".repeat(40))).rejects.toThrow(/too long/); // 80 bytes
    await expect(hashPassword("a".repeat(72))).resolves.toMatch(/^\$2b\$12\$/);
  });
  it("verify fails closed on null/garbage hashes", async () => {
    await expect(verifyPassword("whatever123", null)).resolves.toBe(false);
    await expect(verifyPassword("whatever123", "not-a-hash")).resolves.toBe(false);
  });
});

describe("session tokens", () => {
  it("tokens are unique 32-byte base64url; only the SHA-256 hash is stored", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url
    const h = hashToken(a);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toBe(a);
    expect(hashToken(a)).toBe(h); // deterministic
  });
  it("absolute expiry is 30 days", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(sessionExpiry(now).getTime() - now.getTime()).toBe(SESSION_TTL_MS);
    expect(isSessionExpired(sessionExpiry(now), new Date(now.getTime() + SESSION_TTL_MS + 1))).toBe(true);
  });
  it("idle expiry: dead after 7 days without use even before absolute expiry", () => {
    const created = new Date("2026-01-01T00:00:00Z");
    const session = { expiresAt: sessionExpiry(created), lastSeenAt: created };
    expect(isSessionDead(session, new Date(created.getTime() + SESSION_IDLE_MS - 1000))).toBe(false);
    expect(isSessionDead(session, new Date(created.getTime() + SESSION_IDLE_MS + 1000))).toBe(true);
  });
  it("lastSeenAt writes are throttled to hourly", () => {
    const t = new Date("2026-01-01T12:00:00Z");
    expect(shouldTouchLastSeen(t, new Date(t.getTime() + 30 * 60 * 1000))).toBe(false);
    expect(shouldTouchLastSeen(t, new Date(t.getTime() + 61 * 60 * 1000))).toBe(true);
  });
});

describe("login lockout", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  const fail = (minAgo: number) => ({ succeeded: false, createdAt: new Date(now.getTime() - minAgo * 60000) });
  const ok = (minAgo: number) => ({ succeeded: true, createdAt: new Date(now.getTime() - minAgo * 60000) });
  it("locks after 5 failures within 15 minutes", () => {
    expect(isLockedOut([fail(1), fail(2), fail(3), fail(4), fail(5)], now)).toBe(true);
    expect(LOGIN_MAX_FAILURES).toBe(5);
  });
  it("does not lock at 4 failures", () => {
    expect(isLockedOut([fail(1), fail(2), fail(3), fail(4)], now)).toBe(false);
  });
  it("a success clears the counter", () => {
    expect(isLockedOut([fail(1), fail(2), ok(3), fail(4), fail(5), fail(6), fail(7), fail(8)], now)).toBe(false);
  });
  it("lockout expires 15 minutes after the last failure", () => {
    const attempts = [fail(16), fail(17), fail(18), fail(19), fail(20)];
    expect(isLockedOut(attempts, now)).toBe(false);
  });
  it("signup throttle: 10 attempts per IP per hour", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ succeeded: i % 2 === 0, createdAt: new Date(now.getTime() - i * 60000) }));
    expect(isSignupThrottled(many, now)).toBe(true);
    expect(isSignupThrottled(many.slice(0, 9), now)).toBe(false);
    const old = Array.from({ length: 12 }, (_, i) => ({ succeeded: false, createdAt: new Date(now.getTime() - (61 + i) * 60000) }));
    expect(isSignupThrottled(old, now)).toBe(false);
  });
});

describe("input validation", () => {
  it("amounts: positive integer cents within bounds", () => {
    expect(parseAmountCents("12.34")).toBe(1234);
    expect(parseAmountCents("0.01")).toBe(1);
    expect(() => parseAmountCents("0")).toThrow();
    expect(() => parseAmountCents("-5")).toThrow();
    expect(() => parseAmountCents("abc")).toThrow();
    expect(() => parseAmountCents("2000000")).toThrow(); // > $1M bound
  });
  it("currency must be a 3-letter code", () => {
    expect(parseCurrency("usd")).toBe("USD");
    expect(() => parseCurrency("US")).toThrow();
    expect(() => parseCurrency("USDD")).toThrow();
  });
  it("dates must be valid", () => {
    expect(parseDate("2026-02-03").toISOString().slice(0, 10)).toBe("2026-02-03");
    expect(() => parseDate("not-a-date")).toThrow();
  });
  it("uploads: image/pdf only, extension must match, 10MB cap", () => {
    expect(() => assertValidUpload("a.png", 1000, "image/png")).not.toThrow();
    expect(() => assertValidUpload("a.pdf", 1000, "application/pdf")).not.toThrow();
    expect(() => assertValidUpload("a.exe", 1000, "application/x-msdownload")).toThrow(/image or PDF/);
    expect(() => assertValidUpload("a.png", 1000, "application/pdf")).toThrow(/extension/);
    expect(() => assertValidUpload("a.png", 11 * 1024 * 1024, "image/png")).toThrow(/10MB/);
    expect(() => assertValidUpload("a.png", 0, "image/png")).toThrow(/empty/);
  });
  it("back paths: only same-origin absolute paths survive (open-redirect guard)", () => {
    expect(safeBackPath("/settle")).toBe("/settle");
    expect(safeBackPath("/groups/abc?tab=settle")).toBe("/groups/abc?tab=settle");
    expect(safeBackPath("https://evil.com")).toBe("/dashboard");
    expect(safeBackPath("//evil.com")).toBe("/dashboard");
    expect(safeBackPath("/\\evil")).toBe("/dashboard");
    expect(safeBackPath("")).toBe("/dashboard");
    expect(safeBackPath(undefined)).toBe("/dashboard");
    expect(safeBackPath(null)).toBe("/dashboard");
    expect(safeBackPath(42)).toBe("/dashboard");
  });
});
