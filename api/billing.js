/**
 * /api/billing — consolidated billing endpoint.
 *
 * GET  /api/billing  → free allowance + PAYG status (auth required)
 * POST /api/billing  → create checkout or portal session (auth required)
 *   { action: "enable_payg" } | { plan: "payg" }  → Stripe Checkout (metered)
 *   { action: "portal" }                           → Stripe Customer Portal
 *   { action: "cancel" | "reactivate" }            → manage subscription
 */
const { json } = require("./_lib/http");
const { verifyUser } = require("./_lib/auth");
const {
  getStripe,
  getPlan,
  getPlanByPriceId,
  FREE_TOKENS_PER_MONTH,
  USD_PER_MILLION,
  isPaygEnabled,
  billableTokens,
  overageMillions,
  estimatedOverageUsd,
  freeTokensRemaining,
} = require("./_lib/stripe");
const { loadStore } = require("./_lib/store");

async function loadStoreOrEmpty() {
  try {
    return await loadStore();
  } catch (err) {
    if (err.status !== 503) throw err;
    console.warn("Billing continuing without Blob store:", err.message);
    return { keys: {}, usage: {}, subscriptions: {} };
  }
}

async function findStripeBilling(user) {
  const stripe = getStripe();
  const uid = String(user.uid).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  let customer = null;

  const matches = await stripe.customers.search({
    query: `metadata['user_id']:'${uid}'`,
    limit: 1,
  });
  customer = matches.data[0] || null;

  if (!customer && user.email) {
    const byEmail = await stripe.customers.list({ email: user.email, limit: 1 });
    customer = byEmail.data[0] || null;
  }

  if (!customer) return { customer: null, subscription: null };

  if (customer.metadata?.user_id !== user.uid) {
    customer = await stripe.customers.update(customer.id, {
      metadata: { ...customer.metadata, user_id: user.uid },
    });
  }

  const subscriptions = await stripe.subscriptions.list({
    customer: customer.id,
    status: "all",
    limit: 20,
  });
  const priority = ["active", "trialing", "past_due", "unpaid", "incomplete"];
  const subscription = subscriptions.data
    .filter((sub) => sub.status !== "canceled")
    .sort((a, b) => priority.indexOf(a.status) - priority.indexOf(b.status))[0] || null;

  return { customer, subscription };
}

function resolvePlanId(sub, claimsPlan) {
  const fromSub = sub?.plan_id;
  if (fromSub && fromSub !== "free") return fromSub;
  if (claimsPlan && claimsPlan !== "free") return claimsPlan;
  return fromSub || claimsPlan || "free";
}

/* ── GET: free allowance + PAYG status ── */
async function handleGet(req, res, user) {
  const store = await loadStoreOrEmpty();
  const admin = require("firebase-admin");
  const owner = await admin.auth().getUser(user.uid).catch(() => ({ uid: user.uid, customClaims: {} }));
  const claims = owner.customClaims || {};

  let sub = store.subscriptions?.[user.uid];
  if (!sub) {
    try {
      const { customer, subscription } = await findStripeBilling(user);
      if (customer) {
        const priceId = subscription?.items?.data?.[0]?.price?.id;
        sub = {
          stripe_customer_id: customer.id,
          stripe_subscription_id: subscription?.id || null,
          plan_id: subscription ? getPlanByPriceId(priceId).id : "free",
          status: subscription?.status || "active",
          cancel_at_period_end: subscription?.cancel_at_period_end || false,
          current_period_start: subscription?.current_period_start
            ? new Date(subscription.current_period_start * 1000).toISOString()
            : null,
          current_period_end: subscription?.current_period_end
            ? new Date(subscription.current_period_end * 1000).toISOString()
            : null,
        };
      }
    } catch (err) {
      console.warn("Stripe lookup skipped:", err.message || err);
    }
  }

  const planId = resolvePlanId(sub, claims.sc_plan);
  const plan = getPlan(planId);
  const payg = isPaygEnabled(planId);
  const activeSub = sub?.status === "active" || sub?.status === "trialing";

  const periodStart = sub?.current_period_start
    ? new Date(sub.current_period_start)
    : new Date(new Date().toISOString().slice(0, 7) + "-01T00:00:00Z");

  let tokensUsedThisPeriod = 0;
  let requestsThisPeriod = 0;

  const keys = store.keys || {};
  const usage = store.usage || {};
  for (const [keyId, keyRec] of Object.entries(keys)) {
    if (keyRec && keyRec.user_id === user.uid && !keyRec.revoked) {
      const keyUsage = usage[keyId] || {};
      for (const [day, rec] of Object.entries(keyUsage)) {
        if (rec && new Date(day + "T00:00:00Z") >= periodStart) {
          tokensUsedThisPeriod += rec.tokens_in || 0;
          requestsThisPeriod += rec.requests || 0;
        }
      }
    }
  }
  if (tokensUsedThisPeriod === 0 && requestsThisPeriod === 0) {
    const claimUsage = claims.sc_usage;
    const currentMonth = new Date().toISOString().slice(0, 7);
    if (claimUsage?.month === currentMonth) {
      tokensUsedThisPeriod = claimUsage.tokens_in || 0;
      requestsThisPeriod = claimUsage.requests || 0;
    }
  }

  const freeRemaining = freeTokensRemaining(tokensUsedThisPeriod);
  const billable = billableTokens(tokensUsedThisPeriod);
  const overageUsd = estimatedOverageUsd(tokensUsedThisPeriod);

  return json(res, 200, {
    plan: plan.id,
    plan_name: plan.name,
    status: sub?.status || (payg ? "active" : "active"),
    free_tokens_per_month: FREE_TOKENS_PER_MONTH,
    free_tokens_remaining: freeRemaining,
    usd_per_million: USD_PER_MILLION,
    tokens_per_month: FREE_TOKENS_PER_MONTH,
    unlimited: payg,
    max_keys: plan.max_keys,
    tokens_used_this_period: tokensUsedThisPeriod,
    requests_this_period: requestsThisPeriod,
    tokens_remaining: payg ? -1 : freeRemaining,
    billable_tokens: billable,
    overage_millions: overageMillions(tokensUsedThisPeriod),
    estimated_overage_usd: overageUsd,
    usage_pct: FREE_TOKENS_PER_MONTH > 0
      ? Math.min(100, Math.round((Math.min(tokensUsedThisPeriod, FREE_TOKENS_PER_MONTH) / FREE_TOKENS_PER_MONTH) * 10000) / 100)
      : 0,
    period_start: periodStart.toISOString(),
    period_end: sub?.current_period_end
      ? new Date(sub.current_period_end).toISOString()
      : new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    stripe_customer_id: sub?.stripe_customer_id || claims.sc_customer_id || null,
    payg_enabled: payg,
    has_active_subscription: payg && activeSub,
    cancel_at_period_end: sub?.cancel_at_period_end || false,
    price_display: plan.price_display || (payg ? "$1 / 1M tokens" : "Free"),
    // Compact plans list for UI (no legacy fixed tiers)
    plans: [
      {
        id: "free",
        name: "Free",
        tokens_per_month: FREE_TOKENS_PER_MONTH,
        max_keys: getPlan("free").max_keys,
        price: 0,
        price_display: "Free",
        unlimited: false,
      },
      {
        id: "payg",
        name: "Pay as you go",
        tokens_per_month: -1,
        max_keys: getPlan("payg").max_keys,
        price: 0,
        price_display: "$1 / 1M tokens",
        unlimited: true,
        metered: true,
      },
    ],
  });
}

/* ── POST: create checkout or portal session ── */
async function handlePost(req, res, user) {
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const baseUrl = "https://supercompress.dev";
  const store = await loadStoreOrEmpty();
  const storedSub = store.subscriptions?.[user.uid];
  let stripeBilling = { customer: null, subscription: null };
  try {
    stripeBilling = await findStripeBilling(user);
  } catch (err) {
    console.warn("Stripe lookup skipped:", err.message || err);
  }
  const existingSub = storedSub || (stripeBilling.customer ? {
    stripe_customer_id: stripeBilling.customer.id,
    stripe_subscription_id: stripeBilling.subscription?.id || null,
    plan_id: stripeBilling.subscription
      ? getPlanByPriceId(stripeBilling.subscription.items?.data?.[0]?.price?.id).id
      : "free",
    status: stripeBilling.subscription?.status || "active",
  } : null);

  // ── Portal session ──
  if (body.action === "portal") {
    if (!existingSub?.stripe_customer_id) {
      return json(res, 400, { detail: "No billing account found. Enable pay-as-you-go first." });
    }
    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: existingSub.stripe_customer_id,
      return_url: `${baseUrl}/dashboard`,
    });
    return json(res, 200, { url: session.url });
  }

  // ── Cancel subscription (sets cancel_at_period_end) ──
  if (body.action === "cancel") {
    if (!existingSub?.stripe_subscription_id) {
      return json(res, 400, { detail: "No active subscription to cancel" });
    }
    const stripe = getStripe();
    const updated = await stripe.subscriptions.update(
      existingSub.stripe_subscription_id,
      { cancel_at_period_end: true }
    );
    await require("./_lib/store").mutateStore((s) => {
      if (!s.subscriptions) s.subscriptions = {};
      if (s.subscriptions[user.uid]) {
        s.subscriptions[user.uid].cancel_at_period_end = true;
        s.subscriptions[user.uid].status = "active";
        s.subscriptions[user.uid].updated_at = new Date().toISOString();
      }
      return true;
    });
    return json(res, 200, {
      status: "canceled",
      cancel_at_period_end: true,
      current_period_end: new Date(updated.current_period_end * 1000).toISOString(),
      message: "Pay-as-you-go will end at the close of the current billing period. You'll return to the free allowance.",
    });
  }

  // ── Reactivate canceled subscription ──
  if (body.action === "reactivate") {
    if (!existingSub?.stripe_subscription_id) {
      return json(res, 400, { detail: "No subscription to reactivate" });
    }
    const stripe = getStripe();
    const updated = await stripe.subscriptions.update(
      existingSub.stripe_subscription_id,
      { cancel_at_period_end: false }
    );
    await require("./_lib/store").mutateStore((s) => {
      if (!s.subscriptions) s.subscriptions = {};
      if (s.subscriptions[user.uid]) {
        s.subscriptions[user.uid].cancel_at_period_end = false;
        s.subscriptions[user.uid].status = "active";
        s.subscriptions[user.uid].updated_at = new Date().toISOString();
      }
      return true;
    });
    return json(res, 200, {
      status: "active",
      cancel_at_period_end: false,
      message: "Pay-as-you-go reactivated.",
    });
  }

  // ── Enable PAYG checkout (metered) ──
  const enablePayg = body.action === "enable_payg" || body.plan === "payg";
  const planId = enablePayg ? "payg" : (body.plan || "payg");
  const plan = getPlan(planId);

  if (!enablePayg && plan.id === "free") {
    return json(res, 400, { detail: "Invalid plan" });
  }

  if (plan.id !== "payg" && !plan.legacy) {
    return json(res, 400, { detail: "Only pay-as-you-go is available for new subscriptions" });
  }

  if (!plan.price_id) {
    return json(res, 503, { detail: "STRIPE_PRICE_PAYG is not configured" });
  }

  // Already on PAYG / legacy paid → portal
  if (existingSub?.status === "active" && isPaygEnabled(existingSub.plan_id)) {
    if (!existingSub.stripe_customer_id) {
      return json(res, 400, { detail: "Billing account incomplete" });
    }
    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: existingSub.stripe_customer_id,
      return_url: `${baseUrl}/dashboard`,
    });
    return json(res, 200, { url: session.url, redirect_to_portal: true });
  }

  const stripe = getStripe();

  let customerId = existingSub?.stripe_customer_id || stripeBilling.customer?.id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email || undefined,
      metadata: { user_id: user.uid },
    });
    customerId = customer.id;
  }

  // Metered prices: do not set quantity
  const lineItem = plan.metered
    ? { price: plan.price_id }
    : { price: plan.price_id, quantity: 1 };

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [lineItem],
    success_url: `${baseUrl}/dashboard?billing=success`,
    cancel_url: `${baseUrl}/dashboard?billing=cancel`,
    metadata: { user_id: user.uid, plan_id: "payg" },
    subscription_data: {
      metadata: { user_id: user.uid, plan_id: "payg" },
    },
    allow_promotion_codes: true,
    billing_address_collection: "auto",
  });

  return json(res, 200, { url: session.url, session_id: session.id });
}

/* ── Route handler ── */
module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});

  try {
    const user = await verifyUser(req);

    if (req.method === "GET") return handleGet(req, res, user);
    if (req.method === "POST") return handlePost(req, res, user);

    return json(res, 405, { detail: "Method not allowed" });
  } catch (err) {
    console.error("billing error:", err);
    return json(res, err.status || 500, { detail: err.message || String(err) });
  }
};
