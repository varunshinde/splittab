// Flash messages (F8): redirects carry a short CODE, never free text, and
// pages render only the fixed message mapped to that code. Before this, any
// text in ?error= / ?notice= was rendered verbatim, so a crafted link could
// put arbitrary "official-looking" messages on the app's own pages (content
// spoofing / phishing). Unknown codes render a generic fallback.

export const FLASH_MESSAGES = {
  // --- errors ---
  invalid_credentials: "Invalid email or password.",
  too_many_attempts: "Too many attempts. Please wait a while and try again.",
  name_required: "Please enter your name.",
  invalid_email: "Please enter a valid email address.",
  signup_send_failed: "We couldn't send the setup email right now. Please try the resend option on the login page in a few minutes.",
  code_send_failed: "We couldn't email your sign-in code right now. Please try again in a few minutes.",
  setup_link_invalid: "That setup link is invalid or has expired. Log in to request a new one.",
  reset_link_invalid: "That reset link is invalid or has expired. Request a new one.",
  signin_code_invalid: "That sign-in code is invalid or has expired. Please log in again.",
  code_mismatch: "That code doesn't match. Check the email and try again.",
  unverified: "Your email address isn't verified yet. We emailed you a verification link — click it, then log in. You can request a new link below.",
  current_password_wrong: "Current password is incorrect.",
  pw_too_short: "Password must be at least 10 characters.",
  pw_too_long: "Password is too long (maximum 72 bytes).",
  new_pw_too_short: "New password must be at least 10 characters.",
  new_pw_too_long: "New password is too long (maximum 72 bytes).",
  friend_add_throttled: "You're adding friends too quickly. Please wait a while and try again.",
  own_email: "That's your own email address.",
  member_email_invalid: "Enter someone else's valid email.",
  pick_participant: "Pick at least one person to split with.",
  // --- notices ---
  signup_check_email: "Check your email — we sent you a link to finish setting up your account. If you already have an account, you can just log in.",
  account_ready: "Your account is ready — log in with your new password.",
  password_updated: "Password updated. Please log in with your new password.",
  password_changed: "Password changed. Your other sessions were signed out, and every device will need a sign-in code at its next login.",
  resend_generic: "If an unverified account exists for that email, a new verification link is on its way.",
  reset_generic: "If an account exists for that email, a password reset link is on its way.",
  device_removed: "Device removed. It will need a sign-in code next time it logs in.",
  account_deleted: "Your account has been deleted. Your shared expense history now shows 'Deleted user'.",
  profile_updated: "Profile updated.",
  already_friends: "You are already friends with this person.",
  friend_request_accepted: "Friend request accepted — you are now friends.",
  friend_request_sent: "Friend request sent. When they accept, you'll be able to split expenses together.",
  member_added: "Invitation sent. They'll become a member when they accept.",
  already_settled: "You are already settled up.",
  settlement_recorded: "Settlement recorded — it counts once the other person confirms it.",
  settlement_confirmed: "Settlement confirmed — it now counts toward your balances.",
  settlement_voided: "Settlement voided — it no longer counts toward your balances.",
} as const;

export type FlashCode = keyof typeof FLASH_MESSAGES;

/** Render a flash param: known code -> its fixed message; anything else ->
 *  a generic fallback (attacker-supplied text is NEVER rendered). */
export function flashText(code: string | undefined | null, kind: "error" | "notice"): string | null {
  if (!code) return null;
  const msg = (FLASH_MESSAGES as Record<string, string>)[code];
  if (msg) return msg;
  return kind === "error" ? "Something went wrong. Please try again." : "Done.";
}

/** Build a redirect URL carrying a flash code. `extra` appends raw params
 *  (e.g. "&unverified=1" or a token) that are not user-visible text. */
export function flashUrl(path: string, kind: "error" | "notice", code: FlashCode, extra = ""): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${kind}=${code}${extra}`;
}

/** Map a validateNewPassword() error message to its flash code. */
export function passwordFlashCode(error: string, variant: "pw" | "new_pw" = "pw"): FlashCode {
  const long = error.includes("too long");
  if (variant === "new_pw") return long ? "new_pw_too_long" : "new_pw_too_short";
  return long ? "pw_too_long" : "pw_too_short";
}
