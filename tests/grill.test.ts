import { describe, it, expect } from "vitest";
import { equalSplit, exactSplit, percentageSplit } from "../lib/splits";
import { computeBalances, computeSimplifiedDebts } from "../lib/debt";
import { convertCurrency, STATIC_RATES } from "../lib/currency";
import { hasProAccess, isTripPassActive, tripPassExpiry, canUpload, assertCanUpload, isFeatureEnabled } from "../lib/pro";

describe("settlement (grill)", () => {
  it("zero balances -> no transfers", () => {
    expect(computeSimplifiedDebts(new Map([["a", 0], ["b", 0]]))).toEqual([]);
  });
  it("one-to-many debts minimize transfers", () => {
    const t = computeSimplifiedDebts(new Map([["a", 9000], ["b", -3000], ["c", -3000], ["d", -3000]]));
    expect(t).toHaveLength(3);
    expect(t.reduce((s, x) => s + x.amountInCents, 0)).toBe(9000);
    expect(t.every((x) => x.to === "a")).toBe(true);
  });
  it("rounding remainders in balances settle exactly", () => {
    const expenses = [{ paidById: "a", splits: equalSplit(100, ["a", "b", "c"]) }];
    const balances = computeBalances(expenses);
    expect([...balances.values()].reduce((x, y) => x + y, 0)).toBe(0);
    const t = computeSimplifiedDebts(balances);
    expect(t.reduce((s, x) => s + x.amountInCents, 0)).toBe(66); // b 33 + c 33
  });
  it("rejects non-zero-sum balances", () => {
    expect(() => computeSimplifiedDebts(new Map([["a", 5]]))).toThrow(/sum to zero/);
  });
  it("chain debts collapse (a owes b, b owes c)", () => {
    const t = computeSimplifiedDebts(new Map([["a", -1000], ["b", 0], ["c", 1000]]));
    expect(t).toEqual([{ from: "a", to: "c", amountInCents: 1000 }]);
  });
});

describe("split validation (grill)", () => {
  it("equal split remainder goes to first participants", () => {
    expect(equalSplit(100, ["a", "b", "c"]).map((s) => s.amountOwedInCents)).toEqual([34, 33, 33]);
    expect(equalSplit(9000, ["a", "b", "c"]).map((s) => s.amountOwedInCents)).toEqual([3000, 3000, 3000]);
  });
  it("exact split must sum to total", () => {
    expect(() => exactSplit(100, [{ userId: "a", amountOwedInCents: 60 }, { userId: "b", amountOwedInCents: 30 }])).toThrow(/must sum/);
    expect(exactSplit(100, [{ userId: "a", amountOwedInCents: 60 }, { userId: "b", amountOwedInCents: 40 }])).toHaveLength(2);
  });
  it("percentage split must sum to 100 and total is preserved", () => {
    expect(() => percentageSplit(100, [{ userId: "a", percentage: 50 }])).toThrow(/sum to 100/);
    const s = percentageSplit(101, [{ userId: "a", percentage: 55 }, { userId: "b", percentage: 45 }]);
    expect(s.reduce((a, x) => a + x.amountOwedInCents, 0)).toBe(101);
    expect(s[0].amountOwedInCents).toBe(56); // floor(55.55)=55 + remainder 1 to first
  });
  it("rejects float cents", () => {
    expect(() => equalSplit(10.5, ["a"])).toThrow(/integer/);
  });
  it("percentage shares must each be within 0-100 (F6)", () => {
    // [200, -100] sums to 100 but would give B a negative share.
    expect(() => percentageSplit(100, [{ userId: "a", percentage: 200 }, { userId: "b", percentage: -100 }])).toThrow(/between 0 and 100/);
    expect(() => percentageSplit(100, [{ userId: "a", percentage: 101 }, { userId: "b", percentage: -1 }])).toThrow(/between 0 and 100/);
    expect(() => percentageSplit(100, [{ userId: "a", percentage: 33.5 }, { userId: "b", percentage: 66.5 }])).toThrow(/between 0 and 100/);
    // Boundary values are fine.
    expect(percentageSplit(100, [{ userId: "a", percentage: 100 }, { userId: "b", percentage: 0 }])[1].amountOwedInCents).toBe(0);
  });
});

describe("currency (grill)", () => {
  it("round-trip USD->EUR->USD is lossless with static table", () => {
    for (const amt of [100, 1000, 12300, 99900]) {
      expect(convertCurrency(convertCurrency(amt, "USD", "EUR"), "EUR", "USD")).toBe(amt);
    }
  });
  it("same currency is identity; direct rate applies", () => {
    expect(convertCurrency(500, "USD", "USD")).toBe(500);
    expect(convertCurrency(10000, "EUR", "USD")).toBe(12500);
    expect(STATIC_RATES["USD->EUR"]).toBe(800_000);
  });
});

describe("trip pass + flags + quota (grill)", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  it("expiry is exactly 30 days and active strictly before expiry", () => {
    const exp = tripPassExpiry(now);
    expect((exp.getTime() - now.getTime()) / 86400000).toBe(30);
    expect(isTripPassActive(exp, new Date(exp.getTime() - 1))).toBe(true);
    expect(isTripPassActive(exp, exp)).toBe(false);
  });
  it("hasProAccess: pro user, active pass, expired pass", () => {
    expect(hasProAccess({ isPro: true }, [], now)).toBe(true);
    expect(hasProAccess({ isPro: false }, [{ expiresAt: tripPassExpiry(now) }], now)).toBe(true);
    expect(hasProAccess({ isPro: false }, [{ expiresAt: now }], now)).toBe(false);
    expect(hasProAccess({ isPro: false }, [], now)).toBe(false);
  });
  it("feature flag gates per user", () => {
    expect(isFeatureEnabled({ key: "x", enabledForUserIds: ["u1"] }, "u1")).toBe(true);
    expect(isFeatureEnabled({ key: "x", enabledForUserIds: ["u1"] }, "u2")).toBe(false);
    expect(isFeatureEnabled(null, "u1")).toBe(false);
  });
  it("quota enforcement at 10GiB boundary", () => {
    const q = 10n * 1024n * 1024n * 1024n;
    expect(canUpload(q - 1n, 1n, q)).toBe(true);
    expect(canUpload(q, 1n, q)).toBe(false);
    expect(() => assertCanUpload(q, 1n, q)).toThrow(/quota/);
  });
});
