#!/usr/bin/env node
/**
 * Build brand-new ood_fresh4 hard cases (never used in tuning / seed 4242 real bench).
 * Sources are fetched fresh; golds are rare strings buried in distractor haystacks.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const OUT = process.env.SC_FRESH4_DIR || "/tmp/sc-heldout/ood_fresh4";
const SRC = path.join(OUT, "sources");

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          "User-Agent": "SuperCompressFresh4/1.0",
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
    id: "wiki_etcd",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=Etcd&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "wiki_spanner",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=Spanner_(database)&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "wiki_bloom",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=Bloom_filter&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "wiki_chord",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=Chord_(peer-to-peer)&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "wiki_jwt",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=JSON_Web_Token&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "wiki_bun",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=Bun_(software)&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "rfc7807",
    url: "https://www.rfc-editor.org/rfc/rfc7807.txt",
    kind: "text",
  },
  {
    id: "rfc7519",
    url: "https://www.rfc-editor.org/rfc/rfc7519.txt",
    kind: "text",
  },
  {
    id: "vite_readme",
    url: "https://raw.githubusercontent.com/vitejs/vite/main/README.md",
    kind: "text",
  },
  {
    id: "bun_readme",
    url: "https://raw.githubusercontent.com/oven-sh/bun/main/README.md",
    kind: "text",
  },
];

/** Rare golds + questions — answers must appear literally in the source text. */
const CASES = [
  {
    id: "etcd_coreos",
    source: "wiki_etcd",
    input: "Which company originally developed etcd before it was donated to the Cloud Native Computing Foundation?",
    answers: ["CoreOS"],
  },
  {
    id: "etcd_raft",
    source: "wiki_etcd",
    input: "Which consensus algorithm does etcd use for distributed consistency?",
    answers: ["Raft"],
  },
  {
    id: "spanner_google",
    source: "wiki_spanner",
    input: "Which company developed the globally distributed database Spanner?",
    answers: ["Google"],
  },
  {
    id: "spanner_trueTime",
    source: "wiki_spanner",
    input: "What is the name of Spanner's globally synchronized clock API used for external consistency?",
    answers: ["TrueTime"],
  },
  {
    id: "bloom_burton",
    source: "wiki_bloom",
    input: "Who invented the Bloom filter space-efficient probabilistic data structure?",
    answers: ["Burton Howard Bloom"],
  },
  {
    id: "bloom_false_pos",
    source: "wiki_bloom",
    input: "Bloom filters can report false positives but never report which other error type?",
    answers: ["false negatives"],
  },
  {
    id: "chord_stoica",
    source: "wiki_chord",
    input: "Name one of the authors of the Chord distributed hash table paper from MIT.",
    answers: ["Ion Stoica"],
  },
  {
    id: "jwt_rfc",
    source: "wiki_jwt",
    input: "Which RFC number standardizes JSON Web Token (JWT)?",
    answers: ["RFC 7519"],
  },
  {
    id: "jwt_jose",
    source: "rfc7519",
    input: "In RFC 7519, JWT is a compact claims representation intended for which related JOSE family space?",
    answers: ["JSON Web Signature"],
  },
  {
    id: "bun_jarred",
    source: "wiki_bun",
    input: "Who created the Bun JavaScript runtime?",
    answers: ["Jarred Sumner"],
  },
  {
    id: "bun_zig",
    source: "wiki_bun",
    input: "Which systems programming language is Bun primarily written in?",
    answers: ["Zig"],
  },
  {
    id: "rfc7807_type",
    source: "rfc7807",
    input: "What media type does RFC 7807 define for HTTP API problem details?",
    answers: ["application/problem+json"],
  },
  {
    id: "rfc7807_title",
    source: "rfc7807",
    input: "In RFC 7807 problem details, which field is a short human-readable summary of the problem type?",
    answers: ["title"],
  },
  {
    id: "vite_evan",
    source: "vite_readme",
    input: "Who is listed as creating Vite in the Vite README?",
    answers: ["Evan You"],
  },
  {
    id: "vite_native_esm",
    source: "vite_readme",
    input: "Vite's dev server leverages which browser-native module system for fast cold starts?",
    answers: ["native ES modules"],
  },
  {
    id: "bun_readme_zig",
    source: "bun_readme",
    input: "According to the Bun README, Bun's JS runtime is written primarily using which language?",
    answers: ["Zig"],
  },
];

function haystack(goldText, allTexts, goldId) {
  const others = Object.entries(allTexts)
    .filter(([id]) => id !== goldId)
    .map(([, t]) => t);
  // Shuffle distractors with a fixed salt from goldId
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
      // show a hint
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
        name: "ood_fresh4_hard",
        note: "Brand-new 2026-07-29 sources (etcd/Spanner/Bloom/Chord/JWT/Bun/RFC7807/Vite) buried in distractors. Never used in seed 4242 tuning.",
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
