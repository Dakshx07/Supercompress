#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

node --check api/account.js
node --check api/v1/compress.js
node --check web/assets/js/supercompress.js

node - <<'NODE'
const fs = require('fs');
const html = fs.readFileSync('web/index.html', 'utf8');
const required = [
  'id="coding-agents"',
  'npm install supercompress-proxy',
  'npm exec supercompress setup',
  'assets/css/sc-sm.css',
  'assets/js/compress-engine.js',
];
for (const value of required) {
  if (!html.includes(value)) throw new Error(`landing page missing: ${value}`);
}
for (const value of ['@supercompress/proxy', 'datafruit.css', 'datafruit.js']) {
  if (html.includes(value)) throw new Error(`stale public reference: ${value}`);
}
console.log('landing page release checks passed');
NODE

(cd packages/proxy && npm test)
git diff --check
echo "release checks passed"
