#!/usr/bin/env bash
set -euo pipefail

cd "$(cd "$(dirname "$0")/.." && pwd)"

npm run release:check
bash scripts/ensure-prod-domains.sh
bash scripts/prod-smoke.sh

live_url="${SUPERCOMPRESS_LIVE_URL:-https://www.supercompress.dev}"
homepage="$(curl -fsSL --max-time 20 "$live_url/")"
docs="$(curl -fsSL --max-time 20 "$live_url/docs/coding-agents")"

grep -q 'id="coding-agents"' <<<"$homepage"
grep -Eq 'npm install (-g )?supercompress-proxy' <<<"$homepage"
grep -q 'supercompress setup' <<<"$homepage"
grep -q 'supercompress-proxy' <<<"$docs"

echo "hard launch checks passed for $live_url"
