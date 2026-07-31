#!/usr/bin/env bash
set -euo pipefail

cd "$(cd "$(dirname "$0")/.." && pwd)"

npm run release:check

live_url="${SUPERCOMPRESS_LIVE_URL:-https://supercompress.dev}"
homepage="$(curl -fsSL --max-time 20 "$live_url/")"
docs="$(curl -fsSL --max-time 20 "$live_url/docs/coding-agents")"
auth_status="$(curl -fsSL --max-time 20 "$live_url/api/auth-status")"

grep -q 'id="coding-agents"' <<<"$homepage"
grep -q 'npm install supercompress-proxy' <<<"$homepage"
grep -q 'supercompress-proxy' <<<"$docs"
grep -q '"storage":"firestore"' <<<"$auth_status"

status="$(curl -L -sS --max-time 20 -o /tmp/supercompress-launch-api-response -w '%{http_code}' -X POST "$live_url/api/v1/compress" -H 'content-type: application/json' --data '{"context":"launch smoke","query":"launch"}')"
[[ "$status" == "401" ]]
grep -q 'Missing or invalid API key' /tmp/supercompress-launch-api-response

echo "hard launch checks passed for $live_url"
