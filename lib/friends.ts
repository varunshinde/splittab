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

export type AddFriendDecision =
  | { kind: "self" }
  | { kind: "invalid-email" }
  | { kind: "already-friends"; userId: string }
  | { kind: "existing-user"; userId: string }
  | { kind: "create-placeholder" };

/**
 * Decide what "add friend by email" should do.
 * - email is my own            -> self
 * - email malformed            -> invalid-email
 * - target already my friend   -> already-friends
 * - a user (real or placeholder) with that email exists -> befriend them now
 *   (Splitwise makes email-added friends usable for expenses immediately)
 * - nobody registered with it  -> create a placeholder (shadow) user
 */
export function decideAddFriend(input: {
  myEmail: string;
  email: string;
  existingUser: ExistingUserLike | null;
  alreadyFriends: boolean;
}): AddFriendDecision {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) return { kind: "invalid-email" };
  if (email === normalizeEmail(input.myEmail)) return { kind: "self" };
  if (input.existingUser && input.alreadyFriends) return { kind: "already-friends", userId: input.existingUser.id };
  if (input.existingUser) return { kind: "existing-user", userId: input.existingUser.id };
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
