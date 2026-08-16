#!/usr/bin/env node

/**
 * postinstall — guidance only.
 *
 * Never mutates agent configs, MCP entries, or ~/.supercompress/config.json.
 * Path refresh / MCP wiring is explicit: `supercompress setup` or `supercompress plugin`.
 */

const pkg = require("../package.json");

console.log(`SuperCompress v${pkg.version} installed.`);
console.log("Next: run `supercompress setup` — links your account and adds MCP + hooks");
console.log("     for detected coding agents (npm install alone does not edit configs).");
console.log("Or:   `supercompress plugin` to re-detect and refresh integrations (keeps auth).");
console.log("Docs: https://docs.supercompress.dev/coding-agents");
