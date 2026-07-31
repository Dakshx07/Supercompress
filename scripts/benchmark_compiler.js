#!/usr/bin/env node
/** Compiler-mode compression benchmarks for long-context presets (stdout JSON). */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const WEB = path.join(ROOT, "web", "assets");

const sandbox = { globalThis: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(WEB, "js", "compress-engine.js"), "utf8"), sandbox);
const E = sandbox.globalThis.SuperCompressEngine;
const model = JSON.parse(fs.readFileSync(path.join(WEB, "data", "model.json"), "utf8"));

const ps = { globalThis: {} };
vm.createContext(ps);
vm.runInContext(
  fs.readFileSync(path.join(WEB, "js", "impact-presets.js"), "utf8").replace(/\bglobal\b/g, "globalThis"),
  ps
);

const presets = ps.globalThis.ImpactPresets;
const results = {};
let totalIn = 0;
let totalOut = 0;

for (const [key, p] of Object.entries(presets)) {
  const r = E.compressAdaptive(p.context, p.query, model);
  results[key] = {
    label: p.label,
    query: p.query,
    original_tokens: r.original_tokens,
    kept_tokens: r.kept_tokens,
    tokens_removed: r.tokens_removed ?? r.original_tokens - r.kept_tokens,
    kv_savings_pct: Math.round(r.kv_savings_pct * 10) / 10,
    important_kept_pct: r.important_kept_pct,
    compression_risk: r.compression_risk,
    answer_quality: r.answer_quality,
    kept_line_ratio: Math.round(r.kept_line_ratio * 1000) / 1000,
  };
  totalIn += r.original_tokens;
  totalOut += r.kept_tokens;
}

const summary = {
  avg_kv_savings_pct: Math.round((1 - totalOut / Math.max(totalIn, 1)) * 1000) / 10,
  avg_tokens_removed: Math.round((totalIn - totalOut) / Object.keys(presets).length),
  presets: Object.keys(presets).length,
};

process.stdout.write(JSON.stringify({ compiler: { summary, presets: results } }, null, 2));
