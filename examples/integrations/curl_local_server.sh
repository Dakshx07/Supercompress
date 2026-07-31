#!/usr/bin/env bash
# POST to local dev server — requires: pip install -e ".[serve]" && python scripts/local_web_server.py
set -euo pipefail
curl -sS -X POST "http://127.0.0.1:8790/api/compress" \
  -H "Content-Type: application/json" \
  -d '{
    "context": "def fetch():\n    return None\n\n'"$(printf 'filler line %s\n' {1..80})"'",
    "query": "What does fetch return?",
    "budget_ratio": 0.35,
    "compare": true
  }' | python3 -m json.tool
