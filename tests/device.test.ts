import { describe, it, expect } from "vitest";
import {
  challengeState, describeDevice, deviceHashFor, generateLoginCode, hashLoginCode,
  locationChanged, locationLabel, loginCodeMatches, parseGeo, LOGIN_CODE_MAX_ATTEMPTS,
} from "../lib/device";

describe("device identity + geo (pure)", () => {
  it("device hash is a stable SHA-256 of the UA", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
    expect(deviceHashFor(ua)).toMatch(/^[0-9a-f]{64}$/);
    expect(deviceHashFor(ua)).toBe(deviceHashFor(ua));
    expect(deviceHashFor(ua)).not.toBe(deviceHashFor(ua + "x"));
    expect(deviceHashFor(null)).toBe(deviceHashFor("unknown"));
    expect(deviceHashFor("")).toBe(deviceHashFor("unknown"));
  });

  it("parseGeo reads Vercel headers, decodes, and falls back to Unknown", () => {
    const h = new Headers({
      "x-vercel-ip-city": "Colorado%20Springs",
      "x-vercel-ip-country-region": "CO",
      "x-vercel-ip-country": "US",
    });
    expect(parseGeo(h)).toEqual({ city: "Colorado Springs", region: "CO", country: "US" });
    expect(parseGeo(new Headers())).toEqual({ city: "Unknown", region: "Unknown", country: "Unknown" });
  });

  it("location label skips unknowns; change detection needs real signal", () => {
    expect(locationLabel({ city: "Denver", region: "CO", country: "US" })).toBe("Denver, CO, US");
    expect(locationLabel({ city: "Unknown", region: "Unknown", country: "US" })).toBe("US");
    expect(locationLabel({ city: "Unknown", region: "Unknown", country: "Unknown" })).toBe("Unknown location");
    const home = { city: "Denver", region: "CO", country: "US" };
    expect(locationChanged(home, { city: "Denver", region: "CO", country: "US" })).toBe(false);
    expect(locationChanged(home, { city: "Austin", region: "TX", country: "US" })).toBe(true);
    expect(locationChanged(home, { city: "Toronto", region: "ON", country: "CA" })).toBe(true);
    // No geo signal (self-hosted / local) never counts as a change.
    expect(locationChanged(home, { city: "Unknown", region: "Unknown", country: "Unknown" })).toBe(false);
    expect(locationChanged({ city: "Unknown", region: "Unknown", country: "Unknown" }, home)).toBe(false);
  });

  it("describeDevice gives friendly labels", () => {
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone");
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0")).toBe("Edge on Windows");
    expect(describeDevice("Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0")).toBe("Firefox on Linux");
    expect(describeDevice("")).toBe("Unknown browser on Unknown device");
  });
});

describe("login codes + challenge state (pure)", () => {
  it("codes are 6 digits, hashed, and compared exactly", () => {
    for (let i = 0; i < 50; i++) expect(generateLoginCode()).toMatch(/^\d{6}$/);
    const hash = hashLoginCode("012345");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(loginCodeMatches("012345", hash)).toBe(true);
    expect(loginCodeMatches("012346", hash)).toBe(false);
    expect(loginCodeMatches("12345", hash)).toBe(false);
  });

  it("challenge states: missing / used / locked / expired / valid", () => {
    const now = new Date("2026-06-01T12:00:00Z");
    const base = { expiresAt: new Date(now.getTime() + 60000), usedAt: null, attempts: 0 };
    expect(challengeState(null, now)).toBe("missing");
    expect(challengeState({ ...base, usedAt: now }, now)).toBe("used");
    expect(challengeState({ ...base, attempts: LOGIN_CODE_MAX_ATTEMPTS }, now)).toBe("locked");
    expect(challengeState({ ...base, expiresAt: new Date(now.getTime() - 1) }, now)).toBe("expired");
    expect(challengeState(base, now)).toBe("valid");
  });
});
