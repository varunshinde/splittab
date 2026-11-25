import { NextRequest, NextResponse } from "next/server";

// Nonce-based Content-Security-Policy (F10). Next.js reads the nonce from
// the CSP on the request and stamps it onto its own bootstrap/chunk scripts,
// so script-src can drop 'unsafe-inline': only scripts carrying this
// per-request nonce (or loaded by one, via 'strict-dynamic') may run.
// The remaining security headers live in next.config.ts; the CSP lives
// here because it must be generated per request.
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV !== "production";
  const scriptSrc = isDev
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;
  const csp = [
    "default-src 'self'",
    "img-src 'self' https: blob: data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src ${scriptSrc}`,
    "connect-src 'self'",
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except Next's static assets and image optimizer (they
    // don't execute scripts and don't need a per-request nonce).
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
