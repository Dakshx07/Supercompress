#!/usr/bin/env bash
# Create Stripe metered product/price for SuperCompress PAYG ($1 / 1M tokens).
# Requires: stripe CLI logged in (stripe login)
# Usage: bash scripts/create-stripe-products.sh [--live]
set -euo pipefail

LIVE_FLAG=""
if [ "${1:---test}" = "--live" ]; then
  echo "Creating STRIPE_PRICE_PAYG on LIVE mode..."
  LIVE_FLAG="--live"
else
  echo "Creating STRIPE_PRICE_PAYG on TEST mode..."
fi

echo ""
echo "=== Pay as you go (\$1 per 1M tokens, metered via Billing Meter) ==="
echo "Free allowance (\$5 / 5M tokens/mo) is enforced in-app, not via Stripe."

PAYG=$(stripe products create $LIVE_FLAG --confirm \
  --name="SuperCompress Pay-as-you-go" \
  --description="\$1 per million tokens after the \$5 free monthly allowance (5M tokens)" \
  -d "metadata[plan_id]=payg" \
  -d "metadata[usd_per_million]=1" \
  -d "metadata[free_tokens_per_month]=5000000")
PAYG_ID=$(echo "$PAYG" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Product: $PAYG_ID"

METER=$(stripe billing meters create $LIVE_FLAG --confirm \
  --display-name="SuperCompress token millions" \
  --event-name="supercompress_tokens_millions" \
  -d "default_aggregation[formula]=sum" \
  -d "customer_mapping[type]=by_id" \
  -d "customer_mapping[event_payload_key]=stripe_customer_id" \
  -d "value_settings[event_payload_key]=value")
METER_ID=$(echo "$METER" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Meter: $METER_ID (event: supercompress_tokens_millions)"

PAYG_PRICE=$(stripe prices create $LIVE_FLAG --confirm \
  --product="$PAYG_ID" \
  --currency=usd \
  --unit-amount=100 \
  -d "recurring[interval]=month" \
  -d "recurring[usage_type]=metered" \
  -d "recurring[meter]=$METER_ID" \
  -d "billing_scheme=per_unit" \
  -d "nickname=1M tokens" \
  -d "metadata[plan_id]=payg" \
  -d "metadata[unit]=1M_tokens" \
  -d "metadata[meter_event]=supercompress_tokens_millions")
PAYG_PRICE_ID=$(echo "$PAYG_PRICE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Price (metered): $PAYG_PRICE_ID"

echo ""
echo "========== SET THE FOLLOWING ENV VARS ON VERCEL =========="
echo "STRIPE_PRICE_PAYG=$PAYG_PRICE_ID"
echo "STRIPE_METER_EVENT_NAME=supercompress_tokens_millions"
echo "STRIPE_PUBLISHABLE_KEY=pk_..."
echo "STRIPE_SECRET_KEY=sk_..."
echo "STRIPE_WEBHOOK_SECRET=whsec_..."
echo ""
echo "Webhook endpoint: https://supercompress.dev/api/billing/webhook"
echo "Events: checkout.session.completed, customer.subscription.updated,"
echo "        customer.subscription.created, customer.subscription.deleted"
echo ""
echo "Pricing: \$5 free tokens/month (5M) + \$1 / 1M tokens overage via meter events."
