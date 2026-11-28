/**
 * R1: activity display text is rendered from ids, never stored with
 * names/emails baked in. Writers store the actor in `userId`, the other
 * party in `subjectId`, and non-PII params (expense description,
 * settlement verb, payer id) in `data`. The label for a user comes from
 * their CURRENT row, so a deleted account — tombstoned to the name
 * "Deleted user" — reads as "Deleted user" everywhere with no text
 * scrubbing, and a user who changes their name is shown by their new
 * name. Rows written before this change have `data === null` and fall
 * back to their stored `message`.
 */
export interface ActivityLike {
  type: string;
  userId: string | null;
  subjectId: string | null;
  message: string;
  data: unknown;
}

export interface LabelUser {
  id: string;
  name: string;
  email: string;
  isPlaceholder: boolean;
}

/** Display label for a user in an activity feed. Placeholders have no
 *  real name yet, so they are shown by the email the inviter typed —
 *  the same exposure the members list already gives co-members. */
export function userLabel(u: LabelUser | undefined | null, viewerId: string): string {
  if (!u) return "Someone";
  if (u.id === viewerId) return "You";
  // Tombstoned accounts are placeholders too, but their display name IS
  // "Deleted user" and their address is synthetic — never show either
  // the raw name lookup or the deleted address.
  if (u.name === "Deleted user" || u.email.endsWith("@deleted.splittab.invalid")) return "Deleted user";
  return u.isPlaceholder ? u.email : u.name;
}

const SETTLEMENT_VERBS: Record<string, string> = {
  recorded: "recorded (pending confirmation)",
  confirmed: "confirmed",
  rejected: "rejected",
  voided: "voided",
  void_requested: "void requested",
  void_confirmed: "voided by agreement",
  void_rejected: "void request declined",
};

function dataObj(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

export function renderActivity(
  a: ActivityLike,
  labelOf: (userId: string | null) => string,
): string {
  // Legacy rows (pre-R1) keep their stored text.
  if (a.data === null || a.data === undefined) return a.message;
  const d = dataObj(a.data);
  const actor = labelOf(a.userId);
  const subject = labelOf(a.subjectId);
  switch (a.type) {
    case "member_invited":
      return `${actor} invited ${subject} to the group`;
    case "member_joined":
      return `${actor} joined the group`;
    case "member_left":
      return `${actor} left the group`;
    case "expense_added":
      return `${actor} added expense "${String(d.description ?? "")}"`;
    case "expense_voided":
      return `${actor} voided expense "${String(d.description ?? "")}"`;
    case "expense_restored":
      return `${actor} restored expense "${String(d.description ?? "")}"`;
    case "settlement": {
      const from = labelOf(typeof d.fromUserId === "string" ? d.fromUserId : null);
      const verb = SETTLEMENT_VERBS[String(d.verb ?? "recorded")] ?? "recorded";
      return `Settlement ${verb}: ${from} paid ${subject}`;
    }
    default:
      return a.message;
  }
}
