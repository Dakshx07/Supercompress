#!/usr/bin/env node
/**
 * Cursor sessionStart — inject SuperCompress always-on / every-message instructions.
 */
process.stdin.setEncoding("utf8");
let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  try {
    JSON.parse(raw || "{}");
  } catch {}
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const inbox = `${home}/.supercompress/inbox/latest.md`;
  const additional_context = [
    "SUPERCOMPRESS IS ON FOR EVERY MESSAGE (Headroom-parity).",
    `Each submit with context writes ${inbox} — Read it first and use that digest.`,
    "Otherwise call MCP compress_context on any bulky dump before reasoning.",
    "User ask is never compressed. Prefer digests over raw tool output. Keep Cursor login.",
  ].join(" ");
  process.stdout.write(JSON.stringify({ additional_context }));
});
