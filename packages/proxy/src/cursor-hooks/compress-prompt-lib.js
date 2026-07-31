#!/usr/bin/env node
/**
 * Shared: compress a prompt string via SuperCompress API.
 * Used by Cursor beforeSubmitPrompt + Claude/Codex UserPromptSubmit.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const COMPRESS_URL =
  process.env.SUPERCOMPRESS_COMPRESS_URL ||
  "https://www.supercompress.dev/api/v1/compress";
const INBOX_DIR = path.join(
  process.env.SUPERCOMPRESS_CONFIG_DIR || path.join(os.homedir(), ".supercompress"),
  "inbox"
);

function loadApiKey() {
  const envKey = String(process.env.SUPERCOMPRESS_API_KEY || "").trim();
  if (envKey && !envKey.includes("${") && envKey.startsWith("sc_")) return envKey;
  try {
    const key = String(
      JSON.parse(
        fs.readFileSync(
          path.join(
            process.env.SUPERCOMPRESS_CONFIG_DIR || path.join(os.homedir(), ".supercompress"),
            "config.json"
          ),
          "utf8"
        )
      ).api_key || ""
    ).trim();
    return key.startsWith("sc_") ? key : null;
  } catch {
    return null;
  }
}

function writeInbox(prompt, compressed, meta) {
  fs.mkdirSync(INBOX_DIR, { recursive: true });
  const latestMd = path.join(INBOX_DIR, "latest.md");
  const latestJson = path.join(INBOX_DIR, "latest.json");
  const body = [
    "# SuperCompress prompt digest",
    "",
    `Saved: ${new Date().toISOString()}`,
    meta ? `Stats: ${meta}` : "",
    "",
    "## Compressed",
    "",
    compressed || "(empty)",
    "",
    "## Original prompt (truncated)",
    "",
    String(prompt || "").slice(0, 4000),
    "",
  ].join("\n");
  fs.writeFileSync(latestMd, body);
  fs.writeFileSync(
    latestJson,
    JSON.stringify(
      {
        saved_at: new Date().toISOString(),
        compressed,
        prompt_preview: String(prompt || "").slice(0, 2000),
        meta,
      },
      null,
      2
    )
  );
  return latestMd;
}

async function compressPrompt(prompt, codingAgent) {
  const text = String(prompt || "").trim();
  if (!text) return { compressed: "", skipped: "empty" };
  // Every message: only skip empty. Tiny prompts still write through + meter when useful.
  if (text.length < 40) {
    return { compressed: text, skipped: "too_small", original_tokens: Math.ceil(text.length / 4) };
  }
  const apiKey = loadApiKey();
  if (!apiKey) return { compressed: text, skipped: "no_key" };

  const clipped = text.length > 160000 ? text.slice(0, 160000) : text;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14000);
  try {
    const res = await fetch(COMPRESS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({
        context: clipped,
        query: "Compress this user prompt / attached context for the coding agent. Keep the ask, constraints, paths, and facts.",
        mode: "compiler",
        coding_agent: codingAgent || "Cursor",
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { compressed: text, skipped: `http_${res.status}` };
    const body = await res.json();
    const compressed =
      body.compressed_text ||
      body.compressed_context ||
      body.compressed ||
      text;
    const inTok = body.original_tokens || Math.round(clipped.length / 4);
    const outTok = body.kept_tokens || body.compressed_tokens || Math.round(compressed.length / 4);
    const pct =
      body.kv_savings_pct != null
        ? Math.round(body.kv_savings_pct)
        : inTok > 0
          ? Math.round(((inTok - outTok) / inTok) * 100)
          : 0;
    return {
      compressed,
      original_tokens: inTok,
      compressed_tokens: outTok,
      savings_pct: pct,
    };
  } catch (err) {
    return { compressed: text, skipped: err.message || "error" };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { compressPrompt, writeInbox, loadApiKey, INBOX_DIR };

if (require.main === module) {
  // CLI: node compress-prompt-lib.js "prompt text"
  const prompt = process.argv.slice(2).join(" ") || "";
  compressPrompt(prompt, "cli").then((r) => {
    const meta = r.skipped
      ? `skipped=${r.skipped}`
      : `${r.original_tokens}→${r.compressed_tokens} (−${r.savings_pct}%)`;
    const p = writeInbox(prompt, r.compressed, meta);
    process.stdout.write(JSON.stringify({ ...r, inbox: p }) + "\n");
  });
}
