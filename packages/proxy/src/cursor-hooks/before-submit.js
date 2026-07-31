#!/usr/bin/env node
/**
 * Cursor beforeSubmitPrompt — compress every user message into the inbox.
 * Cursor cannot inject into the prompt, so we write ~/.supercompress/inbox/latest.md
 * and the always-on rule forces the agent to Read it first.
 */
const path = require("path");
const { compressPrompt, writeInbox } = require("./compress-prompt-lib");

process.stdin.setEncoding("utf8");
let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", async () => {
  try {
    const input = JSON.parse(raw || "{}");
    const prompt = String(input.prompt || "");
    const attachments = Array.isArray(input.attachments) ? input.attachments : [];
    let extra = "";
    for (const a of attachments.slice(0, 8)) {
      const fp = a.file_path || a.path;
      if (!fp) continue;
      try {
        const fs = require("fs");
        if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
          const txt = fs.readFileSync(fp, "utf8");
          extra += `\n\n[attachment ${path.basename(fp)}]\n${txt.slice(0, 40000)}`;
        }
      } catch {}
    }
    const combined = prompt + extra;
    const result = await compressPrompt(combined, "Cursor");
    const meta = result.skipped
      ? `skipped=${result.skipped}`
      : `${result.original_tokens}→${result.compressed_tokens} (−${result.savings_pct}%)`;
    writeInbox(combined, result.compressed, meta);
  } catch {}
  // beforeSubmitPrompt only supports continue / user_message
  process.stdout.write(JSON.stringify({ continue: true }));
});
