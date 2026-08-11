/**
 * OpenClaw internal hook — session compact:before.
 * Nudges the chat + fire-and-forget session memory compact.
 * Fail-open. ESM.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function loadLib() {
  const candidates = [
    path.join(__dirname, "compress-prompt-lib.js"),
    path.join(__dirname, "..", "..", "extensions", "supercompress", "compress-prompt-lib.js"),
    // Dev / package-relative fallback when hooks live next to cursor-hooks
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

const handler = async (event) => {
  try {
    if (event?.type !== "session" || event?.action !== "compact:before") return;

    if (Array.isArray(event.messages)) {
      event.messages.push(
        "🗜️ SuperCompress: prefer ~/.supercompress/inbox/latest.md digests over raw dumps while context is compacted."
      );
    }

    const lib = loadLib();
    if (!lib?.compressIncremental) return;

    const sessionId = String(
      event.context?.sessionId ||
        event.sessionKey ||
        event.context?.sessionKey ||
        "openclaw"
    ).replace(/[^\w.-]+/g, "_").slice(0, 80);

    // Fire-and-forget — do not block compaction.
    void lib
      .compressIncremental({
        context: "",
        query: "Compact OpenClaw session memory before native compaction.",
        codingAgent: "OpenClaw",
        sessionId,
        kind: "openclaw:compact",
      })
      .catch(() => {});
  } catch (err) {
    console.warn(
      `[supercompress-compact] ${err instanceof Error ? err.message : String(err)}`
    );
  }
};

export default handler;
