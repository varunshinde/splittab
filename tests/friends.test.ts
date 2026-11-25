import { describe, it, expect } from "vitest";
import { decideAddFriend, decideSignup, normalizeEmail, normalizePair, placeholderName } from "../lib/friends";
import { equalSplit } from "../lib/splits";
import { dashboardTotals, myNet, netBetween, pairwiseNets } from "../lib/balances";

describe("friend-by-email decisions", () => {
  const me = "me@example.com";
  it("normalizes emails (trim + lowercase)", () => {
    expect(normalizeEmail("  Alice@Example.COM ")).toBe("alice@example.com");
    expect(placeholderName("sam.x@a.com")).toBe("sam.x");
  });
  it("adding an existing registered user befriends them immediately", () => {
    const d = decideAddFriend({ myEmail: me, email: "Bob@Example.com", existingUser: { id: "u2", email: "bob@example.com", isPlaceholder: false }, alreadyFriends: false });
    expect(d).toEqual({ kind: "existing-user", userId: "u2" });
  });
  it("adding an unregistered email creates a placeholder", () => {
    const d = decideAddFriend({ myEmail: me, email: "new@example.com", existingUser: null, alreadyFriends: false });
    expect(d).toEqual({ kind: "create-placeholder" });
  });
  it("adding a placeholder user again befriends the placeholder", () => {
    const d = decideAddFriend({ myEmail: me, email: "invited@example.com", existingUser: { id: "u9", email: "invited@example.com", isPlaceholder: true }, alreadyFriends: false });
    expect(d).toEqual({ kind: "existing-user", userId: "u9" });
  });
  it("self and invalid emails are rejected; existing friends are detected", () => {
    expect(decideAddFriend({ myEmail: me, email: "ME@example.com", existingUser: null, alreadyFriends: false }).kind).toBe("self");
    expect(decideAddFriend({ myEmail: me, email: "not-an-email", existingUser: null, alreadyFriends: false }).kind).toBe("invalid-email");
    expect(decideAddFriend({ myEmail: me, email: "bob@example.com", existingUser: { id: "u2", email: "bob@example.com", isPlaceholder: false }, alreadyFriends: true }).kind).toBe("already-friends");
  });
  it("pair normalization is order-independent and rejects self-pairs", () => {
    expect(normalizePair("b", "a")).toEqual(["a", "b"]);
    expect(normalizePair("a", "b")).toEqual(["a", "b"]);
    expect(() => normalizePair("a", "a")).toThrow();
  });
});

describe("signup claim decisions", () => {
  it("no existing user -> create new", () => {
    expect(decideSignup(null)).toEqual({ kind: "create-new" });
  });
  it("placeholder with that email -> claim it (keep data, set password)", () => {
    expect(decideSignup({ id: "u9", email: "invited@example.com", isPlaceholder: true })).toEqual({ kind: "claim-placeholder", userId: "u9" });
  });
  it("real account with that email -> duplicate", () => {
    expect(decideSignup({ id: "u2", email: "bob@example.com", isPlaceholder: false })).toEqual({ kind: "duplicate-email" });
  });
});

describe("friend expense balance math", () => {
  // A pays 100.00 for A+B, equal split -> B owes A 50.00
  const dinner = { paidById: "a", splits: equalSplit(10000, ["a", "b"]) };
  it("equal friend expense: payer is owed half", () => {
    expect(netBetween("a", "b", [dinner])).toBe(5000);
    expect(netBetween("b", "a", [dinner])).toBe(-5000);
  });
  it("settlement zeroes the balance; partial settlement reduces it", () => {
    const full = [{ fromUserId: "b", toUserId: "a", amountInCents: 5000 }];
    expect(netBetween("a", "b", [dinner], full)).toBe(0);
    const partial = [{ fromUserId: "b", toUserId: "a", amountInCents: 2000 }];
    expect(netBetween("a", "b", [dinner], partial)).toBe(3000);
  });
  it("payer-excluded split: A pays 90 for B alone -> B owes 90", () => {
    const gift = { paidById: "a", splits: equalSplit(9000, ["b"]) };
    expect(netBetween("a", "b", [gift])).toBe(9000);
    expect(myNet("a", [gift])).toBe(9000);
    expect(myNet("b", [gift])).toBe(-9000);
  });
  it("pairwise nets include group expenses via the payer rule, no double count", () => {
    // Group expense: A pays 90, split A/B/C equally. Pairwise: B owes A 30, C owes A 30.
    const groupExpense = { paidById: "a", splits: equalSplit(9000, ["a", "b", "c"]) };
    const nets = pairwiseNets("a", [groupExpense, dinner]);
    expect(nets.get("b")).toBe(3000 + 5000);
    expect(nets.get("c")).toBe(3000);
    // Sum of pairwise nets == my total net across everything
    const totals = dashboardTotals(nets);
    expect(totals.total).toBe(11000);
    expect(totals.youAreOwed).toBe(11000);
    expect(totals.youOwe).toBe(0);
    expect(totals.total).toBe(myNet("a", [groupExpense, dinner]));
  });
  it("dashboard totals split owe vs owed", () => {
    const nets = new Map([["b", 5000], ["c", -3000], ["d", 0]]);
    // pairwiseNets drops zeros; dashboardTotals tolerates them anyway
    expect(dashboardTotals(nets)).toEqual({ total: 2000, youOwe: 3000, youAreOwed: 5000 });
  });
  it("third-party payer creates no pairwise debt between the other two", () => {
    const carolPaid = { paidById: "c", splits: equalSplit(6000, ["a", "b", "c"]) };
    expect(netBetween("a", "b", [carolPaid])).toBe(0);
    expect(netBetween("a", "c", [carolPaid])).toBe(-2000);
  });
});
