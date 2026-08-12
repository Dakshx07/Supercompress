/**
 * Unit tests for 1M power-user milestone (no Firebase / Resend).
 * Run: node api/_lib/power-user.test.js
 */
const assert = require("assert");
const { powerUserCopy } = require("./mail");
const {
  POWER_USER_TOKENS,
  crossedPowerUser,
  statsFromUsage,
  firstNameFromUser,
  isDrainablePowerUser,
} = require("./power-user");

assert.strictEqual(POWER_USER_TOKENS, 1_000_000);

assert.strictEqual(crossedPowerUser(0, 999_999), false);
assert.strictEqual(crossedPowerUser(999_999, 1_000_000), true);
assert.strictEqual(crossedPowerUser(1_000_000, 1_000_001), false);
assert.strictEqual(crossedPowerUser(1_400_000, 1_500_000), false);
assert.strictEqual(crossedPowerUser(800_000, 1_200_000), true);
assert.strictEqual(crossedPowerUser("900000", "1000001"), true);

{
  const s = statsFromUsage({ tokensIn: 1_000_000, tokensSaved: 400_000, requests: 12 });
  assert.strictEqual(s.cutPct, 40);
  assert.strictEqual(s.morePct, 67);
}

assert.strictEqual(firstNameFromUser({ displayName: "Arjun Shah" }), "Arjun");
assert.strictEqual(firstNameFromUser({ email: "maya.k@example.com" }), "maya");

assert.strictEqual(
  isDrainablePowerUser({ uid: "u1", status: "pending", email: "a@b.com" }),
  true
);
assert.strictEqual(
  isDrainablePowerUser({ uid: "u1", status: "failed", email: "a@b.com" }),
  true
);
assert.strictEqual(
  isDrainablePowerUser({ uid: "u1", status: "sent", email: "a@b.com" }),
  false
);
assert.strictEqual(
  isDrainablePowerUser({ uid: "u1", status: "pending", email: "" }),
  false
);
assert.strictEqual(isDrainablePowerUser(null), false);

{
  const copy = powerUserCopy({
    firstName: "Maya",
    email: "maya@example.com",
    tokensIn: 1_050_000,
    tokensSaved: 420_000,
    requests: 80,
    cutPct: 40,
    morePct: 67,
  });
  assert.match(copy.subject, /power user/i);
  assert.match(copy.text, /SuperCompress power user/i);
  assert.match(copy.text, /million tokens/i);
  assert.doesNotMatch(copy.text, /leaderboard/i);
  assert.doesNotMatch(copy.html, /leaderboard/i);
  assert.match(copy.html, /\$0\.30 per million/i);
}

{
  const copy = powerUserCopy({
    firstName: "Maya",
    email: "maya@example.com",
    rank: 11,
    tokensIn: 1_050_000,
    tokensSaved: 420_000,
    requests: 80,
    cutPct: 40,
    morePct: 67,
  });
  assert.match(copy.text, /11th/);
  assert.match(copy.html, /leaderboard/i);
}

console.log("power-user tests ok");
