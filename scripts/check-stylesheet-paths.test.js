#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { stylesheetHrefs } = require("./check-stylesheet-paths");

assert.deepEqual(
  stylesheetHrefs('<link rel="stylesheet preload" href="/assets/css/site.css">'),
  ["/assets/css/site.css"]
);
assert.deepEqual(
  stylesheetHrefs("<link rel=StyleSheet href=assets/css/site.css>"),
  ["assets/css/site.css"]
);
assert.deepEqual(
  stylesheetHrefs("<link rel='preload StyleSheet' href='/assets/css/site.css'>"),
  ["/assets/css/site.css"]
);

console.log("check-stylesheet-paths.test.js: ok");
