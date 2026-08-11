#!/usr/bin/env node

/**
 * postinstall — guidance + optional MCP path refresh.
 *
 * Never prompts for reconnect and never clears ~/.supercompress/config.json.
 * If an account is already linked, rewrite agent MCP launch commands so npm /
 * brew Node upgrades do not strand agents on a deleted Cellar path.
 *
 * Skip mutation in CI / non-interactive package installs without a home link.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const pkg = require("../package.json");

console.log(`SuperCompress v${pkg.version} installed.`);

function refreshMcpIfLinked() {
  if (process.env.CI || process.env.SUPERCOMPRESS_SKIP_POSTINSTALL_REFRESH === "1") {
    return false;
  }
  const configDir =
    process.env.SUPERCOMPRESS_CONFIG_DIR || path.join(os.homedir(), ".supercompress");
  const configPath = path.join(configDir, "config.json");
  if (!fs.existsSync(configPath)) return false;
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return false;
  }
  const key = String(cfg?.api_key || "").trim();
  if (!key.startsWith("sc_")) return false;

  try {
    const detector = require("../src/detector");
    const configured = detector.configureMcp();
    if (Array.isArray(configured) && configured.length) {
      console.log(
        `Refreshed MCP launch paths for: ${configured.join(", ")} (account link kept).`
      );
    } else {
      console.log("Account link kept — no MCP agent configs needed a path refresh.");
    }
    return true;
  } catch (err) {
    console.log(
      `Could not refresh MCP paths (${err.message || err}). Account link is unchanged — run \`supercompress plugin\`.`
    );
    return false;
  }
}

const refreshed = refreshMcpIfLinked();
if (!refreshed) {
  console.log("Next: run `supercompress setup` — links your account and auto-adds MCP + hooks");
  console.log("     for every detected coding agent (npm install alone does not link).");
}
console.log("Or:   `supercompress plugin` to re-detect and refresh integrations anytime (keeps auth).");
console.log("Docs: https://docs.supercompress.dev/coding-agents");
