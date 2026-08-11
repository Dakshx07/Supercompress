/**
 * OpenClaw internal hook — inject SuperCompress inbox into bootstrap files.
 * Fail-open. ESM (OpenClaw hook loader).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const INBOX = path.join(os.homedir(), ".supercompress", "inbox", "latest.md");
const BOOTSTRAP_NAME = "SUPERCOMPRESS.md";

function normalizeEntry(entry) {
  if (!entry) return null;
  if (typeof entry === "string") return { name: path.basename(entry), path: entry };
  if (typeof entry === "object") return entry;
  return null;
}

const handler = async (event) => {
  try {
    if (event?.type !== "agent" || event?.action !== "bootstrap") return;
    if (!fs.existsSync(INBOX)) return;
    const files = event.context?.bootstrapFiles;
    if (!Array.isArray(files)) return;

    const already = files.some((raw) => {
      const e = normalizeEntry(raw);
      if (!e) return false;
      const name = String(e.name || e.path || "");
      return name === BOOTSTRAP_NAME || /supercompress/i.test(name);
    });
    if (already) return;

    let content = "";
    try {
      content = fs.readFileSync(INBOX, "utf8");
    } catch {
      return;
    }
    if (!content.trim()) return;

    files.push({
      name: BOOTSTRAP_NAME,
      path: INBOX,
      content,
    });
  } catch (err) {
    console.warn(
      `[supercompress-bootstrap] ${err instanceof Error ? err.message : String(err)}`
    );
  }
};

export default handler;
