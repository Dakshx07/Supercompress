#!/usr/bin/env node
/**
 * YC local demo — real SuperCompress API call on a large log + query.
 *
 * Usage:
 *   export SUPERCOMPRESS_API_KEY=sc_live_…   # or use ~/.supercompress/config.json
 *   node examples/yc-demo/run.js
 *
 * Shows: before/after tokens, token savings %, latency, and compressed preview
 * with the answer-critical lines highlighted.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

const ROOT = __dirname;
const API_HOST = "www.supercompress.dev";
const API_PATH = "/api/v1/compress";

const LOG = path.join(ROOT, "auth-service.log");
const QUERY_FILE = path.join(ROOT, "query.txt");
const OUT_DIR = path.join(ROOT, "out");

function loadApiKey() {
  const env = String(process.env.SUPERCOMPRESS_API_KEY || "").trim();
  if (env && env.startsWith("sc_")) return env;
  const configPath = path.join(
    process.env.SUPERCOMPRESS_CONFIG_DIR || path.join(os.homedir(), ".supercompress"),
    "config.json",
  );
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const key = String(cfg.api_key || "").trim();
    if (key.startsWith("sc_")) return key;
  } catch {
    /* ignore */
  }
  return null;
}

function postJson(body, apiKey) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: API_HOST,
        path: API_PATH,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "X-API-Key": apiKey,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json;
          try {
            json = JSON.parse(raw);
          } catch {
            return reject(new Error(`Non-JSON response (${res.statusCode}): ${raw.slice(0, 400)}`));
          }
          if (res.statusCode >= 400) {
            return reject(new Error(json.detail || JSON.stringify(json)));
          }
          resolve(json);
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function bar(pct, width = 36) {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function highlightEvidence(text) {
  const keys = [
    "refresh_token_reuse",
    "AUTH_REFRESH_REUSE",
    "usr_9f2a",
    "fam_44c1",
    "revoked token_family",
    "stolen refresh token",
  ];
  return text
    .split("\n")
    .filter((line) => keys.some((k) => line.includes(k)))
    .slice(0, 12);
}

async function main() {
  const apiKey = loadApiKey();
  if (!apiKey) {
    console.error("Missing API key.");
    console.error("  export SUPERCOMPRESS_API_KEY=sc_live_…");
    console.error("  or run: supercompress setup");
    process.exit(1);
  }

  const context = fs.readFileSync(LOG, "utf8");
  const query = fs.readFileSync(QUERY_FILE, "utf8").trim();

  console.log("");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  SuperCompress — live API demo (YC)                      ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("");
  console.log("Context file :", path.relative(process.cwd(), LOG));
  console.log("Context size :", context.length.toLocaleString(), "chars ·", context.split("\n").length, "lines");
  console.log("Query        :", query);
  console.log("Endpoint     :", `https://${API_HOST}${API_PATH}`);
  console.log("");
  console.log("Calling compress…");

  const t0 = Date.now();
  const result = await postJson(
    {
      context,
      query,
      mode: "compiler",
      coding_agent: "yc-demo-local",
    },
    apiKey,
  );
  const ms = Date.now() - t0;

  const original = result.original_tokens ?? 0;
  const kept = result.kept_tokens ?? 0;
  const saved = result.tokens_saved ?? Math.max(0, original - kept);
  const tokensSavedPct =
    result.tokens_saved_pct ??
    result.kv_savings_pct ??
    (original ? (saved / original) * 100 : 0);
  const compressed = String(result.compressed_text || "");
  const evidence = highlightEvidence(compressed);
  const inLines = context.split("\n").length;
  const outChars = compressed.length;
  const outLines = compressed ? compressed.split("\n").length : 0;
  const charPct = context.length ? (1 - outChars / context.length) * 100 : 0;
  const linePct = inLines > 0 ? (1 - outLines / inLines) * 100 : 0;

  console.log("");
  console.log("── BEFORE → AFTER (size) ──────────────────────────────────");
  console.log(
    `  Chars   ${context.length.toLocaleString()}  →  ${outChars.toLocaleString()}   (−${charPct.toFixed(1)}%)`,
  );
  console.log(
    `  Lines   ${inLines.toLocaleString()}  →  ${outLines.toLocaleString()}   (−${linePct.toFixed(1)}%)`,
  );
  console.log(`  Latency ${ms} ms`);
  console.log(`  Policy  ${result.policy_name || result.mode || "compiler"}`);
  console.log("");
  console.log(`  Kept   [${bar(100 - charPct)}] ${outChars.toLocaleString()} chars`);
  console.log(`  Saved  [${bar(charPct)}] ${(context.length - outChars).toLocaleString()} chars`);
  console.log("");
  console.log("── API token stats ─────────────────────────────────────────");
  console.log(`  Tokens in     ${original.toLocaleString()}`);
  console.log(`  Tokens out    ${kept.toLocaleString()}`);
  console.log(`  Tokens saved  ${saved.toLocaleString()}`);
  console.log(`  Token savings ${Number(tokensSavedPct).toFixed(1)}%`);
  if (result.answer_quality != null) {
    console.log(`  Answer quality ${(Number(result.answer_quality) * 100).toFixed(0)}%`);
  }
  console.log("");

  console.log("── EVIDENCE KEPT (answer-critical lines) ──────────────────");
  if (evidence.length === 0) {
    console.log("  (no keyword hits — check full compressed output)");
  } else {
    for (const line of evidence) {
      console.log("  ✓", line.slice(0, 110));
    }
  }
  console.log("");

  console.log("── COMPRESSED PREVIEW (first 900 chars) ───────────────────");
  console.log(compressed.slice(0, 900));
  if (compressed.length > 900) console.log("…");
  console.log("");

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outCompressed = path.join(OUT_DIR, "compressed.txt");
  const outStats = path.join(OUT_DIR, "stats.json");
  fs.writeFileSync(outCompressed, compressed);
  fs.writeFileSync(
    outStats,
    JSON.stringify(
      {
        query,
        context_chars: context.length,
        context_lines: inLines,
        compressed_chars: outChars,
        compressed_lines: outLines,
        char_savings_pct: Math.round(charPct * 100) / 100,
        line_savings_pct: Math.round(linePct * 100) / 100,
        latency_ms: ms,
        original_tokens: original,
        kept_tokens: kept,
        tokens_saved: saved,
        tokens_saved_pct: tokensSavedPct,
        policy_name: result.policy_name,
        mode: result.mode,
        answer_quality: result.answer_quality,
        important_kept_pct: result.important_kept_pct,
        endpoint: `https://${API_HOST}${API_PATH}`,
      },
      null,
      2,
    ),
  );

  console.log("Wrote:");
  console.log(" ", path.relative(process.cwd(), outCompressed));
  console.log(" ", path.relative(process.cwd(), outStats));
  console.log("");
}

main().catch((err) => {
  console.error("\nDemo failed:", err.message || err);
  process.exit(1);
});
