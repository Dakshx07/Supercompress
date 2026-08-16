const assert = require("assert");
const { CCR_TTL_MS, REPLAY_TTL_MS } = require("./retention");

assert.strictEqual(CCR_TTL_MS, REPLAY_TTL_MS);
assert.strictEqual(CCR_TTL_MS, 48 * 60 * 60 * 1000);

// Mirror retrieve.js expiry rules without Firestore
function ccrExpired(data, now = Date.now()) {
  if (!data) return true;
  if (data.expire_at && typeof data.expire_at.toMillis === "function") {
    return now > data.expire_at.toMillis();
  }
  if (data.expire_at && typeof data.expire_at === "string") {
    const t = Date.parse(data.expire_at);
    if (Number.isFinite(t)) return now > t;
  }
  const stored = Date.parse(data.stored_at || 0);
  if (!Number.isFinite(stored)) return false;
  const ttl = Number(data.ttl_ms) > 0 ? Number(data.ttl_ms) : CCR_TTL_MS;
  return now - stored > ttl;
}

const now = Date.now();
assert.strictEqual(
  ccrExpired({ stored_at: new Date(now - 47 * 3600 * 1000).toISOString(), ttl_ms: CCR_TTL_MS }, now),
  false
);
assert.strictEqual(
  ccrExpired({ stored_at: new Date(now - 49 * 3600 * 1000).toISOString(), ttl_ms: CCR_TTL_MS }, now),
  true
);
assert.strictEqual(
  ccrExpired({ expire_at: new Date(now - 1000).toISOString(), stored_at: new Date(now).toISOString() }, now),
  true
);

console.log("retention.test.js: ok");
