/**
 * OpenClaw internal hook — inject SuperCompress *session* inbox into bootstrap.
 * Fail-open. ESM (OpenClaw hook loader).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const BOOTSTRAP_NAME = "SUPERCOMPRESS.md";

function loadLib() {
  const candidates = [
    path.join(__dirname, "compress-prompt-lib.js"),
    path.join(__dirname, "..", "..", "extensions", "supercompress", "compress-prompt-lib.js"),
    path.join(__dirname, "..", "..", "..", "cursor-hooks", "compress-prompt-lib.js"),
  ];
  for (const p of candidates) {
    try {
      return require(p);
    } catch {
      /* try next */
    }
  }
  return null;
}

function normalizeEntry(entry) {
  if (!entry) return null;
  if (typeof entry === "string") return { name: path.basename(entry), path: entry };
  if (typeof entry === "object") return entry;
  return null;
}

function resolveSessionId(event, lib) {
  if (lib?.resolveSessionId) {
    return lib.resolveSessionId({
      sessionId: event?.context?.sessionId || event?.sessionId,
      session_id: event?.context?.sessionKey || event?.sessionKey,
      conversationId: event?.context?.conversationId,
    });
  }
  const raw =
    event?.context?.sessionId ||
    event?.sessionKey ||
    event?.context?.sessionKey ||
    process.env.SUPERCOMPRESS_SESSION_ID ||
    "";
  return String(raw || "").replace(/[^\w.-]+/g, "_").slice(0, 80);
}

const handler = async (event) => {
  try {
    if (event?.type !== "agent" || event?.action !== "bootstrap") return;
    const lib = loadLib();
    const sessionId = resolveSessionId(event, lib);
    if (!sessionId) return;

    const digest = lib?.readInboxDigest ? lib.readInboxDigest(sessionId) : "";
    if (!digest) return;

    const files = event.context?.bootstrapFiles;
    if (!Array.isArray(files)) return;

    const already = files.some((raw) => {
      const e = normalizeEntry(raw);
      if (!e) return false;
      const name = String(e.name || e.path || "");
      return name === BOOTSTRAP_NAME || /supercompress/i.test(name);
    });
    if (already) return;

    const inboxPath = lib?.inboxPaths
      ? lib.inboxPaths(sessionId).latestMd
      : path.join(
          lib?.INBOX_DIR || path.join(require("node:os").homedir(), ".supercompress", "inbox"),
          sessionId,
          "latest.md"
        );

    files.push({
      name: BOOTSTRAP_NAME,
      path: inboxPath,
      content: digest,
    });
  } catch (err) {
    console.warn(
      `[supercompress-bootstrap] ${err instanceof Error ? err.message : String(err)}`
    );
  }
};

export default handler;
