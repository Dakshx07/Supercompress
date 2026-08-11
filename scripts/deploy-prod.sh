#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--check" || "${1:-}" == "--dry-run" ]]; then
  echo "Running release checks only (no deployment)."
  npm ci --omit=optional --ignore-scripts --no-audit --no-fund
  npm run release:check
  exit 0
fi

if ! command -v vercel >/dev/null 2>&1; then
  echo "Missing Vercel CLI. Install it with: npm install --global vercel" >&2
  exit 1
fi

npm ci --omit=optional --ignore-scripts --no-audit --no-fund
npm run release:check
vercel deploy --prod --yes

# Critical: api.supercompress.dev (and siblings) must stay aliased or the API
# returns DEPLOYMENT_NOT_FOUND under wildcard DNS — total outage class.
bash scripts/ensure-prod-domains.sh
bash scripts/prod-smoke.sh
