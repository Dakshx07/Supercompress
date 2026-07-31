#!/usr/bin/env node
/**
 * Build brand-new ood_fresh5 hard cases (never used in fresh4 / seed 4242).
 * Completely different sources from ood_fresh4.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const OUT = process.env.SC_FRESH5_DIR || "/tmp/sc-heldout/ood_fresh5";
const SRC = path.join(OUT, "sources");

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          "User-Agent": "SuperCompressFresh5/1.0",
          Accept: "text/plain,text/markdown,text/html,*/*",
        },
        timeout: 60000,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchUrl(res.headers.location).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          reject(new Error(`${url} → ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout " + url));
    });
  });
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const SOURCES = [
  {
    id: "wiki_crdt",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=Conflict-free_replicated_data_type&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "wiki_wasm",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=WebAssembly&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "wiki_redis",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=Redis&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "wiki_graphql",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=GraphQL&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "wiki_protobuf",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=Protocol_Buffers&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "wiki_deno",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=Deno_(software)&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "rfc8259",
    url: "https://www.rfc-editor.org/rfc/rfc8259.txt",
    kind: "text",
  },
  {
    id: "rfc8949",
    url: "https://www.rfc-editor.org/rfc/rfc8949.txt",
    kind: "text",
  },
  {
    id: "esbuild_readme",
    url: "https://raw.githubusercontent.com/evanw/esbuild/main/README.md",
    kind: "text",
  },
  {
    id: "deno_readme",
    url: "https://raw.githubusercontent.com/denoland/deno/main/README.md",
    kind: "text",
  },
];

/** Rare golds + questions — answers must appear literally in the source text. */
const CASES = [
  {
    id: "crdt_shapiro",
    source: "wiki_crdt",
    input: "Which researcher is widely associated with formalizing conflict-free replicated data types (CRDTs)?",
    answers: ["Marc Shapiro"],
  },
  {
    id: "crdt_eventual",
    source: "wiki_crdt",
    input: "CRDTs are designed to achieve which consistency property without coordination?",
    answers: ["eventual consistency"],
  },
  {
    id: "wasm_w3c",
    source: "wiki_wasm",
    input: "Which standards body maintains the WebAssembly core specification?",
    answers: ["W3C"],
  },
  {
    id: "wasm_asmjs",
    source: "wiki_wasm",
    input: "WebAssembly evolved from which earlier low-level JavaScript subset used as a compilation target?",
    answers: ["asm.js"],
  },
  {
    id: "redis_sanfilippo",
    source: "wiki_redis",
    input: "Who originally created Redis?",
    answers: ["Salvatore Sanfilippo"],
  },
  {
    id: "redis_ansi_c",
    source: "wiki_redis",
    input: "Redis is primarily written in which programming language?",
    answers: ["ANSI C"],
  },
  {
    id: "graphql_facebook",
    source: "wiki_graphql",
    input: "Which company originally developed GraphQL before it became an open standard?",
    answers: ["Facebook"],
  },
  {
    id: "graphql_2015",
    source: "wiki_graphql",
    input: "In which year was GraphQL publicly released as an open-source project?",
    answers: ["2015"],
  },
  {
    id: "protobuf_google",
    source: "wiki_protobuf",
    input: "Which company developed Protocol Buffers?",
    answers: ["Google"],
  },
  {
    id: "protobuf_idl",
    source: "wiki_protobuf",
    input: "Protocol Buffers serialize structured data using what kind of schema language often abbreviated IDL?",
    answers: ["interface description language"],
  },
  {
    id: "deno_ry",
    source: "wiki_deno",
    input: "Who created the Deno JavaScript/TypeScript runtime?",
    answers: ["Ryan Dahl"],
  },
  {
    id: "deno_rust",
    source: "wiki_deno",
    input: "Deno's core is primarily implemented in which systems language?",
    answers: ["Rust"],
  },
  {
    id: "rfc8259_json",
    source: "rfc8259",
    input: "RFC 8259 is the current standard for which data interchange format?",
    answers: ["JSON"],
  },
  {
    id: "rfc8949_cbor",
    source: "rfc8949",
    input: "RFC 8949 specifies which binary data format often used as a compact alternative to JSON?",
    answers: ["CBOR"],
  },
  {
    id: "esbuild_evan",
    source: "esbuild_readme",
    input: "Who is the primary author of esbuild according to its README?",
    answers: ["Evan Wallace"],
  },
  {
    id: "deno_readme_rust",
    source: "deno_readme",
    input: "According to the Deno README, Deno is written in which language?",
    answers: ["Rust"],
  },
];

function haystack(goldText, allTexts, goldId) {
  const others = Object.entries(allTexts)
    .filter(([id]) => id !== goldId)
    .map(([, t]) => t);
  let h = 0;
  for (const c of goldId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const shuffled = others.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    const j = h % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const noise = shuffled.slice(0, 5).join("\n\n==== DISTRACTOR ====\n\n");
  const head = shuffled.slice(5, 7).join("\n\n==== DISTRACTOR ====\n\n");
  return [
    head.slice(0, 25000),
    "\n\n===== SOURCE DOCUMENT =====\n\n",
    goldText.slice(0, 45000),
    "\n\n===== END SOURCE =====\n\n",
    noise.slice(0, 45000),
  ].join("");
}

async function loadWiki(url) {
  const raw = await fetchUrl(url);
  const j = JSON.parse(raw);
  const html = j.parse?.text || "";
  return stripHtml(html);
}

async function main() {
  fs.mkdirSync(SRC, { recursive: true });
  const texts = {};
  for (const s of SOURCES) {
    const dest = path.join(SRC, s.id + ".txt");
    process.stderr.write(`fetch ${s.id}… `);
    try {
      let text;
      if (fs.existsSync(dest) && fs.statSync(dest).size > 500) {
        text = fs.readFileSync(dest, "utf8");
        process.stderr.write("cache\n");
      } else {
        text = s.kind === "wiki" ? await loadWiki(s.url) : await fetchUrl(s.url);
        fs.writeFileSync(dest, text);
        process.stderr.write(`ok ${text.length}\n`);
      }
      texts[s.id] = text;
    } catch (err) {
      process.stderr.write(`FAIL ${err.message}\n`);
    }
  }

  const cases = [];
  for (const c of CASES) {
    const src = texts[c.source];
    if (!src) {
      process.stderr.write(`skip ${c.id}: missing source ${c.source}\n`);
      continue;
    }
    const ok = c.answers.every((a) => src.toLowerCase().includes(String(a).toLowerCase()));
    if (!ok) {
      process.stderr.write(`skip ${c.id}: gold not in source\n`);
      continue;
    }
    const context = haystack(src, texts, c.source);
    cases.push({
      id: c.id,
      input: c.input,
      answers: c.answers,
      context,
      source: c.source,
    });
  }

  const outPath = path.join(OUT, "hard_cases.jsonl");
  fs.writeFileSync(outPath, cases.map((c) => JSON.stringify(c)).join("\n") + "\n");
  fs.writeFileSync(
    path.join(OUT, "manifest.json"),
    JSON.stringify(
      {
        name: "ood_fresh5_hard",
        note: "Brand-new sources (CRDT/Wasm/Redis/GraphQL/Protobuf/Deno/RFC8259/RFC8949/esbuild) buried in distractors. Never used in fresh4 or seed 4242.",
        n: cases.length,
        ids: cases.map((c) => c.id),
        built_at: new Date().toISOString(),
      },
      null,
      2
    )
  );
  console.log(JSON.stringify({ wrote: outPath, n: cases.length, ids: cases.map((c) => c.id) }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
