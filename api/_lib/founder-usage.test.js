/**
 * Run: node api/_lib/founder-usage.test.js
 */
const assert = require("assert");
const {
  rowFromUser,
  summarizeRows,
  mergeStoreDays,
  isHumanUser,
  cutPct,
} = require("./founder-usage");

assert.strictEqual(cutPct(50, 100), 50);
assert.strictEqual(isHumanUser({ uid: "sck_abc", email: "x@y.com" }), false);
assert.strictEqual(isHumanUser({ uid: "u1", email: "a@b.com" }), true);
assert.strictEqual(isHumanUser({ uid: "u1", disabled: true, email: "a@b.com" }), false);

const month = "2026-08";
const rows = [
  rowFromUser(
    {
      uid: "a",
      email: "one@x.com",
      displayName: "One",
      customClaims: { sc_plan: "payg", sc_usage: { month, tokens_in: 2_000_000, tokens_out: 200_000, tokens_saved: 1_600_000, requests: 40 } },
      metadata: {},
    },
    month
  ),
  rowFromUser(
    {
      uid: "b",
      email: "two@x.com",
      displayName: "Two",
      customClaims: { sc_plan: "free", sc_usage: { month, tokens_in: 100_000, tokens_saved: 40_000, requests: 8 } },
      metadata: {},
    },
    month
  ),
  rowFromUser(
    {
      uid: "c",
      email: "old@x.com",
      customClaims: { sc_usage: { month: "2026-07", tokens_in: 9_000_000, tokens_saved: 1 } },
      metadata: {},
    },
    month
  ),
];

const sum = summarizeRows(rows, month);
assert.strictEqual(sum.totals.users, 3);
assert.strictEqual(sum.totals.users_with_usage, 2);
assert.strictEqual(sum.totals.tokens_in, 2_100_000);
assert.strictEqual(sum.totals.processed, 11_100_000);
assert.strictEqual(sum.leaderboard[0].email, "one@x.com");
assert.ok(sum.totals.cut_pct > 0);

const days = mergeStoreDays({
  usage: {
    k1: { by_day: { "2026-08-01": { tokens_in: 10, tokens_saved: 4, requests: 1 } } },
    k2: { by_day: { "2026-08-01": { tokens_in: 5, tokens_saved: 2, requests: 2 }, reconcile: { tokens_in: 99 } } },
  },
});
assert.strictEqual(days["2026-08-01"].tokens_in, 15);
assert.strictEqual(days["2026-08-01"].requests, 3);
assert.ok(!days.reconcile);

console.log("founder-usage.test.js: ok");
