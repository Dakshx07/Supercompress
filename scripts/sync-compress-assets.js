#!/usr/bin/env node
/**
 * Sync canonical compress assets from web/ into package + API copies.
 * Source of truth: web/assets/js/compress-engine.js + web/assets/data/model.json
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pairs = [
  ["web/assets/js/compress-engine.js", "packages/proxy/src/assets/compress-engine.js"],
  ["web/assets/data/model.json", "packages/proxy/src/assets/model.json"],
  ["web/assets/js/compress-engine.js", "api/_lib/compress-engine.js"],
  ["web/assets/data/model.json", "api/_lib/model.json"],
];

for (const [fromRel, toRel] of pairs) {
  const from = path.join(root, fromRel);
  const to = path.join(root, toRel);
  if (!fs.existsSync(from)) {
    console.error("missing source", fromRel);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log("synced", fromRel, "→", toRel);
}
