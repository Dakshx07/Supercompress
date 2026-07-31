/**
 * POST /api/retrieve  or  GET /api/retrieve?hash=<hash>
 *
 * CCR (Cache, Compress, Retrieve) endpoint.
 * Given a hash from a [SC-Retrieve: hash] marker in compressed output,
 * returns the original uncompressed text block.
 *
 * The hash is a content-addressed key: simpleHash(originalText).
 * Originals are stored in Firestore under the ccr/ collection.
 *
 * This endpoint requires the same API key that created the cache entry.
 */

const { json, checkRateLimit, readBody } = require("./_lib/http");
const { bearerToken, initFirebaseAdmin } = require("./_lib/auth");
const { KEY_PREFIX, verifyApiKey, hashApiKey } = require("./_lib/keys");
const { loadStore, mutateStore } = require("./_lib/store");
const admin = require("firebase-admin");
const CCR_RPM = 600; // generous — retrieval is cheap

function isValidHash(hash) {
  return /^[0-9a-f]{8}_[0-9a-f]+$/.test(hash);
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});

  try {
    // Auth: same API key authentication as the compress endpoint
    const raw = req.headers["x-api-key"]
      || bearerToken(req.headers.authorization)
      || (req.query && req.query.api_key);
    if (!raw || !raw.startsWith(KEY_PREFIX)) {
      return json(res, 401, { detail: "Missing or invalid API key" });
    }

    // Rate limit
    const keyPrefix = raw.slice(0, 24);
    const rl = checkRateLimit(`ccr:${keyPrefix}`, CCR_RPM);
    if (!rl.allowed) {
      return json(res, 429, {
        detail: `Rate limit exceeded (${CCR_RPM} requests/minute)`,
        retry_after_seconds: Math.max(1, Math.ceil((rl.resetMs - Date.now()) / 1000)),
      });
    }

    // Read hash: from query param (GET) or body (POST)
    let hash;
    if (req.method === "GET") {
      hash = (req.query && req.query.hash) || "";
    } else if (req.method === "POST") {
      const body = readBody(req);
      hash = body.hash || "";
    } else {
      return json(res, 405, { detail: "Method not allowed" });
    }

    if (!hash || !isValidHash(hash)) {
      return json(res, 422, {
        detail: "Invalid hash format. Expected format: 8-hex-chars_hex-length (e.g. 'a1b2c3d4_2f')",
      });
    }

    // Verify API key is valid
    const store = await loadStore();
    const hashKey = hashApiKey(raw);
    const keyId = store.hash_index[hashKey];
    const rec = keyId ? store.keys[keyId] : null;
    if (!rec || rec.revoked || !verifyApiKey(raw, rec.key_hash)) {
      return json(res, 401, { detail: "Invalid API key" });
    }

    // Try to retrieve from Firestore
    let original = null;
    try {
      initFirebaseAdmin();
      const snap = await admin.firestore().doc(`ccr/${hash}`).get();
      if (snap.exists) {
        original = snap.data().original;
      }
    } catch (err) {
      // Not in Firestore — fall through to 404 below
    }

    if (!original) {
      return json(res, 404, {
        detail: "Hash not found. The original content may have been evicted from cache.",
        hash,
      });
    }

    // Track retrieval in usage stats
    await mutateStore((store) => {
      const day = new Date().toISOString().slice(0, 10);
      if (!store.usage[keyId]) store.usage[keyId] = {};
      if (!store.usage[keyId][day]) {
        store.usage[keyId][day] = {
          key_id: keyId,
          requests: 0,
          tokens_in: 0,
          tokens_out: 0,
          tokens_saved: 0,
          retrievals: 0,
        };
      }
      const u = store.usage[keyId][day];
      u.retrievals = (u.retrievals || 0) + 1;
    });

    return json(res, 200, {
      original,
      hash,
      retrieved_at: new Date().toISOString(),
      token_count: original.split(/\s+/).length,
    });
  } catch (err) {
    console.error("retrieve error", err);
    return json(res, err.status || 500, { detail: err.message || String(err) });
  }
};
