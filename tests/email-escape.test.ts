import { describe, it, expect } from "vitest";
import { deviceCodeEmailHtml, newSigninAlertEmailHtml, escapeHtml, type SigninContext } from "../lib/mail";

// N9 (re-audit): sign-in context values come from request headers and
// must never reach an email as raw HTML.
describe("email HTML escaping (N9)", () => {
  const evilCtx: SigninContext = {
    deviceLabel: "Chrome on Windows",
    location: "<script>alert(1)</script>",
    ip: '1.2.3.4"><img src=x onerror=alert(1)>',
    when: "2026-11-25 12:00 UTC",
  };

  it("escapeHtml neutralizes markup", () => {
    expect(escapeHtml('<a href="x">&\'')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });

  it("device code email escapes IP and location", () => {
    const html = deviceCodeEmailHtml("123456", evilCtx);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain('"><img src=x');
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("123456");
  });

  it("new-signin alert email escapes IP and location", () => {
    const html = newSigninAlertEmailHtml("device", evilCtx);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain('"><img src=x');
  });
});
