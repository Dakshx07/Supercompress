/**
 * POST /api/billing-webhook
 * Stripe webhook handler — processes checkout.completed, subscription.updated/deleted.
 * Separate from billing.js because it needs raw body parsing and no auth.
 */
const { getStripe, getPlanByPriceId } = require("./_lib/stripe");
const { mutateStore } = require("./_lib/store");
const { initFirebaseAdmin } = require("./_lib/auth");
const admin = require("firebase-admin");

module.exports.config = { api: { bodyParser: false } };

function corsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Stripe-Signature");
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function updateBillingClaims(userId, data) {
  if (!userId || !initFirebaseAdmin()) return;
  const user = await admin.auth().getUser(userId);
  await admin.auth().setCustomUserClaims(userId, {
    ...(user.customClaims || {}),
    sc_plan: data.plan_id || "free",
    sc_subscription_status: data.status || "active",
    sc_customer_id: data.stripe_customer_id || user.customClaims?.sc_customer_id || null,
    sc_subscription_id: data.stripe_subscription_id || user.customClaims?.sc_subscription_id || null,
  });
}

async function persistSubscription(userId, data) {
  await updateBillingClaims(userId, data);
  try {
    await mutateStore((s) => {
      if (!s.subscriptions) s.subscriptions = {};
      s.subscriptions[userId] = { ...(s.subscriptions[userId] || {}), ...data };
      return true;
    });
  } catch (err) {
    if (err.status !== 503) throw err;
    console.warn("Subscription saved to Firebase; Blob mirror unavailable:", err.message);
  }
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { corsHeaders(res); return res.status(204).end(); }
  if (req.method !== "POST") { corsHeaders(res); return res.status(405).json({ detail: "Method not allowed" }); }

  const sig = req.headers["stripe-signature"];
  if (!sig) { corsHeaders(res); return res.status(400).json({ detail: "Missing Stripe-Signature header" }); }

  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!webhookSecret) { corsHeaders(res); return res.status(503).json({ detail: "Webhook secret not configured" }); }

  try {
    const stripe = getStripe();
    const rawBody = await readRawBody(req);
    const event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.metadata?.user_id;
        const planId = session.metadata?.plan_id;
        if (userId && planId) {
          const subscriptionId = session.subscription;
          let data = {};
          if (subscriptionId) {
            const sub = await stripe.subscriptions.retrieve(subscriptionId);
            data = { stripe_subscription_id: sub.id, stripe_customer_id: session.customer, plan_id: planId, status: sub.status, current_period_start: new Date(sub.current_period_start * 1000).toISOString(), current_period_end: new Date(sub.current_period_end * 1000).toISOString(), updated_at: new Date().toISOString() };
          } else {
            data = { stripe_customer_id: session.customer, plan_id: planId, status: "active", updated_at: new Date().toISOString() };
          }
          await persistSubscription(userId, data);
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const sub = event.data.object;
        const priceId = sub.items?.data?.[0]?.price?.id;
        let planId = sub.metadata?.plan_id || getPlanByPriceId(priceId)?.id || "free";
        // Map any known paid price (incl. legacy starter/pro/business) to payg behavior
        // while preserving legacy plan_id for existing fixed subs until they cancel.
        if (planId === "free" && priceId) {
          const mapped = getPlanByPriceId(priceId);
          if (mapped?.id && mapped.id !== "free") planId = mapped.id;
        }
        // New metered price always → payg
        if (getPlanByPriceId(priceId)?.id === "payg") planId = "payg";
        const customer = await stripe.customers.retrieve(sub.customer);
        const userId = sub.metadata?.user_id || customer.metadata?.user_id;
        if (userId) {
          await persistSubscription(userId, {
            stripe_customer_id: sub.customer,
            stripe_subscription_id: sub.id,
            plan_id: planId,
            status: sub.status,
            cancel_at_period_end: sub.cancel_at_period_end || false,
            current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
            current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const customer = await stripe.customers.retrieve(sub.customer);
        const userId = sub.metadata?.user_id || customer.metadata?.user_id;
        if (userId) {
          await persistSubscription(userId, {
            stripe_customer_id: sub.customer,
            stripe_subscription_id: sub.id,
            plan_id: "free",
            status: "canceled",
            updated_at: new Date().toISOString(),
          });
        }
        break;
      }
    }

    corsHeaders(res);
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Webhook error:", err);
    corsHeaders(res);
    return res.status(400).json({ detail: `Webhook Error: ${err.message}` });
  }
};
