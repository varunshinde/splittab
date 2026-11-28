import { describe, it, expect } from "vitest";
import { renderActivity, userLabel, type LabelUser } from "../lib/activity-render";

// R1: activity text is rendered from ids at read time. A deleted user's
// row is tombstoned to the name "Deleted user", so their old entries
// re-render as "Deleted user" with no stored text to scrub.
const users: Record<string, LabelUser> = {
  alice: { id: "alice", name: "Alice A", email: "alice@example.com", isPlaceholder: false },
  bob: { id: "bob", name: "Bob B", email: "bob@example.com", isPlaceholder: false },
  ghost: { id: "ghost", name: "Deleted user", email: "deleted-x@deleted.splittab.invalid", isPlaceholder: true },
  newbie: { id: "newbie", name: "carol", email: "carol@example.com", isPlaceholder: true },
};
const labelOf = (viewer: string) => (id: string | null) => userLabel(id ? users[id] : undefined, viewer);

describe("activity rendering (R1)", () => {
  it("renders names from current rows — a tombstoned actor reads 'Deleted user'", () => {
    const a = { type: "expense_added", userId: "ghost", subjectId: "alice", message: "stored fallback", data: { description: "Flights" } };
    expect(renderActivity(a, labelOf("alice"))).toBe('Deleted user added expense "Flights"');
  });

  it("member_invited renders the subject by id, never a stored email", () => {
    const a = { type: "member_invited", userId: "alice", subjectId: "newbie", message: "A new member was invited to the group", data: {} };
    // Placeholder: shown by the email the inviter typed (same exposure as
    // the members list); a registered user would show by name.
    expect(renderActivity(a, labelOf("bob"))).toBe("Alice A invited carol@example.com to the group");
  });

  it("the viewer reads as 'You'", () => {
    const a = { type: "member_joined", userId: "alice", subjectId: null, message: "x", data: {} };
    expect(renderActivity(a, labelOf("alice"))).toBe("You joined the group");
  });

  it("settlement verbs render from data", () => {
    const a = { type: "settlement", userId: "bob", subjectId: "alice", message: "x", data: { fromUserId: "bob", verb: "void_requested" } };
    expect(renderActivity(a, labelOf("alice"))).toBe("Settlement void requested: Bob B paid You");
  });

  it("legacy rows (data === null) fall back to their stored message", () => {
    const a = { type: "expense_added", userId: "alice", subjectId: null, message: 'Expense "Old" added', data: null };
    expect(renderActivity(a, labelOf("alice"))).toBe('Expense "Old" added');
  });
});
