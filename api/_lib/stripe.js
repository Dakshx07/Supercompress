/**
 * Stripe client — initialized once per warm lambda.
 * Requires STRIPE_SECRET_KEY env var.
 *
 * Pricing model:
 *   Free:  $5 worth of tokens / month  (= 5M tokens at $1/M)
 *   PAYG:  $1 per million tokens beyond the free allowance (Stripe metered)
 */

let stripeClient = null;

function getStripe() {
  if (stripeClient) return stripeClient;

  const secretKey = (process.env.STRIPE_SECRET_KEY || "").trim();
  if (!secretKey) {
    const err = new Error("Stripe not configured: missing STRIPE_SECRET_KEY");
    err.status = 503;
    throw err;
  }

  const Stripe = require("stripe");
  stripeClient = new Stripe(secretKey, {
    maxNetworkRetries: 2,
  });

  return stripeClient;
}

/** Read an env var, trimming surrounding whitespace/newlines that creep in via copy-paste. */
function envTrim(name, fallback) {
  const v = process.env[name];
  return v != null && String(v).trim() ? String(v).trim() : fallback;
}

/** Free monthly allowance: $5 at $1 / 1M tokens = 5M tokens. */
const FREE_TOKENS_PER_MONTH = 5_000_000;
const USD_PER_MILLION = 1;
const TOKENS_PER_BILLING_UNIT = 1_000_000; // Stripe metered unit = 1M tokens @ $1

/**
 * Plan definitions.
 * Legacy starter/pro/business map to PAYG behavior so existing subscribers are not cut off.
 */
const PLANS = {
  free: {
    id: "free",
    name: "Free",
    tokens_per_month: FREE_TOKENS_PER_MONTH,
    max_keys: 10,
    price_id: null,
    price: 0,
    metered: false,
    sort_order: 0,
  },
  payg: {
    id: "payg",
    name: "Pay as you go",
    tokens_per_month: -1, // unlimited app-side; Stripe meters overage
    max_keys: 25,
    price_id: envTrim("STRIPE_PRICE_PAYG", ""),
    price: 0, // no fixed monthly; $1/M overage
    metered: true,
    price_display: "$1 / 1M tokens",
    sort_order: 1,
  },
  // Legacy paid tiers → treated as PAYG-enabled (unlimited) until canceled
  starter: {
    id: "starter",
    name: "Starter (legacy)",
    tokens_per_month: -1,
    max_keys: 25,
    price_id: envTrim("STRIPE_PRICE_STARTER", "price_1TmKXNRz9FTLt24kUt3UCfmD"),
    price: 1000,
    metered: false,
    legacy: true,
    sort_order: 90,
  },
  pro: {
    id: "pro",
    name: "Pro (legacy)",
    tokens_per_month: -1,
    max_keys: 25,
    price_id: envTrim("STRIPE_PRICE_PRO", "price_1TmKXRRz9FTLt24k0l62nG20"),
    price: 2000,
    metered: false,
    legacy: true,
    sort_order: 91,
  },
  business: {
    id: "business",
    name: "Business (legacy)",
    tokens_per_month: -1,
    max_keys: 100,
    price_id: envTrim("STRIPE_PRICE_BUSINESS", "price_1TmKXYRz9FTLt24kleasb72P"),
    price: 6000,
    metered: false,
    legacy: true,
    sort_order: 92,
  },
};

function getPlan(planId) {
  return PLANS[planId] || PLANS.free;
}

function getPlanByPriceId(priceId) {
  if (!priceId) return PLANS.free;
  for (const plan of Object.values(PLANS)) {
    if (plan.price_id && plan.price_id === priceId) return plan;
  }
  return PLANS.free;
}

/** True if the account can exceed the free monthly allowance. */
function isPaygEnabled(planId) {
  const id = String(planId || "free");
  if (id === "payg") return true;
  // Legacy fixed subscriptions keep unlimited access
  if (id === "starter" || id === "pro" || id === "business") return true;
  return false;
}

function billableTokens(tokensUsed) {
  return Math.max(0, Number(tokensUsed || 0) - FREE_TOKENS_PER_MONTH);
}

/** Whole millions of overage tokens (ceil), for Stripe usage records / estimates. */
function overageMillions(tokensUsed) {
  const billable = billableTokens(tokensUsed);
  if (billable <= 0) return 0;
  return Math.ceil(billable / TOKENS_PER_BILLING_UNIT);
}

function estimatedOverageUsd(tokensUsed) {
  return overageMillions(tokensUsed) * USD_PER_MILLION;
}

function freeTokensRemaining(tokensUsed) {
  return Math.max(0, FREE_TOKENS_PER_MONTH - Number(tokensUsed || 0));
}

/**
 * Report PAYG overage to Stripe (delta only) via Billing Meter Events.
 * Tracks sc_usage.tokens_reported on the owner to avoid double-billing.
 * Meter event: supercompress_tokens_millions (1 unit = 1M tokens = $1).
 */
async function reportPaygUsage(owner, tokensInThisMonth) {
  if (!isPaygEnabled(owner.customClaims?.sc_plan)) return null;
  const status = owner.customClaims?.sc_subscription_status;
  if (status && status !== "active" && status !== "trialing") return null;

  const customerId = owner.customClaims?.sc_customer_id;
  if (!customerId) return null;

  const billable = billableTokens(tokensInThisMonth);
  const month = new Date().toISOString().slice(0, 7);
  const prev = owner.customClaims?.sc_usage?.month === month ? owner.customClaims.sc_usage : {};
  const alreadyReported = Number(prev.tokens_reported || 0);
  const delta = billable - alreadyReported;
  if (delta <= 0) return null;

  // Report in million-token units (ceil of new billable minus ceil of already reported)
  const unitsNow = Math.ceil(billable / TOKENS_PER_BILLING_UNIT);
  const unitsWas = Math.ceil(alreadyReported / TOKENS_PER_BILLING_UNIT);
  const unitDelta = unitsNow - unitsWas;
  if (unitDelta <= 0) {
    return { tokens_reported: billable, units: 0 };
  }

  const eventName = envTrim("STRIPE_METER_EVENT_NAME", "supercompress_tokens_millions");

  try {
    const stripe = getStripe();
    await stripe.billing.meterEvents.create({
      event_name: eventName,
      payload: {
        stripe_customer_id: customerId,
        value: String(unitDelta),
      },
    });

    return { tokens_reported: billable, units: unitDelta };
  } catch (err) {
    console.error("PAYG usage report failed:", err.message || err);
    return null;
  }
}

module.exports = {
  getStripe,
  PLANS,
  getPlan,
  getPlanByPriceId,
  FREE_TOKENS_PER_MONTH,
  USD_PER_MILLION,
  TOKENS_PER_BILLING_UNIT,
  isPaygEnabled,
  billableTokens,
  overageMillions,
  estimatedOverageUsd,
  freeTokensRemaining,
  reportPaygUsage,
};
