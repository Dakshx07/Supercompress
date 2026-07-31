#!/usr/bin/env node

/**
 * postinstall — guidance only.
 * Do NOT mutate agent MCP configs here (npm install can run in CI / as a
 * transitive dep). Users opt in via `supercompress setup` or `supercompress plugin`.
 */

const pkg = require("../package.json");

console.log(`SuperCompress v${pkg.version} installed.`);
console.log("Next: run `supercompress setup` to connect your account and install the MCP plugin.");
console.log("Or:   `supercompress plugin` to detect agents and refresh MCP registrations only.");
console.log("Docs: https://supercompress.dev/docs/coding-agents");
