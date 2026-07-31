/**
 * API key store — Firestore via config/store (keys + hash_index + usage).
 *
 * Historically keys were stored as fake Firebase Auth users (uid `sck_*`),
 * which polluted the Auth console with "anonymous / no email" rows. New keys
 * never touch Auth. Old Auth-backed keys are migrated into Firestore on use.
 *
 * Owner billing usage (`sc_usage` custom claims) still lives on the real
 * signed-in user account — only that user appears in Auth.
 */

const crypto = require("crypto");
const admin = require("firebase-admin");
const { initFirebaseAdmin } = require("./auth");
const { KEY_PREFIX, hashApiKey, generateApiKey, verifyApiKey } = require("./keys");
const {
  loadStore,
  mutateStore,
  listUserKeys,
  userUsage,
  snapshotForKey,
  publicKey: storePublicKey,
} = require("./store");

const KEY_UID_PREFIX = "sck_";

function auth() {
  if (!initFirebaseAdmin()) {
    const err = new Error("Firebase Admin is not configured");
    err.status = 503;
    throw err;
  }
  return admin.auth();
}

function keyUidFromSecret(secret) {
  if (!secret?.startsWith(KEY_PREFIX)) return null;
  const rest = secret.slice(KEY_PREFIX.length);
  const split = rest.indexOf("_", KEY_UID_PREFIX.length);
  const uid = split > 0 ? rest.slice(0, split) : "";
  return uid.startsWith(KEY_UID_PREFIX) ? uid : null;
}

function publicKey(rec) {
  return storePublicKey(rec);
}

function usageSnapshot(recOrId, store) {
  if (typeof recOrId === "string") {
    return snapshotForKey(store || { usage: {} }, recOrId);
  }
  if (recOrId?.customClaims?.sc_usage) {
    const u = recOrId.customClaims.sc_usage || {};
    return {
      total_requests: u.requests || 0,
      total_tokens_in: u.tokens_in || 0,
      total_tokens_out: u.tokens_out || 0,
      total_tokens_saved: u.tokens_saved || 0,
      by_day: {},
    };
  }
  const id = recOrId?.id;
  if (!id) {
    return {
      total_requests: 0,
      total_tokens_in: 0,
      total_tokens_out: 0,
      total_tokens_saved: 0,
      by_day: {},
    };
  }
  return snapshotForKey(store || { usage: {} }, id);
}

async function ownerRecord(ownerUid) {
  return auth().getUser(ownerUid);
}

/**
 * Import an Auth-backed API key user into Firestore once, then optionally
 * delete the stub Auth user so the console stays email-only.
 */
async function migrateAuthKeyToStore(authUser, secret) {
  const c = authUser.customClaims || {};
  if (!c.sc_api_key || !c.sc_owner || !c.sc_hash) return null;

  const id = authUser.uid;
  const migrated = await mutateStore((store) => {
    if (store.keys[id] && !store.keys[id].revoked) {
      store.hash_index[c.sc_hash] = id;
      return store.keys[id];
    }
    const rec = {
      id,
      user_id: c.sc_owner,
      name: c.sc_name || "Production",
      prefix: c.sc_prefix || (secret ? secret.slice(0, 16) : ""),
      key_hash: c.sc_hash,
      created_at: c.sc_created || authUser.metadata?.creationTime || new Date().toISOString(),
      last_used_at: c.sc_last || null,
      revoked: Boolean(authUser.disabled),
      migrated_from_auth: true,
    };
    store.keys[id] = rec;
    store.hash_index[c.sc_hash] = id;
    if (!store.usage[id]) store.usage[id] = {};
    return rec;
  });

  // Best-effort remove stub from Auth so the dashboard shows real users only.
  try {
    if (!authUser.email && id.startsWith(KEY_UID_PREFIX)) {
      await auth().deleteUser(id);
      const owner = await auth().getUser(c.sc_owner).catch(() => null);
      if (owner) {
        const claims = { ...(owner.customClaims || {}) };
        if (Array.isArray(claims.sc_key_ids)) {
          claims.sc_key_ids = claims.sc_key_ids.filter((x) => x !== id);
          await auth().setCustomUserClaims(owner.uid, claims);
        }
      }
    }
  } catch (err) {
    console.warn("migrateAuthKeyToStore: could not delete stub Auth user", id, err.message);
  }

  return migrated;
}

async function findAuthBackedKey(secret) {
  const uid = keyUidFromSecret(secret);
  if (!uid) return null;
  const user = await auth().getUser(uid).catch(() => null);
  const c = user?.customClaims || {};
  if (!user || user.disabled || !c.sc_api_key || !verifyApiKey(secret, c.sc_hash || "")) {
    return null;
  }
  return user;
}

async function listKeys(ownerUid) {
  const store = await loadStore({ forceRemote: true });

  // One-time pull of any remaining Auth-indexed keys for this owner.
  try {
    const owner = await ownerRecord(ownerUid);
    const ids = Array.isArray(owner.customClaims?.sc_key_ids) ? owner.customClaims.sc_key_ids : [];
    for (const uid of ids) {
      if (store.keys[uid]) continue;
      const user = await auth().getUser(uid).catch(() => null);
      if (user?.customClaims?.sc_api_key) {
        await migrateAuthKeyToStore(user, null);
      }
    }
  } catch (err) {
    console.warn("listKeys: Auth migration skipped:", err.message);
  }

  const fresh = await loadStore({ forceRemote: true });
  return {
    keys: listUserKeys(fresh, ownerUid).map(publicKey),
    usage: userUsage(fresh, ownerUid),
  };
}

async function createKey(ownerUid, name, maxKeys) {
  await ownerRecord(ownerUid); // ensure real account exists

  return mutateStore((store) => {
    const active = listUserKeys(store, ownerUid);
    if (active.length >= maxKeys) {
      const err = new Error(`Plan limit reached: ${maxKeys} API keys. Upgrade to increase this limit.`);
      err.status = 429;
      throw err;
    }

    const gen = generateApiKey();
    const id = `key_${crypto.randomBytes(12).toString("hex")}`;
    const created = new Date().toISOString();
    const rec = {
      id,
      user_id: ownerUid,
      name: String(name || "Production").trim().slice(0, 80) || "Production",
      prefix: gen.prefix,
      key_hash: gen.key_hash,
      created_at: created,
      last_used_at: null,
      revoked: false,
    };
    store.keys[id] = rec;
    store.hash_index[gen.key_hash] = id;
    store.usage[id] = {};
    return { key: publicKey(rec), secret: gen.full_key };
  });
}

async function getOwnedKey(ownerUid, keyUid) {
  const store = await loadStore({ forceRemote: true });
  let rec = store.keys[keyUid];

  if (!rec) {
    const user = await auth().getUser(keyUid).catch(() => null);
    if (user?.customClaims?.sc_owner === ownerUid && user.customClaims?.sc_api_key) {
      rec = await migrateAuthKeyToStore(user, null);
    }
  }

  if (!rec || rec.user_id !== ownerUid || rec.revoked) {
    const err = new Error("Key not found");
    err.status = 404;
    throw err;
  }
  return rec;
}

async function renameKey(ownerUid, keyUid, name) {
  await getOwnedKey(ownerUid, keyUid);
  return mutateStore((store) => {
    const rec = store.keys[keyUid];
    if (!rec || rec.user_id !== ownerUid || rec.revoked) {
      const err = new Error("Key not found");
      err.status = 404;
      throw err;
    }
    rec.name = String(name).trim().slice(0, 80);
    store.keys[keyUid] = rec;
    return publicKey(rec);
  });
}

async function revokeKey(ownerUid, keyUid) {
  const existing = await getOwnedKey(ownerUid, keyUid);
  const revoked = await mutateStore((store) => {
    const rec = store.keys[keyUid];
    if (!rec || rec.user_id !== ownerUid) {
      const err = new Error("Key not found");
      err.status = 404;
      throw err;
    }
    rec.revoked = true;
    store.keys[keyUid] = rec;
    if (rec.key_hash && store.hash_index[rec.key_hash] === keyUid) {
      delete store.hash_index[rec.key_hash];
    }
    return { ...publicKey(rec), revoked: true };
  });

  // Clean legacy Auth stub if it still exists
  if (keyUid.startsWith(KEY_UID_PREFIX)) {
    try {
      await auth().deleteUser(keyUid);
    } catch (_) {}
  }

  return revoked || { ...publicKey(existing), revoked: true };
}

async function authenticateKey(secret) {
  if (!secret?.startsWith(KEY_PREFIX)) {
    const err = new Error("Invalid API key");
    err.status = 401;
    throw err;
  }

  const store = await loadStore();
  const digest = hashApiKey(secret);
  const keyId = store.hash_index[digest];
  let rec = keyId ? store.keys[keyId] : null;

  if (!rec || rec.revoked || !verifyApiKey(secret, rec.key_hash || "")) {
    const authUser = await findAuthBackedKey(secret);
    if (!authUser) {
      const err = new Error("Invalid API key");
      err.status = 401;
      throw err;
    }
    rec = await migrateAuthKeyToStore(authUser, secret);
    if (!rec || rec.revoked || !verifyApiKey(secret, rec.key_hash || "")) {
      const err = new Error("Invalid API key");
      err.status = 401;
      throw err;
    }
  }

  const owner = await auth().getUser(rec.user_id);
  return { user: rec, owner, ownerUid: rec.user_id, keyId: rec.id };
}

async function recordUsage(keyRec, owner, compressed) {
  const keyId = keyRec.id || keyRec.uid;
  const day = new Date().toISOString().slice(0, 10);
  const tokensSaved = Math.max(0, compressed.original_tokens - compressed.kept_tokens);
  const now = new Date().toISOString();

  await mutateStore((store) => {
    if (!store.keys[keyId]) return null;
    store.keys[keyId].last_used_at = now;
    if (!store.usage[keyId]) store.usage[keyId] = {};
    if (!store.usage[keyId][day]) {
      store.usage[keyId][day] = {
        key_id: keyId,
        requests: 0,
        tokens_in: 0,
        tokens_out: 0,
        tokens_saved: 0,
      };
    }
    const u = store.usage[keyId][day];
    u.requests += 1;
    u.tokens_in += compressed.original_tokens;
    u.tokens_out += compressed.kept_tokens;
    u.tokens_saved += tokensSaved;
    return u;
  });

  // Owner monthly usage stays on the real Auth user for billing enforcement.
  const month = now.slice(0, 7);
  const ownerClaims = owner.customClaims || {};
  const ownerPrevious = ownerClaims.sc_usage?.month === month ? ownerClaims.sc_usage : {};
  const ownerTokensIn = (ownerPrevious.tokens_in || 0) + compressed.original_tokens;
  let ownerUsage = {
    month,
    requests: (ownerPrevious.requests || 0) + 1,
    tokens_in: ownerTokensIn,
    tokens_out: (ownerPrevious.tokens_out || 0) + compressed.kept_tokens,
    tokens_saved: (ownerPrevious.tokens_saved || 0) + tokensSaved,
    tokens_reported: ownerPrevious.tokens_reported || 0,
  };

  try {
    const { reportPaygUsage, isPaygEnabled } = require("./stripe");
    if (isPaygEnabled(ownerClaims.sc_plan)) {
      const freshOwner = {
        ...owner,
        customClaims: { ...ownerClaims, sc_usage: ownerUsage },
      };
      const reported = await reportPaygUsage(freshOwner, ownerTokensIn);
      if (reported?.tokens_reported != null) {
        ownerUsage.tokens_reported = reported.tokens_reported;
      }
    }
  } catch (err) {
    console.error("PAYG meter skipped:", err.message || err);
  }

  await auth().setCustomUserClaims(owner.uid, {
    ...ownerClaims,
    sc_usage: ownerUsage,
  });
  owner.customClaims = { ...ownerClaims, sc_usage: ownerUsage };
  return ownerUsage;
}

module.exports = {
  listKeys,
  createKey,
  getOwnedKey,
  renameKey,
  revokeKey,
  authenticateKey,
  recordUsage,
  publicKey,
  usageSnapshot,
  KEY_UID_PREFIX,
  migrateAuthKeyToStore,
};
