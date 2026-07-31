/** API key generation — matches Python supercompress/api/keys.py */

const crypto = require("crypto");

const KEY_PREFIX = "sc_live_";

function hashApiKey(fullKey) {
  return crypto.createHash("sha256").update(fullKey, "utf8").digest("hex");
}

function generateApiKey() {
  const secret = crypto.randomBytes(24).toString("base64url").replace(/-/g, "x").replace(/_/g, "y").slice(0, 32);
  const full_key = `${KEY_PREFIX}${secret}`;
  return {
    full_key,
    prefix: full_key.slice(0, 16),
    key_hash: hashApiKey(full_key),
  };
}

function verifyApiKey(fullKey, storedHash) {
  if (!fullKey.startsWith(KEY_PREFIX)) return false;
  const a = Buffer.from(hashApiKey(fullKey));
  const b = Buffer.from(storedHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { KEY_PREFIX, hashApiKey, generateApiKey, verifyApiKey };
