/**
 * Branded password-reset via Firebase Admin link + Resend.
 * Public endpoint — always returns a generic success payload (no account enumeration).
 */

const { initFirebaseAdmin } = require("./auth");

const SITE = "https://www.supercompress.dev";
const CONTINUE_URL = `${SITE}/dashboard?login=1&reset=1`;

function normalizeEmail(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .slice(0, 254);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function generateResetLink(email) {
  const admin = require("firebase-admin");
  if (!initFirebaseAdmin()) {
    const err = new Error("Auth is not configured");
    err.status = 503;
    throw err;
  }
  return admin.auth().generatePasswordResetLink(email, {
    url: CONTINUE_URL,
    handleCodeInApp: false,
  });
}

/**
 * @returns {{ ok: true, sent?: boolean, detail: string }}
 */
async function requestPasswordReset(emailRaw) {
  const email = normalizeEmail(emailRaw);
  const generic = {
    ok: true,
    detail: "If an account exists for that email, we sent a password reset link. Check inbox and spam.",
  };
  if (!isValidEmail(email)) {
    const err = new Error("Enter a valid email address.");
    err.status = 400;
    throw err;
  }

  let link;
  try {
    link = await generateResetLink(email);
  } catch (err) {
    const code = String(err?.code || err?.errorInfo?.code || "");
    // Unknown user / disabled → still look like success (no enumeration).
    if (
      code.includes("user-not-found") ||
      code.includes("invalid-email") ||
      code.includes("user-disabled")
    ) {
      return generic;
    }
    console.warn("password-reset link failed:", code || err.message || err);
    const fail = new Error("Could not start password reset. Try again in a minute.");
    fail.status = 503;
    throw fail;
  }

  const { sendPasswordResetEmail } = require("./mail");
  const result = await sendPasswordResetEmail({
    email,
    resetUrl: link,
    idempotencyKey: `pwd-reset:${email}:${new Date().toISOString().slice(0, 13)}`,
  });
  if (!result.ok) {
    console.warn("password-reset Resend failed:", result.error || result);
    const fail = new Error("Could not send reset email. Try again in a minute.");
    fail.status = 503;
    throw fail;
  }
  return { ...generic, sent: true };
}

module.exports = {
  normalizeEmail,
  isValidEmail,
  generateResetLink,
  requestPasswordReset,
  CONTINUE_URL,
  SITE,
};
