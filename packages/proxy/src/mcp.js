#!/usr/bin/env node
/**
 * SuperCompress MCP server (stdio).
 *
 * stdout is reserved for JSON-RPC — never write logs there.
 * Crash / Connection closed usually means the process exited or stdout was corrupted.
 */

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { ListToolsRequestSchema, CallToolRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const VERSION = require("../package.json").version;
const CONFIG_DIR = process.env.SUPERCOMPRESS_CONFIG_DIR || path.join(os.homedir(), ".supercompress");

const API_URL = "https://www.supercompress.dev/api/v1/compress";
const USAGE_URL = "https://www.supercompress.dev/api/usage";
const CONNECT_URL = "https://supercompress.dev/dashboard?source=mcp&connect=";

function log(...args) {
  // stderr only — stdout is the MCP protocol stream
  console.error("[supercompress-mcp]", ...args);
}

// Keep the process alive through tool failures; clients show "Connection closed" if we exit.
process.on("uncaughtException", (err) => {
  log("uncaughtException:", err && err.stack ? err.stack : err);
});
process.on("unhandledRejection", (err) => {
  log("unhandledRejection:", err && err.stack ? err.stack : err);
});
process.stdin.on("error", (err) => {
  if (err && (err.code === "EPIPE" || err.code === "EOF")) return;
  log("stdin error:", err.message || err);
});
process.stdout.on("error", (err) => {
  if (err && err.code === "EPIPE") return;
  log("stdout error:", err.message || err);
});

async function httpJson(url, options = {}) {
  if (typeof fetch !== "function") {
    throw new Error("This MCP server needs Node.js 18+ (global fetch). Upgrade Node, then restart your agent.");
  }
  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs || 120000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

function loadApiKey() {
  let apiKey = "";
  const envKey = (process.env.SUPERCOMPRESS_API_KEY || "").trim();
  // Cursor previously received a literal "${SUPERCOMPRESS_API_KEY}" placeholder.
  if (envKey && !envKey.includes("${") && envKey.startsWith("sc_")) {
    apiKey = envKey;
  }
  if (!apiKey) {
    try {
      const config = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, "config.json"), "utf8"));
      apiKey = String(config.api_key || "").trim();
    } catch {}
  }
  return apiKey;
}

function toolError(message) {
  return { isError: true, content: [{ type: "text", text: message }] };
}

function toolText(message) {
  return { content: [{ type: "text", text: message }] };
}

const server = new Server(
  { name: "supercompress", version: VERSION },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "connect_account",
    description: "Connect this MCP installation to a SuperCompress account. Opens the dashboard so the user can sign in and link this install with a one-time code.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  }, {
    name: "compress_context",
    description: "Compress long coding context before using it in your answer. Preserve code and facts relevant to the query. Call this for large file dumps, search results, logs, tickets, or conversation history. Return the compressed context and savings metadata.",
    inputSchema: {
      type: "object",
      properties: {
        context: { type: "string", description: "The context to compress" },
        query: { type: "string", description: "The coding task or question" },
      },
      required: ["context", "query"],
    },
  }, {
    name: "usage_summary",
    description: "Fetch per-coding-agent token savings tracked for the connected SuperCompress account.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  }],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const name = request.params?.name;
    if (!["compress_context", "connect_account", "usage_summary"].includes(name)) {
      return toolError(`Unknown tool: ${name}`);
    }

    let apiKey = loadApiKey();
    const context = String(request.params.arguments?.context || "");
    const query = String(request.params.arguments?.query || "");

    if (name === "connect_account") {
      const code = require("crypto").randomBytes(4).toString("hex");
      const url = `${CONNECT_URL}${code}`;
      const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      try { execFile(opener, [url]); } catch (err) { log("open browser failed:", err.message || err); }
      const started = Date.now();
      // Cap wait so agents don't treat a long poll as a dead MCP process.
      const maxWaitMs = 90_000;
      while (Date.now() - started < maxWaitMs) {
        try {
          const { response, body } = await httpJson(
            `https://www.supercompress.dev/api/connect-device?code=${encodeURIComponent(code)}`,
            { method: "GET", timeoutMs: 15_000 }
          );
          if (response.ok && body.status === "linked" && body.secret) {
            const configPath = path.join(CONFIG_DIR, "config.json");
            let config = {};
            try { config = JSON.parse(fs.readFileSync(configPath, "utf8")); } catch {}
            fs.mkdirSync(path.dirname(configPath), { recursive: true });
            fs.writeFileSync(
              configPath,
              JSON.stringify({ ...config, api_key: body.secret, connected_at: new Date().toISOString() }, null, 2)
            );
            return toolText("SuperCompress account connected. Future compression usage is metered to this account.");
          }
        } catch (err) {
          log("connect poll failed:", err.message || err);
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      return toolError(
        `Timed out waiting for browser sign-in. Open ${url} , finish linking, then call connect_account again (or run: supercompress connect).`
      );
    }

    if (name === "usage_summary") {
      if (!apiKey) return toolError("SuperCompress account is not connected. Call connect_account first.");
      try {
        const { response, body } = await httpJson(USAGE_URL, {
          method: "GET",
          headers: { "X-API-Key": apiKey },
          timeoutMs: 30_000,
        });
        if (!response.ok) {
          return toolError(body.detail || `Usage summary request failed (${response.status})`);
        }
        return toolText(JSON.stringify({
          owner_uid: body.owner_uid,
          total_requests: body.total_requests,
          total_tokens_in: body.total_tokens_in,
          total_tokens_out: body.total_tokens_out,
          total_tokens_saved: body.total_tokens_saved,
          coding_agent_usage: body.coding_agent_usage,
        }));
      } catch (err) {
        return toolError(`Usage summary failed: ${err.message}`);
      }
    }

    if (!context.trim()) return toolError("context is required");
    if (!apiKey) {
      return toolError(
        "SuperCompress account is not connected. Call connect_account, finish sign-in in the browser, then retry compress_context (or run: supercompress setup)."
      );
    }

    try {
      const { response, body } = await httpJson(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({ context, query, mode: "compiler", coding_agent: "mcp" }),
        timeoutMs: 120_000,
      });
      if (!response.ok) {
        throw new Error(body.detail || body.error?.message || `Compression failed (${response.status})`);
      }
      return toolText(JSON.stringify({
        compressed_context: body.compressed_text || body.compressed_context,
        compressed_text: body.compressed_text || body.compressed_context,
        original_tokens: body.original_tokens,
        compressed_tokens: body.kept_tokens || body.compressed_tokens,
        kept_tokens: body.kept_tokens || body.compressed_tokens,
        tokens_saved: body.tokens_saved ?? Math.max(0, (body.original_tokens || 0) - (body.kept_tokens || body.compressed_tokens || 0)),
        savings_pct: body.savings_pct ?? body.kv_savings_pct,
        kv_savings_pct: body.kv_savings_pct ?? body.savings_pct,
        risk: body.compression_risk || body.risk,
      }));
    } catch (err) {
      const msg = err?.name === "AbortError"
        ? "Compression timed out. Try a smaller context chunk."
        : `SuperCompress error: ${err.message}`;
      return toolError(msg);
    }
  } catch (err) {
    log("tool handler crash:", err && err.stack ? err.stack : err);
    return toolError(`SuperCompress MCP internal error: ${err.message || String(err)}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`ready v${VERSION} node=${process.version}`);
}

main().catch((err) => {
  log(`failed to start: ${err.message}`);
  process.exit(1);
});
