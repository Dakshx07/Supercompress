#!/usr/bin/env node
/**
 * Validate that byCampaign[campaignId] exists and is a complete tip.
 * Usage: node scripts/validate_weekly_tip.js [campaignId]
 * Exit 0 if valid, 1 otherwise.
 */
const fs = require("fs");
const path = require("path");
const { isoWeekCampaignId } = require("./weekly_tip_campaign_id");

const REQUIRED = [
  "id",
  "subject",
  "tipTitle",
  "tipBody",
  "proof",
  "ctaLabel",
  "ctaUrl",
];

const os = require("os");
const tipsCandidates = [
  process.env.SUPERCOMPRESS_EMAIL_CONTENT_DIR
    ? path.join(process.env.SUPERCOMPRESS_EMAIL_CONTENT_DIR, "weekly-tips.json")
    : null,
  path.join(
    os.homedir(),
    "agent-bridge",
    "private",
    "supercompress-email",
    "content",
    "weekly-tips.json"
  ),
].filter(Boolean);

let tipsPath = tipsCandidates.find((p) => fs.existsSync(p));
if (!tipsPath) {
  console.error(
    "FAIL: weekly-tips.json not found (set SUPERCOMPRESS_EMAIL_CONTENT_DIR or use ~/agent-bridge/private/supercompress-email/content/)"
  );
  process.exit(1);
}
const campaignId = (process.argv[2] || isoWeekCampaignId()).trim();

let data;
try {
  data = JSON.parse(fs.readFileSync(tipsPath, "utf8"));
} catch (e) {
  console.error("FAIL: cannot read weekly-tips.json:", e.message);
  process.exit(1);
}

const tip = data?.byCampaign?.[campaignId];
if (!tip) {
  console.error(`FAIL: no byCampaign tip for ${campaignId}`);
  process.exit(1);
}

const missing = REQUIRED.filter((k) => !String(tip[k] || "").trim());
if (missing.length) {
  console.error(`FAIL: ${campaignId} missing fields: ${missing.join(", ")}`);
  process.exit(1);
}

// Uniqueness vs seed + other campaigns
const subjects = new Set();
for (const s of data.seed || []) {
  if (s?.subject) subjects.add(String(s.subject).trim().toLowerCase());
}
for (const [cid, t] of Object.entries(data.byCampaign || {})) {
  if (cid === campaignId) continue;
  if (t?.subject) subjects.add(String(t.subject).trim().toLowerCase());
}
const subj = String(tip.subject).trim().toLowerCase();
if (subjects.has(subj)) {
  console.error(`FAIL: subject already used: ${tip.subject}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      campaign_id: campaignId,
      tip_id: tip.id,
      subject: tip.subject,
    },
    null,
    2
  )
);
