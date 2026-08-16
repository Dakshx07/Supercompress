/**
 * Password-reset copy unit tests (no Resend / Firebase).
 * Run: node --test api/_lib/password-reset.test.js
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { passwordResetCopy } = require("./mail");
const { normalizeEmail, isValidEmail, CONTINUE_URL } = require("./password-reset");

describe("password reset helpers", () => {
  it("normalizes and validates email", () => {
    assert.equal(normalizeEmail("  Foo@Bar.COM "), "foo@bar.com");
    assert.equal(isValidEmail("a@b.co"), true);
    assert.equal(isValidEmail("nope"), false);
  });

  it("branded copy includes reset url and site branding cues", () => {
    const url = "https://example.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=abc";
    const copy = passwordResetCopy({
      email: "you@example.com",
      resetUrl: url,
      firstName: "Arjun",
    });
    assert.match(copy.subject, /password/i);
    assert.match(copy.text, /Reset your password/i);
    assert.ok(copy.text.includes(url));
    assert.ok(copy.html.includes("Reset password"));
    assert.ok(copy.html.includes("oobCode=abc") || copy.html.includes(url.replace(/&/g, "&amp;")));
    assert.ok(copy.html.includes("SuperCompress") || copy.html.includes("supercompress"));
    assert.ok(CONTINUE_URL.includes("supercompress.dev"));
  });
});
