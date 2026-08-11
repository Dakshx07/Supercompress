/**
 * Durable rate limiter (Firestore) with in-memory fallback.
 *
 * Why: Vercel serverless is multi-instance. The Map in http.js resets on every
 * cold start, so scrapers / demo abusers can burn through invocation quotas.
 * Firestore gives a shared counter across instances.
 *
 * Fail-open to in-memory if Firebase is down (prefer serving over hard-down).
 */
const crypto = require("crypto");
const admin = require("firebase-admin");
const { initFirebaseAdmin } = require("./auth");
const { checkRateLimit } = require("./http");

function bucketId(key, windowMs) {
  const bucket = Math.floor(Date.now() / windowMs);
  return crypto
    .createHash("sha256")
    .update(`${key}|${windowMs}|${bucket}`)
    .digest("hex")
    .slice(0, 40);
}

function db() {
  if (!initFirebaseAdmin()) return null;
  try {
    return admin.firestore();
  } catch {
    return null;
  }
}

/**
 * @param {string} key
 * @param {number} maxRequests
 * @param {number} [windowMs=60000]
 * @returns {Promise<{ allowed: boolean, remaining: number, resetMs: number, limit: number, backend: string }>}
 */
async function checkDurableRateLimit(key, maxRequests, windowMs = 60_000) {
  const resetMs = Math.ceil(Date.now() / windowMs) * windowMs;
  const firestore = db();
  if (!firestore) {
    const local = checkRateLimit(key, maxRequests, windowMs);
    return { ...local, backend: "memory" };
  }

  const id = bucketId(key, windowMs);
  const ref = firestore.collection("rate_limits").doc(id);
  // Never let a stuck Firestore txn burn the whole serverless budget (→ 504).
  const FS_TIMEOUT_MS = 1500;

  try {
    const count = await Promise.race([
      firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const prev = snap.exists ? Number(snap.data().count || 0) : 0;
        const next = prev + 1;
        tx.set(
          ref,
          {
            count: next,
            key: String(key).slice(0, 120),
            windowMs,
            resetMs,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        return next;
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("durable rate limit timeout")), FS_TIMEOUT_MS);
      }),
    ]);

    return {
      allowed: count <= maxRequests,
      remaining: Math.max(0, maxRequests - count),
      resetMs,
      limit: maxRequests,
      backend: "firestore",
    };
  } catch (err) {
    console.warn("durable rate limit fallback", err?.message || err);
    const local = checkRateLimit(key, maxRequests, windowMs);
    return { ...local, backend: "memory-fallback" };
  }
}

/**
 * Enforce several windows; first failure wins.
 * @param {Array<{ key: string, max: number, windowMs: number }>} rules
 */
async function enforceRateLimits(rules) {
  let last = null;
  for (const rule of rules) {
    last = await checkDurableRateLimit(rule.key, rule.max, rule.windowMs);
    if (!last.allowed) return last;
  }
  return last || { allowed: true, remaining: 0, resetMs: Date.now(), limit: 0, backend: "none" };
}

module.exports = {
  checkDurableRateLimit,
  enforceRateLimits,
};
