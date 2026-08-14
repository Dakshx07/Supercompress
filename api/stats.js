/**
 * Public growth stats.
 *
 * npm "weekly downloads" ≠ unique humans. Publish days, mirrors, CI, and
 * reinstalls inflate that number. Signed-up users = Firebase Auth accounts
 * with an email (real humans who finished dashboard / setup connect).
 *
 * tokens_processed = sum of lifetime (or current-month) tokens_in across
 * human accounts — same Auth meter that bills compress.
 */
const { json } = require("./_lib/http");
const { initFirebaseAdmin } = require("./_lib/auth");
const { isHumanUser } = require("./_lib/founder-usage");
const admin = require("firebase-admin");

const PACKAGES = ["supercompress-proxy", "@agents-npm-packages/supercompress"];
const CACHE_MS = 5 * 60 * 1000; // 5 min — live enough for landing counter
let cache = { at: 0, payload: null };

async function npmWeek(pkg) {
  const url = `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(pkg)}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`npm ${pkg} ${res.status}`);
  const data = await res.json();
  return {
    package: pkg,
    downloads: Number(data.downloads) || 0,
    start: data.start || null,
    end: data.end || null,
  };
}

function accountProcessed(claims = {}) {
  const u = claims.sc_usage || {};
  const life = Number(u.life_in || 0) || 0;
  const month = Number(u.tokens_in || 0) || 0;
  const lifeSaved = Number(u.life_saved || 0) || 0;
  const monthSaved = Number(u.tokens_saved || 0) || 0;
  return {
    tokens_in: Math.max(life, month),
    tokens_saved: Math.max(lifeSaved, monthSaved),
  };
}

async function scanAuthGrowth() {
  if (!initFirebaseAdmin()) return null;
  const auth = admin.auth();
  let pageToken;
  let withEmail = 0;
  let total = 0;
  let tokens_processed = 0;
  let tokens_saved = 0;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const user of page.users) {
      total += 1;
      if (!isHumanUser(user)) continue;
      if (user.email || user.providerData?.some((p) => p.email)) withEmail += 1;
      const rec = accountProcessed(user.customClaims || {});
      tokens_processed += rec.tokens_in;
      tokens_saved += rec.tokens_saved;
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return {
    total_auth_records: total,
    signed_up_users: withEmail,
    tokens_processed,
    tokens_saved,
  };
}

function fmtDownloads(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}k+`;
  return String(n);
}

function fmtTokens(n) {
  const v = Math.max(0, Number(n) || 0);
  if (v >= 1e9) return `${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1).replace(/\.0$/, "")}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(Math.round(v));
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (req.method !== "GET") return json(res, 405, { detail: "Method not allowed", allow: "GET" });

  try {
    if (cache.payload && Date.now() - cache.at < CACHE_MS) {
      return json(res, 200, { ...cache.payload, cached: true });
    }

    const npmRows = await Promise.all(PACKAGES.map((p) => npmWeek(p).catch(() => null)));
    const npm = npmRows.filter(Boolean);
    const npmDownloadsWeek = npm.reduce((s, r) => s + r.downloads, 0);
    const primary = npm.find((r) => r.package === "supercompress-proxy") || npm[0];

    let growth = null;
    try {
      growth = await scanAuthGrowth();
    } catch (err) {
      console.warn("stats: auth scan failed", err.message || err);
    }

    const tokensProcessed = growth?.tokens_processed ?? null;
    const tokensSaved = growth?.tokens_saved ?? null;

    const payload = {
      ok: true,
      npm_downloads_week: npmDownloadsWeek,
      npm_downloads_week_label: fmtDownloads(npmDownloadsWeek),
      npm_primary: primary
        ? {
            package: primary.package,
            downloads: primary.downloads,
            label: fmtDownloads(primary.downloads),
            start: primary.start,
            end: primary.end,
          }
        : null,
      npm_packages: npm,
      signed_up_users: growth?.signed_up_users ?? null,
      auth_records: growth?.total_auth_records ?? null,
      tokens_processed: tokensProcessed,
      tokens_processed_label: tokensProcessed == null ? null : fmtTokens(tokensProcessed),
      tokens_saved: tokensSaved,
      tokens_saved_label: tokensSaved == null ? null : fmtTokens(tokensSaved),
      note:
        "tokens_processed sums account meters (lifetime when present, else current month). npm weekly downloads count install events — not unique people. signed_up_users = Firebase Auth accounts with email.",
      updated_at: new Date().toISOString(),
    };

    cache = { at: Date.now(), payload };
    return json(res, 200, { ...payload, cached: false });
  } catch (err) {
    console.error("stats error", err);
    return json(res, 500, { ok: false, detail: err.message || String(err) });
  }
};

module.exports._test = { accountProcessed, fmtTokens };
