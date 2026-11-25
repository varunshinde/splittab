// Pure friend-by-email logic (Splitwise model). DB access lives in the
// server actions; everything decidable without I/O lives here and is tested.

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(normalizeEmail(email));
}

/** Normalize an unordered user pair so (a, b) and (b, a) map to one row. */
export function normalizePair(a: string, b: string): [string, string] {
  if (a === b) throw new Error("a user cannot befriend themselves");
  return a < b ? [a, b] : [b, a];
}

/** Placeholder display name derived from an email address ("sam.x@a.com" -> "sam.x"). */
export function placeholderName(email: string): string {
  const local = normalizeEmail(email).split("@")[0];
  return local || "Invited friend";
}

export interface ExistingUserLike {
  id: string;
  email: string;
  isPlaceholder: boolean;
}

export interface FriendshipLike {
  status: "PENDING" | "ACCEPTED" | "BLOCKED";
  requestedById: string | null;
}

export type AddFriendDecision =
  | { kind: "self" }
  | { kind: "invalid-email" }
  | { kind: "already-friends"; userId: string }
  | { kind: "already-requested"; userId: string }
  | { kind: "accept-theirs"; userId: string } // they already asked me: my "add" accepts
  | { kind: "blocked"; userId: string } // a block exists either way: silently do nothing
  | { kind: "request-existing"; userId: string }
  | { kind: "create-placeholder" };

/**
 * Decide what "add friend by email" should do (F1: consent-based).
 * Friendships start PENDING and only become usable for expenses once the
 * other side accepts. Decision inputs are the target user (if any) and the
 * current friendship row (if any).
 */
export function decideAddFriend(input: {
  myId: string;
  myEmail: string;
  email: string;
  existingUser: ExistingUserLike | null;
  friendship: FriendshipLike | null;
}): AddFriendDecision {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) return { kind: "invalid-email" };
  if (email === normalizeEmail(input.myEmail)) return { kind: "self" };
  const f = input.friendship;
  if (input.existingUser && f) {
    if (f.status === "BLOCKED") return { kind: "blocked", userId: input.existingUser.id };
    if (f.status === "ACCEPTED") return { kind: "already-friends", userId: input.existingUser.id };
    if (f.requestedById === input.myId) return { kind: "already-requested", userId: input.existingUser.id };
    return { kind: "accept-theirs", userId: input.existingUser.id };
  }
  if (input.existingUser) return { kind: "request-existing", userId: input.existingUser.id };
  return { kind: "create-placeholder" };
}

export type SignupDecision =
  | { kind: "claim-placeholder"; userId: string } // upgrade the shadow account, keep its data
  | { kind: "duplicate-email" } // a real account already owns this email
  | { kind: "create-new" };

/** Decide what signup with an email should do about a pre-existing row. */
export function decideSignup(existingUser: ExistingUserLike | null): SignupDecision {
  if (!existingUser) return { kind: "create-new" };
  if (existingUser.isPlaceholder) return { kind: "claim-placeholder", userId: existingUser.id };
  return { kind: "duplicate-email" };
}
