// Mail layer — Resend REST API via plain fetch (no SDK dependency).
//
// Behavior when RESEND_API_KEY is not configured:
// - development: the email (including the action link) is logged to the
//   server console and { ok: true, dev: true } is returned, so the whole
//   flow can be exercised locally.
// - production: { ok: false } is returned — callers must surface a clear
//   "verification email unavailable" error. We never silently pretend an
//   email was sent.

export interface SendResult {
  ok: boolean;
  dev?: boolean;
  error?: string;
}

export function getAppUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;
  return "http://localhost:3000";
}

export async function sendEmail(input: { to: string; subject: string; html: string }): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || "onboarding@resend.dev";
  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, error: "email service not configured (RESEND_API_KEY missing)" };
    }
    console.log(`\n[dev mail] from=${from} to=${input.to} subject="${input.subject}"\n${input.html}\n`);
    return { ok: true, dev: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: input.to, subject: input.subject, html: input.html }),
    });
    if (!res.ok) return { ok: false, error: `Resend API error (HTTP ${res.status})` };
    return { ok: true };
  } catch {
    return { ok: false, error: "email send failed (network error)" };
  }
}

function wrap(title: string, bodyHtml: string): string {
  return `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
    <h1 style="color:#1cc29f;font-size:20px">${title}</h1>
    ${bodyHtml}
    <p style="color:#888;font-size:12px">SplitTab — if you didn't request this, you can ignore this email.</p>
  </div>`;
}

export function verificationEmailHtml(link: string): string {
  return wrap("Finish setting up your account", `
    <p>Welcome to SplitTab! Click below to choose your password and activate your account:</p>
    <p><a href="${link}" style="display:inline-block;background:#1cc29f;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Set up my account</a></p>
    <p>Or paste this link into your browser:<br><a href="${link}">${link}</a></p>
    <p>This link expires in 24 hours.</p>`);
}

export function existingAccountEmailHtml(): string {
  return wrap("You already have an account", `
    <p>Someone (probably you) just tried to sign up for SplitTab with this email address — but an account already exists for it.</p>
    <p>No changes were made. Just log in with your existing password; if you forgot it, use the "Forgot password" link on the login page.</p>
    <p>If this wasn't you, you can ignore this email — your account is unchanged.</p>`);
}

export interface SigninContext {
  deviceLabel: string;
  location: string;
  ip: string;
  when: string;
}

function signinContextRows(ctx: SigninContext): string {
  return `<table style="border-collapse:collapse;font-size:14px">
    <tr><td style="padding:2px 12px 2px 0;color:#888">Device</td><td>${ctx.deviceLabel}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#888">Location</td><td>${ctx.location}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#888">IP address</td><td>${ctx.ip}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#888">When</td><td>${ctx.when}</td></tr>
  </table>`;
}

export function deviceCodeEmailHtml(code: string, ctx: SigninContext): string {
  return wrap("Your SplitTab sign-in code", `
    <p>Someone is signing in to your SplitTab account from a new device. If that's you, enter this code to finish signing in:</p>
    <p style="font-size:28px;font-weight:700;letter-spacing:4px;color:#111">${code}</p>
    ${signinContextRows(ctx)}
    <p>The code expires in 10 minutes. If this wasn't you, do NOT share the code — your account is safe as long as the code stays secret. Consider changing your password.</p>`);
}

export function newSigninAlertEmailHtml(kind: "device" | "location", ctx: SigninContext): string {
  const title = kind === "device" ? "New device signed in to SplitTab" : "Sign-in from a new location";
  return wrap(title, `
    <p>Your SplitTab account was just signed in${kind === "device" ? " from a new device" : " from a new location"}:</p>
    ${signinContextRows(ctx)}
    <p>If this was you, no action is needed. If it wasn't, change your password right away and remove the device under Settings → Trusted devices.</p>`);
}

export function resetEmailHtml(link: string): string {
  return wrap("Reset your password", `
    <p>We received a request to reset your SplitTab password:</p>
    <p><a href="${link}" style="display:inline-block;background:#1cc29f;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Reset my password</a></p>
    <p>Or paste this link into your browser:<br><a href="${link}">${link}</a></p>
    <p>This link expires in 1 hour. Resetting your password signs out all your sessions.</p>`);
}
