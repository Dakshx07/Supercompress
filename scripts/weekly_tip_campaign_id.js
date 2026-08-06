#!/usr/bin/env node
/** Print ISO week campaign id matching api/_lib/weekly.js (UTC). */
function isoWeekCampaignId(date = new Date()) {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

if (require.main === module) {
  process.stdout.write(isoWeekCampaignId() + "\n");
}

module.exports = { isoWeekCampaignId };
