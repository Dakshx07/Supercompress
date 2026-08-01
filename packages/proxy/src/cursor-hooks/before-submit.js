#!/usr/bin/env node
/**
 * Cursor beforeSubmitPrompt — compress ATTACHED / pasted CONTEXT only.
 *
 * The user ask (prompt) is NEVER compressed — it is the query.
 * Only bulky attachments / file refs are compressed into the inbox.
 */
const path = require("path");
const { compressContext, writeInbox } = require("./compress-prompt-lib");

const MIN_CONTEXT_CHARS = Number(process.env.SUPERCOMPRESS_HOOK_MIN_CHARS || 800);

process.stdin.setEncoding("utf8");
let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", async () => {
  try {
    const input = JSON.parse(raw || "{}");
    const prompt = String(input.prompt || "").trim();
    const attachments = Array.isArray(input.attachments) ? input.attachments : [];
    let context = "";
    for (const a of attachments.slice(0, 12)) {
      const fp = a.file_path || a.path;
      if (!fp) continue;
      try {
        const fs = require("fs");
        if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
          const txt = fs.readFileSync(fp, "utf8");
          context += `\n\n[attachment ${path.basename(fp)}]\n${txt.slice(0, 40000)}`;
        }
      } catch {}
    }
    context = context.trim();

    // No bulky context → do nothing (do not compress the user ask)
    if (context.length < MIN_CONTEXT_CHARS) {
      process.stdout.write(JSON.stringify({ continue: true }));
      return;
    }

    const query = prompt || "Compress attached context for the current coding task.";
    const result = await compressContext(context, query, "Cursor");
    const meta = result.skipped
      ? `skipped=${result.skipped}`
      : `${result.original_tokens}→${result.compressed_tokens} (−${result.savings_pct}%)`;
    writeInbox(query, result.compressed, meta, { kind: "attachment-context" });
  } catch {}
  process.stdout.write(JSON.stringify({ continue: true }));
});
