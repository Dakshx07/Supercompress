/**
 * Run: node api/stats.test.js
 */
const assert = require("assert");
const { accountProcessed, fmtTokens, fmtFull } = require("./stats.js")._test;

assert.strictEqual(fmtTokens(0), "0");
assert.strictEqual(fmtTokens(1500), "1.5k");
assert.strictEqual(fmtTokens(2_100_000), "2.1M");
assert.strictEqual(fmtFull(48612345), "48,612,345");
assert.strictEqual(fmtFull(19_000_000), "19,000,000");

assert.deepStrictEqual(accountProcessed({ sc_usage: { tokens_in: 100, tokens_saved: 40 } }), {
  tokens_in: 100,
  tokens_saved: 40,
});
assert.deepStrictEqual(
  accountProcessed({ sc_usage: { tokens_in: 100, life_in: 9_000_000, life_saved: 4_000_000, tokens_saved: 40 } }),
  { tokens_in: 9_000_000, tokens_saved: 4_000_000 }
);

console.log("stats.test.js: ok");
