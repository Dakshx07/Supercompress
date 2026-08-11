/**
 * SuperCompress OpenClaw plugin — Headroom-parity auto-compress.
 *
 * - after_tool_call: compress large tool results into session inbox (async)
 * - before_prompt_build: prepend inbox digest so the model prefers digests
 *
 * Uses a local definePluginEntry stub (same pattern as community plugins) so
 * we do not need openclaw as a hard dependency at install time.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const MIN_CHARS = Number(process.env.SUPERCOMPRESS_HOOK_MIN_CHARS || 400);
const MAX_IN = Number(process.env.SUPERCOMPRESS_HOOK_MAX_CHARS || 180000);
const INBOX_MD = path.join(os.homedir(), ".supercompress", "inbox", "latest.md");

function definePluginEntry(options) {
  return options;
}

function loadLib() {
  try {
    return require(path.join(__dirname, "compress-prompt-lib.js"));
  } catch {
    try {
      return require(path.join(__dirname, "..", "..", "cursor-hooks", "compress-prompt-lib.js"));
    } catch {
      return null;
    }
  }
}

function extractText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          if (typeof part.text === "string") return part.text;
          if (typeof part.content === "string") return part.content;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
    if (value.content != null) return extractText(value.content);
    if (value.result != null) return extractText(value.result);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function resolveSessionId(event = {}, ctx = {}) {
  const raw =
    event.sessionId ||
    ctx.sessionId ||
    event.sessionKey ||
    ctx.sessionKey ||
    process.env.SUPERCOMPRESS_SESSION_ID ||
    "openclaw";
  return String(raw).replace(/[^\w.-]+/g, "_").slice(0, 80);
}

function readInboxDigest() {
  try {
    if (!fs.existsSync(INBOX_MD)) return "";
    const body = fs.readFileSync(INBOX_MD, "utf8").trim();
    return body.length > 40 ? body : "";
  } catch {
    return "";
  }
}

export default definePluginEntry({
  id: "supercompress",
  name: "SuperCompress",
  description:
    "Compress bulky OpenClaw tool dumps into session digests; never compress the user ask.",
  register(api) {
    const logger = api?.logger || console;
    logger.info?.("[supercompress] plugin activated");

    const safeOn = (event, handler, opts) => {
      try {
        api.on(
          event,
          async (...args) => {
            try {
              return await handler(...args);
            } catch (err) {
              logger.warn?.(
                `[supercompress] ${event} error: ${err instanceof Error ? err.message : String(err)}`
              );
            }
          },
          opts
        );
      } catch (err) {
        logger.warn?.(
          `[supercompress] failed to register ${event}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    };

    safeOn(
      "after_tool_call",
      async (event, ctx) => {
        const toolName = String(event?.toolName || ctx?.toolName || "");
        if (/compress_context|connect_account|usage_summary|headroom_/i.test(toolName)) {
          return;
        }
        if (event?.error) return;

        let text = extractText(event?.result);
        if (text.length < MIN_CHARS) return;
        const clipped = text.length > MAX_IN ? text.slice(0, MAX_IN) : text;

        const lib = loadLib();
        if (!lib?.compressIncremental || !lib?.writeInbox) return;

        const sessionId = resolveSessionId(event, ctx);
        const query =
          `Compress new ${toolName || "tool"} output for the current OpenClaw task. ` +
          "Preserve code, paths, errors, numbers, and decisions.";

        const result = await lib.compressIncremental({
          context: clipped,
          query,
          codingAgent: "OpenClaw",
          sessionId,
          kind: `openclaw:tool:${toolName || "unknown"}`,
        });

        if (!result?.compressed) return;
        if (result.skipped === "no_key" || String(result.skipped || "").startsWith("http_")) {
          return;
        }
        if (result.skipped === "already_seen" && !result.delta) return;

        const meta = `${result.original_tokens}→${result.compressed_tokens} (−${result.savings_pct}%)`;
        lib.writeInbox(query, result.compressed, meta, {
          kind: "openclaw-post-tool",
          session_id: sessionId,
          tool: toolName,
          compacted: Boolean(result.compacted),
        });
      },
      { priority: 40, timeoutMs: 25000 }
    );

    safeOn(
      "before_prompt_build",
      async () => {
        const digest = readInboxDigest();
        if (!digest) return;
        return {
          prependContext: [
            "[SuperCompress] Prefer this session digest over raw tool dumps:",
            "",
            digest,
          ].join("\n"),
        };
      },
      { priority: 40, timeoutMs: 5000 }
    );
  },
});
