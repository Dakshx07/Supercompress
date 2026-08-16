/**
 * Signup onboarding + free-token quests (10,000 each).
 * Durable on Auth claims — no Firestore required.
 */

const ONBOARD_ACTION_TOKENS = 10_000;
const ONBOARD_ACTIONS = ["star", "x_follow", "plugin"];
const HEARD_SOURCES = ["x", "reddit", "linkedin", "instagram", "word_of_mouth"];
const ONBOARD_MAX_AGE_MS = 72 * 60 * 60 * 1000; // only brand-new accounts

const REPO_URL = "https://github.com/Supercompress/Supercompress";
const X_FOLLOW_URL = "https://x.com/arjunkshah21";
const SITE_URL = "https://www.supercompress.dev";

function onboardBonusTokens(claims = {}) {
  const n = Number(claims.sc_onboard_bonus) || 0;
  return Math.max(0, Math.min(ONBOARD_ACTION_TOKENS * ONBOARD_ACTIONS.length, Math.floor(n)));
}

function normalizeHeard(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (s === "twitter") return "x";
  if (s === "wordofmouth" || s === "friend") return "word_of_mouth";
  return HEARD_SOURCES.includes(s) ? s : null;
}

function normalizeAction(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (s === "github" || s === "star_repo") return "star";
  if (s === "twitter" || s === "follow" || s === "x") return "x_follow";
  if (s === "install" || s === "mcp" || s === "coding_agent") return "plugin";
  return ONBOARD_ACTIONS.includes(s) ? s : null;
}

function parseActions(claims = {}) {
  const raw = claims.sc_onboard_actions;
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const key of ONBOARD_ACTIONS) {
    if (raw[key]) out[key] = true;
  }
  return out;
}

function isYoungAccount(owner) {
  const created = Date.parse(owner?.metadata?.creationTime || owner?.metadata?.creation_time || 0);
  if (!Number.isFinite(created)) return false;
  return Date.now() - created < ONBOARD_MAX_AGE_MS;
}

function needsOnboarding(claims = {}, owner = null) {
  if (claims.sc_onboard_done || claims.sc_onboard_skipped) return false;
  if (!owner) return false;
  return isYoungAccount(owner);
}

function needsPowerCelebrate(claims = {}) {
  return String(claims.sc_power_celebrate || "") === "pending";
}

function powerShareIntentUrl({ tokensIn, tokensSaved, cutPct } = {}) {
  const tin = Number(tokensIn) || 0;
  const saved = Number(tokensSaved) || 0;
  const cut = Number(cutPct) || 0;
  const fmt = (n) => {
    if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
    if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
    return String(Math.round(n));
  };
  let brag = `Just hit power user on @arjunkshah21's SuperCompress — 1M+ tokens compressed.`;
  if (tin > 0 && saved > 0) {
    brag = `Just hit power user on SuperCompress — ${fmt(tin)} tokens in, ${fmt(saved)} saved${cut > 0 ? ` (~${cut}% cut)` : ""}.`;
  } else if (tin > 0) {
    brag = `Just hit power user on SuperCompress — crossed ${fmt(tin)} tokens compressed.`;
  }
  brag += `\n\nCut agent context, keep the answer → ${SITE_URL}`;
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(brag)}`;
}

function statusPayload(claims = {}, owner = null) {
  const actions = parseActions(claims);
  const completed = ONBOARD_ACTIONS.filter((a) => actions[a]);
  const bonus = onboardBonusTokens(claims);
  return {
    needs_onboarding: needsOnboarding(claims, owner),
    needs_power_celebrate: needsPowerCelebrate(claims),
    heard: claims.sc_heard || null,
    actions,
    completed_actions: completed,
    bonus_tokens: bonus,
    action_tokens: ONBOARD_ACTION_TOKENS,
    max_bonus_tokens: ONBOARD_ACTION_TOKENS * ONBOARD_ACTIONS.length,
    links: {
      star: REPO_URL,
      x_follow: X_FOLLOW_URL,
      site: SITE_URL,
      plugin_docs: `${SITE_URL}/docs/coding-agents`,
    },
    plugin_commands: [
      "npx supercompress-proxy setup",
      "npm i -g supercompress-proxy && supercompress setup",
    ],
    power_share_url: powerShareIntentUrl({
      tokensIn: claims.sc_usage?.tokens_in,
      tokensSaved: claims.sc_usage?.tokens_saved,
      cutPct:
        claims.sc_usage?.tokens_in > 0
          ? Math.round((Number(claims.sc_usage.tokens_saved || 0) / claims.sc_usage.tokens_in) * 100)
          : 0,
    }),
  };
}

async function mergeOnboardingClaims(uid, mutator) {
  const { patchUserClaims } = require("./billing-ledger");
  return patchUserClaims(uid, (live) => mutator({ ...live }));
}

async function saveHeard(uid, source) {
  const heard = normalizeHeard(source);
  if (!heard) {
    const err = new Error("Invalid source");
    err.status = 400;
    throw err;
  }
  const claims = await mergeOnboardingClaims(uid, (c) => {
    c.sc_heard = heard;
    c.sc_heard_at = new Date().toISOString();
    return c;
  });
  return statusPayload(claims);
}

async function claimAction(uid, actionRaw) {
  const action = normalizeAction(actionRaw);
  if (!action) {
    const err = new Error("Invalid action");
    err.status = 400;
    throw err;
  }
  const claims = await mergeOnboardingClaims(uid, (c) => {
    const actions = parseActions(c);
    if (!actions[action]) {
      actions[action] = true;
      c.sc_onboard_actions = actions;
      const count = ONBOARD_ACTIONS.filter((a) => actions[a]).length;
      c.sc_onboard_bonus = count * ONBOARD_ACTION_TOKENS;
      c.sc_onboard_bonus_at = new Date().toISOString();
    }
    if (ONBOARD_ACTIONS.every((a) => actions[a])) {
      c.sc_onboard_done = true;
    }
    return c;
  });
  return statusPayload(claims);
}

async function skipOnboarding(uid) {
  const claims = await mergeOnboardingClaims(uid, (c) => {
    c.sc_onboard_skipped = true;
    c.sc_onboard_skipped_at = new Date().toISOString();
    return c;
  });
  return statusPayload(claims);
}

async function markOnboardingDone(uid) {
  const claims = await mergeOnboardingClaims(uid, (c) => {
    c.sc_onboard_done = true;
    c.sc_onboard_done_at = new Date().toISOString();
    return c;
  });
  return statusPayload(claims);
}

async function markPowerCelebrateShown(uid) {
  const claims = await mergeOnboardingClaims(uid, (c) => {
    c.sc_power_celebrate = "shown";
    c.sc_power_celebrate_at = new Date().toISOString();
    return c;
  });
  return statusPayload(claims);
}

async function markPowerCelebratePending(uid) {
  try {
    await mergeOnboardingClaims(uid, (c) => {
      if (c.sc_power_celebrate === "shown") return c;
      c.sc_power_celebrate = "pending";
      return c;
    });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  ONBOARD_ACTION_TOKENS,
  ONBOARD_ACTIONS,
  HEARD_SOURCES,
  onboardBonusTokens,
  needsOnboarding,
  needsPowerCelebrate,
  statusPayload,
  saveHeard,
  claimAction,
  skipOnboarding,
  markOnboardingDone,
  markPowerCelebrateShown,
  markPowerCelebratePending,
  powerShareIntentUrl,
  REPO_URL,
  X_FOLLOW_URL,
  SITE_URL,
};
