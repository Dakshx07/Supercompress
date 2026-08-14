#!/usr/bin/env node
/**
 * Guard against route-relative stylesheet URLs in static pages.
 *
 * Run: node scripts/check-stylesheet-paths.js
 */
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const WEB = path.join(ROOT, "web");

function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".html") ? [entryPath] : [];
  });
}

function stylesheetHrefs(html) {
  return [...html.matchAll(/<link\b[^>]*>/gi)].flatMap(([tag]) => {
    const rel = tag.match(/\brel\s*=\s*(["'])(.*?)\1/i)?.[2];
    const href = tag.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
    return rel?.split(/\s+/).includes("stylesheet") && href ? [href] : [];
  });
}

const invalidPaths = htmlFiles(WEB).flatMap((file) =>
  stylesheetHrefs(fs.readFileSync(file, "utf8"))
    .filter((href) => !href.startsWith("/") && !/^https?:\/\//i.test(href))
    .map((href) => `${path.relative(ROOT, file)}: ${href}`)
);

if (invalidPaths.length) {
  throw new Error(
    `Stylesheet URLs must be root-relative or external:\n${invalidPaths.join("\n")}`
  );
}

const normalizerCheck = String.raw`
import importlib.util
from pathlib import Path

root = Path.cwd()
spec = importlib.util.spec_from_file_location(
    "normalize_article_pages", root / "scripts" / "normalize_article_pages.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
html = '<head><link rel="stylesheet" href="assets/css/supercompress.css?v=105" /></head>'
result = module.ensure_css_links(html)
assert 'href="/assets/css/supercompress.css?v=105"' in result
assert 'href="assets/css/supercompress.css' not in result
`;
execFileSync("python3", ["-c", normalizerCheck], {
  cwd: ROOT,
  stdio: "inherit",
});

console.log(
  `stylesheet path check: ${htmlFiles(WEB).length} HTML files and article normalizer passed`
);
