/** Shared founder-admin allowlist. */

const FOUNDER_EMAILS = new Set(
  String(process.env.FOUNDER_ADMIN_EMAILS || "arjunkshah21@gmail.com,arjunkshah12345@gmail.com")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

function isFounderEmail(email) {
  return FOUNDER_EMAILS.has(String(email || "").toLowerCase().trim());
}

module.exports = { FOUNDER_EMAILS, isFounderEmail };
