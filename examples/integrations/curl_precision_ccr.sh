#!/usr/bin/env bash
# =====================
# SuperCompress API Examples — Precision Mode + CCR
# =====================
# Requirements: curl, jq (optional, for pretty-printing)
# Get your API key: https://supercompress.dev/dashboard
#
# Usage:
#   export SUPERCOMPRESS_API_KEY=sc_live_YOUR_KEY
#   bash examples/integrations/curl_precision_ccr.sh
# =====================

set -euo pipefail

API_BASE="${SUPERCOMPRESS_API_BASE:-https://supercompress.dev}"
API_KEY="${SUPERCOMPRESS_API_KEY:-}"
CONTEXT="${EXAMPLE_CONTEXT:-}"
QUERY="${EXAMPLE_QUERY:-}"

if [ -z "$API_KEY" ]; then
  echo "❌ Set SUPERCOMPRESS_API_KEY first"
  echo "   export SUPERCOMPRESS_API_KEY=sc_live_YOUR_KEY"
  exit 1
fi

if [ -z "$CONTEXT" ]; then
  CONTEXT=$(cat <<-END
The database migration failed at 2026-07-07 10:15:23 UTC.
Error: ERROR: column "email" of relation "users" already exists
Stack trace:
  File "migrate.py", line 142, in run_migration
    execute_sql(query)
  File "db/engine.py", line 87, in execute
    cursor.execute(sql)
  File "db/engine.py", line 67, in execute
    raise MigrationError(cause)
  [20 internal frames collapsed]
  File "alembic/env.py", line 45, in run_migrations
    context.run_migrations()

2026-07-07 10:15:24 INFO: Migration rolled back successfully
2026-07-07 10:15:25 DEBUG: Cache invalidated for migration state
2026-07-07 10:15:25 INFO: Server continuing in degraded mode

Related data:
{
  "migration_id": "mig_20260707_001",
  "status": "failed",
  "affected_tables": ["users", "profiles", "sessions"],
  "schema_version": 42,
  "rolled_back": true,
  "null_field": null,
  "empty_list": [],
  "performance": {"latency_ms": [2, 3, 2, 150, 2, 3, 2, 2, 3, 2, 2, 3, 2, 150, 2]}
}
END
)
fi

if [ -z "$QUERY" ]; then
  QUERY="What error caused the migration to fail and was it rolled back?"
fi

echo "=================================================="
echo "SuperCompress API — Precision Mode & CCR Examples"
echo "=================================================="
echo ""
echo "Context: ${CONTEXT:0:80}..."
echo "Query: $QUERY"
echo ""
echo "Using API key: ${API_KEY:0:12}..."
echo ""

# ===== 1. Standard compiler mode (default) =====
echo "──────────────────────────────────────────────────"
echo "1. COMPILER MODE (default, max savings)"
echo "──────────────────────────────────────────────────"
curl -s -X POST "${API_BASE}/api/v1/compress" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(cat <<-END
{
  "context": $(echo "$CONTEXT" | jq -Rs .),
  "query": $(echo "$QUERY" | jq -Rs .),
  "mode": "compiler"
}
END
)" | jq '{
  mode: .mode // "compiler",
  preprocessor,
  tokens_saved,
  tokens_saved_pct: (.tokens_saved_pct // .kv_savings_pct),
  compression_risk,
  important_kept_pct,
  compressed_preview: (.compressed_text[0:200] + "...")
}'
echo ""

# ===== 2. Precision mode =====
echo "──────────────────────────────────────────────────"
echo "2. PRECISION MODE (quality-first, verifier scored)"
echo "──────────────────────────────────────────────────"
curl -s -X POST "${API_BASE}/api/v1/compress" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(cat <<-END
{
  "context": $(echo "$CONTEXT" | jq -Rs .),
  "query": $(echo "$QUERY" | jq -Rs .),
  "mode": "precision"
}
END
)" | jq '{
  mode: .mode // "precision",
  preprocessor,
  confidence,
  confidence_ok,
  budget_ratio,
  tokens_saved,
  tokens_saved_pct: (.tokens_saved_pct // .kv_savings_pct),
  compression_risk,
  compressed_preview: (.compressed_text[0:200] + "...")
}'
echo ""

# ===== 3. CCR reversible compression =====
echo "──────────────────────────────────────────────────"
echo "3. CCR REVERSIBLE COMPRESSION (with retrieval)"
echo "──────────────────────────────────────────────────"
RESPONSE=$(curl -s -X POST "${API_BASE}/api/v1/compress" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(cat <<-END
{
  "context": $(echo "$CONTEXT" | jq -Rs .),
  "query": $(echo "$QUERY" | jq -Rs .),
  "ccr": true,
  "mode": "compiler"
}
END
)")

echo "Compression response:"
echo "$RESPONSE" | jq '{
  ccr: .ccr,
  tokens_saved,
  tokens_saved_pct: (.tokens_saved_pct // .kv_savings_pct),
  markers_in_output: (.compressed_text | length > 0),
  compressed_preview: (.compressed_text[0:300] + "...")
}'
echo ""

# If a CCR hash was returned, retrieve it
CCR_HASH=$(echo "$RESPONSE" | jq -r '.ccr.hash // empty')
if [ -n "$CCR_HASH" ]; then
  echo "──────────────────────────────────────────────────"
  echo "4. RETRIEVE ORIGINAL (via CCR hash)"
  echo "──────────────────────────────────────────────────"
  curl -s "${API_BASE}/api/retrieve?hash=${CCR_HASH}" \
    -H "X-API-Key: $API_KEY" | jq '{
    hash,
    retrieved_at,
    token_count,
    original_preview: (.original[0:200] + "...")
  }'
  echo ""
fi

echo "=================================================="
echo "Done! Try changing the context or query."
echo "=================================================="
