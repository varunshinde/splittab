import { createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";

// Device + geolocation helpers for login security. Pure functions (header
// access is injected) so they can be unit-tested.
//
// A trusted "device" is proven by a random 32-byte token set in an
// httpOnly cookie when the user trusts the device after an email-code
// challenge; only its SHA-256 hash is stored (TrustedDevice.tokenHash).
// The User-Agent is kept ONLY as a display label — it is not a secret and
// must never gate access (re-audit N1: a UA hash let anyone with the
// password and a common UA string skip the code entirely).
//
// Location comes from the platform's IP-geolocation headers (Vercel sets
// x-vercel-ip-country / -city / -country-region on every request). Off
// Vercel the headers are absent and the location is "Unknown" — challenges
// still work, alerts just can't name a place.

export interface GeoInfo {
  city: string;
  region: string;
  country: string;
}

export const UNKNOWN_GEO: GeoInfo = { city: "Unknown", region: "Unknown", country: "Unknown" };

export const DEVICE_TOKEN_COOKIE = "device_token";
/** Browsers cap cookie lifetimes at 400 days; trusted devices match that. */
export const DEVICE_TOKEN_MAX_AGE_S = 400 * 24 * 60 * 60;

/** New random device-trust token (the cookie value; never stored raw). */
export function generateDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function decodeHeader(value: string | null): string {
  if (!value) return "Unknown";
  try {
    return decodeURIComponent(value).trim().slice(0, 80) || "Unknown";
  } catch {
    return value.trim().slice(0, 80) || "Unknown";
  }
}

export function parseGeo(headersList: { get(name: string): string | null }): GeoInfo {
  return {
    city: decodeHeader(headersList.get("x-vercel-ip-city")),
    region: decodeHeader(headersList.get("x-vercel-ip-country-region")),
    country: decodeHeader(headersList.get("x-vercel-ip-country")),
  };
}

/** "City, Region, Country" with unknown parts skipped. */
export function locationLabel(geo: GeoInfo): string {
  const parts = [geo.city, geo.region, geo.country].filter((p) => p && p !== "Unknown");
  return parts.length ? parts.join(", ") : "Unknown location";
}

/** Did the location meaningfully change vs. the last known one? Unknown
 *  geo never counts as a change (no signal, no alert). */
export function locationChanged(prev: GeoInfo, next: GeoInfo): boolean {
  if (next.country === "Unknown" || prev.country === "Unknown") return false;
  return prev.country !== next.country || prev.city !== next.city;
}

/** Human-friendly device label for emails and Settings, from a UA string. */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const os = /iPhone/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows"
    : /Macintosh|Mac OS X/.test(ua) ? "Mac"
    : /Linux/.test(ua) ? "Linux"
    : "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : "Unknown browser";
  return `${browser} on ${os}`;
}

// --- Login challenge codes ---------------------------------------------------

export const DEVICE_CHALLENGE_COOKIE = "device_challenge";
export const LOGIN_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const LOGIN_CODE_MAX_ATTEMPTS = 5;

/** 6-digit numeric code (leading zeros allowed), CSPRNG-generated. */
export function generateLoginCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashLoginCode(code: string): string {
  return createHash("sha256").update(code.trim(), "utf8").digest("hex");
}

/** Constant-time comparison of a submitted code against the stored hash. */
export function loginCodeMatches(code: string, codeHash: string): boolean {
  const a = Buffer.from(hashLoginCode(code), "utf8");
  const b = Buffer.from(codeHash, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ChallengeLike {
  expiresAt: Date;
  usedAt: Date | null;
  attempts: number;
}

export type ChallengeState = "valid" | "used" | "expired" | "locked" | "missing";

export function challengeState(challenge: ChallengeLike | null | undefined, now: Date = new Date()): ChallengeState {
  if (!challenge) return "missing";
  if (challenge.usedAt) return "used";
  if (challenge.attempts >= LOGIN_CODE_MAX_ATTEMPTS) return "locked";
  if (challenge.expiresAt.getTime() <= now.getTime()) return "expired";
  return "valid";
}
