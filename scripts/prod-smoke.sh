#!/usr/bin/env bash
# Production smoke: static pages + API hosts (www + api) must stay healthy.
# Exits non-zero on any failure. Safe to run anytime / post-deploy.
set -euo pipefail

cd "$(cd "$(dirname "$0")/.." && pwd)"

WWW="${SUPERCOMPRESS_WWW_URL:-https://www.supercompress.dev}"
API="${SUPERCOMPRESS_API_HOST:-https://api.supercompress.dev}"
DOCS="${SUPERCOMPRESS_DOCS_URL:-https://docs.supercompress.dev}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0
fail=0

check() {
  local name="$1" expect="$2" url="$3"
  shift 3
  local body="$TMP/body"
  local code
  code="$(curl -sS -L --max-time 45 -o "$body" -w '%{http_code}' "$@" "$url" || echo 000)"
  if [[ "$code" != "$expect" ]]; then
    echo "FAIL $name — expected HTTP $expect, got $code ($url)"
    head -c 240 "$body" 2>/dev/null | tr '\n' ' '; echo
    fail=$((fail + 1))
    return 1
  fi
  # Guard the exact outage class we hit: edge has no deployment
  if grep -qi 'DEPLOYMENT_NOT_FOUND' "$body" 2>/dev/null; then
    echo "FAIL $name — DEPLOYMENT_NOT_FOUND ($url)"
    fail=$((fail + 1))
    return 1
  fi
  echo "PASS $name ($code)"
  pass=$((pass + 1))
}

expect_body() {
  local name="$1" needle="$2" file="$3"
  if ! grep -q "$needle" "$file"; then
    echo "FAIL $name — response missing '$needle'"
    fail=$((fail + 1))
    return 1
  fi
}

echo "=== SuperCompress production smoke ==="
echo "www=$WWW"
echo "api=$API"
echo "docs=$DOCS"
echo

# Domains / edge
check "www home" 200 "$WWW/"
check "api health" 200 "$API/api/health"
check "www health" 200 "$WWW/api/health"
expect_body "www health body" '"ok":true' "$TMP/body"
check "docs root" 200 "$DOCS/" 

# Marketing / product surfaces
check "dashboard" 200 "$WWW/dashboard"
check "analytics" 200 "$WWW/analytics"
check "token-compression" 200 "$WWW/token-compression"

# Account / auth plumbing (unauthenticated shapes)
check "account ops" 200 "$WWW/api/account"
expect_body "account ops body" '"ok":true' "$TMP/body"
check "api account ops" 200 "$API/api/account"
check "auth-status" 200 "$WWW/api/auth-status"
expect_body "auth-status firestore" '"storage":"firestore"' "$TMP/body"
check "firebase-config" 200 "$WWW/api/firebase-config"
expect_body "firebase-config key" 'apiKey' "$TMP/body"
check "usage requires auth" 200 "$WWW/api/usage"
expect_body "usage auth" 'auth' "$TMP/body"
check "billing requires auth" 200 "$WWW/api/billing"

# Compress entrypoints (must reject missing key, never 5xx / DEPLOYMENT_NOT_FOUND)
COMPRESS_JSON='{"context":"production smoke context for supercompress","query":"smoke"}'
for host_label in www api; do
  base="$WWW"
  [[ "$host_label" == api ]] && base="$API"
  for path in /api/v1/compress /v1/compress /api/compress; do
    check "${host_label} POST ${path}" 401 "$base$path" \
      -X POST -H 'content-type: application/json' --data "$COMPRESS_JSON"
    expect_body "${host_label} ${path} body" 'API key' "$TMP/body"
  done
done

# GET compress must be method-not-allowed (not 5xx)
check "www GET compress" 405 "$WWW/api/v1/compress"
check "api GET compress" 405 "$API/api/v1/compress"

# Optional authenticated compress (if local key present)
KEY=""
CFG="${SUPERCOMPRESS_CONFIG_DIR:-$HOME/.supercompress}/config.json"
if [[ -f "$CFG" ]]; then
  KEY="$(python3 -c "import json; print(json.load(open('$CFG')).get('api_key') or '')" 2>/dev/null || true)"
fi
if [[ -n "${SUPERCOMPRESS_API_KEY:-}" ]]; then
  KEY="$SUPERCOMPRESS_API_KEY"
fi

if [[ -n "$KEY" ]]; then
  echo
  echo "=== Authenticated compress ==="
  for host_label in www api; do
    base="$WWW"
    [[ "$host_label" == api ]] && base="$API"
    body="$TMP/auth-$host_label"
    code="$(curl -sS --max-time 60 -o "$body" -w '%{http_code}' \
      -X POST "$base/api/v1/compress" \
      -H "X-API-Key: $KEY" \
      -H 'content-type: application/json' \
      --data "$COMPRESS_JSON" || echo 000)"
    if [[ "$code" != "200" ]]; then
      echo "FAIL auth compress on $host_label — HTTP $code"
      head -c 300 "$body"; echo
      fail=$((fail + 1))
    else
      echo "PASS auth compress on $host_label (200)"
      pass=$((pass + 1))
    fi
  done
else
  echo
  echo "SKIP authenticated compress (no SUPERCOMPRESS_API_KEY / ~/.supercompress/config.json)"
fi

echo
echo "=== Result: $pass passed, $fail failed ==="
if ((fail > 0)); then
  exit 1
fi
echo "production smoke OK"
