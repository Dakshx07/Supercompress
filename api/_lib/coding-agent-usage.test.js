/**
 * Unit tests for month-bucketed coding agent usage projection.
 * Run: node api/_lib/coding-agent-usage.test.js
 */
const assert = require("assert");
const { agentUsageForMonth } = require("./coding-agent-usage");

const month = "2026-08";

// Lifetime-only legacy doc from July must not poison August
{
  const out = agentUsageForMonth(
    {
      cursor: {
        requests: 100,
        tokens_in: 1_000_000,
        tokens_saved: 500_000,
        last_seen: "2026-07-30T12:00:00.000Z",
      },
    },
    month
  );
  assert.deepStrictEqual(out, {});
}

// Lifetime-only legacy doc last seen in August counts for August
{
  const out = agentUsageForMonth(
    {
      cursor: {
        requests: 3,
        tokens_in: 300,
        tokens_saved: 100,
        last_seen: "2026-08-05T12:00:00.000Z",
      },
    },
    month
  );
  assert.equal(out.cursor.tokens_in, 300);
  assert.equal(out.cursor.month, month);
}

// Explicit month buckets — only current month
{
  const out = agentUsageForMonth(
    {
      cursor: {
        months: {
          "2026-07": { requests: 50, tokens_in: 9000, tokens_saved: 4000 },
          "2026-08": { requests: 2, tokens_in: 200, tokens_saved: 80 },
        },
        tokens_in: 200, // top-level mirrors current write — ignore for other months
        last_seen: "2026-08-10T00:00:00.000Z",
      },
    },
    month
  );
  assert.equal(out.cursor.tokens_in, 200);
  assert.equal(out.cursor.requests, 2);
  const july = agentUsageForMonth(
    {
      cursor: {
        months: {
          "2026-07": { requests: 50, tokens_in: 9000, tokens_saved: 4000 },
          "2026-08": { requests: 2, tokens_in: 200, tokens_saved: 80 },
        },
      },
    },
    "2026-07"
  );
  assert.equal(july.cursor.tokens_in, 9000);
}

console.log("coding-agent-usage.test.js: ok");
