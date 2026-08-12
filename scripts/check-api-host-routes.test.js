#!/usr/bin/env node
/**
 * Run: node scripts/check-api-host-routes.test.js
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  checkApiHostRoutes,
  sourceMatchesPath,
  isCatchAllOrRegex,
} = require("./check-api-host-routes");

const OUTAGE_CATCHALL =
  "/((?!api(?:/|$)|v1(?:/|$)|retrieve(?:/|$)|health(?:/|$)|favicon\\.ico$).*)";

assert.equal(isCatchAllOrRegex("/"), false);
assert.equal(isCatchAllOrRegex("/dashboard"), false);
assert.equal(isCatchAllOrRegex("/dashboard/:path*"), false);
assert.equal(isCatchAllOrRegex("/:path*"), true);
assert.equal(isCatchAllOrRegex(OUTAGE_CATCHALL), true);

assert.equal(sourceMatchesPath("/compress", "/compress"), true);
assert.equal(sourceMatchesPath("/dashboard", "/compress"), false);
assert.equal(sourceMatchesPath("/dashboard/:path*", "/compress"), false);
assert.equal(sourceMatchesPath("/:path*", "/compress"), true);
assert.equal(sourceMatchesPath(OUTAGE_CATCHALL, "/compress"), true);
assert.equal(sourceMatchesPath(OUTAGE_CATCHALL, "/api/v1/compress"), false);

const production = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8")
);
const live = checkApiHostRoutes(production);
assert.equal(live.ok, true, live.errors.join("\n"));

const withOutage = {
  ...production,
  redirects: [
    {
      source: OUTAGE_CATCHALL,
      has: [{ type: "host", value: "api.supercompress.dev" }],
      destination: "https://www.supercompress.dev/$1",
      permanent: true,
    },
    ...(production.redirects || []),
  ],
};
const bad = checkApiHostRoutes(withOutage);
assert.equal(bad.ok, false);
assert.ok(bad.errors.some((e) => /catch-all|compress/i.test(e)));

const compressRedirect = {
  redirects: [
    {
      source: "/compress",
      has: [{ type: "host", value: "api.supercompress.dev" }],
      destination: "https://www.supercompress.dev/compress",
      permanent: true,
    },
  ],
  rewrites: [{ source: "/compress", destination: "/api/v1/compress" }],
};
const bad2 = checkApiHostRoutes(compressRedirect);
assert.equal(bad2.ok, false);
assert.ok(bad2.errors.some((e) => e.includes("/compress")));

console.log("check-api-host-routes.test.js: ok");
