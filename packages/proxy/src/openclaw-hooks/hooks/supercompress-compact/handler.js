/**
 * OpenClaw internal hook — session compact:before.
 * Runs a real session-memory compact (not empty-context compressIncremental).
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

    const lib = loadLib();
    const sessionId = lib?.resolveSessionId
      ? lib.resolveSessionId({
          sessionId: event.context?.sessionId || event.sessionId,
          session_id: event.sessionKey || event.context?.sessionKey,
        })
      : String(
          event.context?.sessionId ||
            event.sessionKey ||
            event.context?.sessionKey ||
            "openclaw"
        )
          .replace(/[^\w.-]+/g, "_")
          .slice(0, 80);

    if (Array.isArray(event.messages)) {
      event.messages.push(
        `🗜️ SuperCompress: prefer session inbox digests (inbox/${sessionId}/latest.md) over raw dumps while context is compacted.`
      );
    }

    if (!lib?.compactSessionMemory) return;

    // Fire-and-forget — do not block compaction.
    void lib
      .compactSessionMemory(sessionId, "Compact OpenClaw session memory before native compaction.", {
        codingAgent: "OpenClaw",
        kind: "openclaw:compact",
        persistInbox: true,
      })
      .catch(() => {});
  } catch (err) {
    console.warn(
      `[supercompress-compact] ${err instanceof Error ? err.message : String(err)}`
    );
  }
};

export default handler;
