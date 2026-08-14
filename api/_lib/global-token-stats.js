/**
 * Global processed-token counter (Auth stub) for the public live homepage meter.
 * O(1) read — avoids listUsers on every landing poll.
 *
 * Stub uid: sc_stats_total
 * Claims: { sc_g: { tin, ts, n, seeded } }
 */
const admin = require("firebase-admin");
const { initFirebaseAdmin } = require("./auth");

const STATS_UID = "sc_stats_total";

function auth() {
  if (!initFirebaseAdmin()) {
    const err = new Error("Firebase Admin is not configured");
    err.status = 503;
    throw err;
  }
  return admin.auth();
}

async function ensureStub() {
  try {
    return await auth().getUser(STATS_UID);
  } catch (err) {
    if (err?.code !== "auth/user-not-found") throw err;
    await auth().createUser({
      uid: STATS_UID,
      disabled: true,
      displayName: "SuperCompress public stats",
    });
    return auth().getUser(STATS_UID);
  }
}

function readFromClaims(claims = {}) {
  const g = claims.sc_g || {};
  return {
    tokens_processed: Math.max(0, Number(g.tin) || 0),
    tokens_saved: Math.max(0, Number(g.ts) || 0),
    requests: Math.max(0, Number(g.n) || 0),
    seeded: Boolean(g.seeded),
    updated_at: g.at || null,
  };
}

async function readGlobalTokenStats() {
  try {
    const user = await auth().getUser(STATS_UID).catch(() => null);
    if (!user) return null;
    return readFromClaims(user.customClaims || {});
  } catch (err) {
    console.warn("global-token-stats read failed:", err.message || err);
    return null;
  }
}

async function writeGlobal(patch) {
  const user = await ensureStub();
  const prev = user.customClaims || {};
  const g = { ...(prev.sc_g || {}), ...patch, at: new Date().toISOString() };
  await auth().setCustomUserClaims(STATS_UID, { ...prev, sc_g: g });
  return readFromClaims({ sc_g: g });
}

/**
 * Fire-and-forget bump after a successful compress burn.
 */
async function bumpGlobalTokenStats({ tokensIn = 0, tokensSaved = 0, requests = 1 } = {}) {
  const addIn = Math.max(0, Number(tokensIn) || 0);
  const addSaved = Math.max(0, Number(tokensSaved) || 0);
  const addReq = Math.max(0, Number(requests) || 0);
  if (addIn <= 0 && addSaved <= 0 && addReq <= 0) return null;

  for (let i = 0; i < 4; i++) {
    try {
      const user = await ensureStub();
      const prev = user.customClaims || {};
      const g = prev.sc_g || {};
      const next = {
        tin: (Number(g.tin) || 0) + addIn,
        ts: (Number(g.ts) || 0) + addSaved,
        n: (Number(g.n) || 0) + addReq,
        seeded: Boolean(g.seeded),
        at: new Date().toISOString(),
      };
      await auth().setCustomUserClaims(STATS_UID, { ...prev, sc_g: next });
      return readFromClaims({ sc_g: next });
    } catch (err) {
      if (i === 3) {
        console.warn("global-token-stats bump failed:", err.message || err);
        return null;
      }
    }
  }
  return null;
}

/**
 * If the stub is empty/unseeded, set it to the scanned Auth totals (once).
 * Never decreases an already-higher live total.
 */
async function seedGlobalTokenStats({ tokens_processed = 0, tokens_saved = 0, requests = 0 } = {}) {
  const tin = Math.max(0, Number(tokens_processed) || 0);
  const ts = Math.max(0, Number(tokens_saved) || 0);
  const n = Math.max(0, Number(requests) || 0);
  try {
    const user = await ensureStub();
    const prev = user.customClaims || {};
    const g = prev.sc_g || {};
    const curTin = Number(g.tin) || 0;
    const curTs = Number(g.ts) || 0;
    const curN = Number(g.n) || 0;
    if (g.seeded && curTin >= tin) {
      return readFromClaims(prev);
    }
    const next = {
      tin: Math.max(curTin, tin),
      ts: Math.max(curTs, ts),
      n: Math.max(curN, n),
      seeded: true,
      at: new Date().toISOString(),
    };
    await auth().setCustomUserClaims(STATS_UID, { ...prev, sc_g: next });
    return readFromClaims({ sc_g: next });
  } catch (err) {
    console.warn("global-token-stats seed failed:", err.message || err);
    return null;
  }
}

module.exports = {
  STATS_UID,
  readGlobalTokenStats,
  bumpGlobalTokenStats,
  seedGlobalTokenStats,
  readFromClaims,
};
