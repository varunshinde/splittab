import { describe, it, expect } from "vitest";
import { flashText, flashUrl, passwordFlashCode } from "../lib/flash";

describe("flash messages (F8)", () => {
  it("known codes render their fixed message", () => {
    expect(flashText("invalid_credentials", "error")).toBe("Invalid email or password.");
    expect(flashText("settlement_recorded", "notice")).toBe("Settlement recorded — it counts once the other person confirms it.");
  });
  it("attacker-supplied text is NEVER rendered — generic fallback instead", () => {
    const evil = "Session expired, call 1-800-EVIL to restore access";
    expect(flashText(evil, "error")).toBe("Something went wrong. Please try again.");
    expect(flashText(evil, "notice")).toBe("Done.");
    expect(flashText("invalid_credentials%22%3E%3Cscript%3E", "error")).toBe("Something went wrong. Please try again.");
  });
  it("missing param renders nothing", () => {
    expect(flashText(undefined, "error")).toBeNull();
    expect(flashText(null, "notice")).toBeNull();
    expect(flashText("", "error")).toBeNull();
  });
  it("flashUrl builds code-carrying URLs, with extras appended raw", () => {
    expect(flashUrl("/login", "error", "unverified", "&unverified=1")).toBe("/login?error=unverified&unverified=1");
    expect(flashUrl("/groups/abc?tab=members", "notice", "member_added")).toBe("/groups/abc?tab=members&notice=member_added");
  });
  it("password errors map to the right codes", () => {
    expect(passwordFlashCode("Password must be at least 10 characters.")).toBe("pw_too_short");
    expect(passwordFlashCode("Password is too long (maximum 72 bytes).")).toBe("pw_too_long");
    expect(passwordFlashCode("Password is too long (maximum 72 bytes).", "new_pw")).toBe("new_pw_too_long");
  });
});
