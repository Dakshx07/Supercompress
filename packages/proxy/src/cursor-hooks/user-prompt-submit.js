#!/usr/bin/env node
/**
 * Claude Code / Codex UserPromptSubmit — inject compressed prompt context every message.
 */
const { compressPrompt, writeInbox } = require("./compress-prompt-lib");

process.stdin.setEncoding("utf8");
let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", async () => {
  try {
    const input = JSON.parse(raw || "{}");
    const prompt = String(
      input.prompt ||
        input.user_prompt ||
        input.message ||
        input.content ||
        ""
    );
    const agent =
      process.env.SUPERCOMPRESS_AGENT_NAME ||
      (process.env.TOKEN_OPTIMIZER_RUNTIME === "codex" ? "Codex" : "Claude Code");
    const result = await compressPrompt(prompt, agent);
    const meta = result.skipped
      ? `skipped=${result.skipped}`
      : `${result.original_tokens}→${result.compressed_tokens} (−${result.savings_pct}%)`;
    writeInbox(prompt, result.compressed, meta);

    if (!result.compressed || result.skipped === "empty") {
      process.stdout.write("{}");
      return;
    }

    const additionalContext = [
      `[SuperCompress auto · every message] ${meta}`,
      "Prefer this compressed digest of the user prompt/context:",
      "",
      result.compressed,
    ].join("\n");

    // Claude Code + Codex accept hookSpecificOutput.additionalContext
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext,
        },
        additionalContext,
        additional_context: additionalContext,
      })
    );
  } catch {
    process.stdout.write("{}");
  }
});
