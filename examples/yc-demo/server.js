#!/usr/bin/env node
/**
 * Local SuperCompress demo UI — real hosted API only.
 *
 *   node examples/yc-demo/server.js
 *   open http://127.0.0.1:3847
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3855);
const API_URL = "https://www.supercompress.dev/api/v1/compress";
const PUBLIC = path.join(ROOT, "public");

function mime(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".log") || filePath.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function proxyCompress(req, res) {
  const raw = await readBody(req);
  let body;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "invalid JSON body" }));
    return;
  }

  const apiKey = String(body.api_key || "").trim();
  if (!apiKey.startsWith("sc_")) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "Missing API key. Paste a sc_live_… key." }));
    return;
  }

  const context = String(body.context || "");
  const query = String(body.query || "").trim();
  if (!context.trim()) {
    res.writeHead(422, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "context required" }));
    return;
  }
  if (!query) {
    res.writeHead(422, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "query required" }));
    return;
  }
  if (context.length > 120_000) {
    res.writeHead(422, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "context too long (120k max)" }));
    return;
  }

  const payload = JSON.stringify({
    context,
    query,
    mode: body.mode || "compiler",
    coding_agent: body.coding_agent || "yc-demo-local-ui",
  });

  const t0 = Date.now();
  const upstream = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: payload,
  });
  const text = await upstream.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: `Upstream non-JSON (${upstream.status})`, raw: text.slice(0, 400) }));
    return;
  }

  if (!upstream.ok) {
    res.writeHead(upstream.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
    return;
  }

  const compressed = String(data.compressed_text || "");
  const original = data.original_tokens ?? 0;
  const kept = data.kept_tokens ?? 0;
  const saved = data.tokens_saved ?? Math.max(0, original - kept);
  const tokensSavedPct =
    data.tokens_saved_pct ??
    data.kv_savings_pct ??
    (original ? (saved / original) * 100 : 0);
  const inLines = context.split("\n").length;
  const outLines = compressed ? compressed.split("\n").length : 0;

  // Surface query-hit lines for the demo UI
  const stop = new Set([
    "a", "an", "the", "and", "or", "for", "to", "of", "in", "on", "at", "by",
    "is", "was", "were", "be", "been", "did", "does", "do", "what", "why",
    "how", "when", "where", "which", "who", "with", "from", "into", "return",
    "returned", "taken", "this", "that", "user",
  ]);
  const terms = [...new Set((query.match(/[A-Za-z0-9_./:-]+/g) || [])
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !stop.has(t.toLowerCase())))].slice(0, 16);
  const evidence_lines = compressed
    .split("\n")
    .filter((line) => {
      const l = line.toLowerCase();
      return terms.some((t) => l.includes(t.toLowerCase()));
    })
    .slice(0, 24);

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      ...data,
      latency_ms: Date.now() - t0,
      context_chars: context.length,
      context_lines: inLines,
      compressed_chars: compressed.length,
      compressed_lines: outLines,
      char_savings_pct:
        context.length > 0
          ? Math.round((1 - compressed.length / context.length) * 10000) / 100
          : 0,
      line_savings_pct:
        inLines > 0 ? Math.round((1 - outLines / inLines) * 10000) / 100 : 0,
      token_savings_pct:
        original > 0 ? Math.round((1 - kept / original) * 10000) / 100 : 0,
      tokens_saved: saved,
      tokens_saved_pct: tokensSavedPct,
      query_terms: terms,
      evidence_lines,
      endpoint: API_URL,
    }),
  );
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

  if (req.method === "POST" && url.pathname === "/compress") {
    try {
      await proxyCompress(req, res);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: err.message || String(err) }));
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/bootstrap") {
    let context = "";
    let query = "";
    try {
      context = fs.readFileSync(path.join(ROOT, "auth-service.log"), "utf8");
    } catch {
      /* optional */
    }
    try {
      query = fs.readFileSync(path.join(ROOT, "query.txt"), "utf8").trim();
    } catch {
      /* optional */
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        query,
        context,
        endpoint: API_URL,
        context_chars: context.length,
        context_lines: context ? context.split("\n").length : 0,
      }),
    );
    return;
  }

  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const abs = path.join(PUBLIC, filePath);
  if (!abs.startsWith(PUBLIC) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": mime(abs) });
  res.end(fs.readFileSync(abs));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("");
  console.log(`SuperCompress local demo → http://127.0.0.1:${PORT}`);
  console.log(`Live API               → ${API_URL}`);
  console.log(`API key                → paste in the UI`);
  console.log("");
});
