const { json } = require("./_lib/http");
const { bearerToken, verifyUser, initFirebaseAdmin } = require("./_lib/auth");
const { authenticateKey } = require("./_lib/firebase-key-store");
const { KEY_PREFIX } = require("./_lib/keys");
const admin = require("firebase-admin");

/**
 * /api/me — used by dashboard (Firebase) and CLI (API key).
 * Prefer X-API-Key / Bearer sc_live_… when present; else Firebase ID token.
 */
async function resolveUser(req) {
  const raw = req.headers["x-api-key"] || bearerToken(req.headers.authorization);
  if (raw && String(raw).startsWith(KEY_PREFIX)) {
    const authenticated = await authenticateKey(raw);
    const owner = authenticated.owner;
    return {
      uid: authenticated.ownerUid,
      email: owner?.email || null,
      display_name: owner?.displayName || null,
      plan: owner?.customClaims?.plan || owner?.customClaims?.plan_name || null,
      auth_via: "api_key",
      key_prefix: authenticated.user?.prefix || String(raw).slice(0, 16),
    };
  }

  const user = await verifyUser(req);
  let display_name = null;
  let plan = null;
  try {
    initFirebaseAdmin();
    const full = await admin.auth().getUser(user.uid);
    display_name = full.displayName || null;
    plan = full.customClaims?.plan || full.customClaims?.plan_name || null;
  } catch {
    /* optional enrichment */
  }
  return {
    uid: user.uid,
    email: user.email,
    display_name,
    plan,
    auth_via: "firebase",
    key_prefix: null,
  };
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (req.method !== "GET") {
    return json(res, 405, { detail: "Method not allowed", allow: "GET" });
  }
  try {
    const user = await resolveUser(req);
    return json(res, 200, {
      uid: user.uid,
      email: user.email,
      display_name: user.display_name,
      plan: user.plan,
      plan_name: user.plan,
      auth_via: user.auth_via,
      key_prefix: user.key_prefix,
      dashboard_url: "https://www.supercompress.dev/dashboard",
    });
  } catch (err) {
    const status = err.status || 401;
    return json(res, status, { detail: err.message, ok: false, auth: status === 401 ? "required" : undefined });
  }
};
