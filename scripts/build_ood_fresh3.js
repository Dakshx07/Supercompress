#!/usr/bin/env node
/**
 * Rebuild ood_fresh3 hard cases used by benchmark_real.js (seed 4242).
 * Mirrors the case IDs from web/assets/data/real-benchmark-latest.json.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const OUT = process.env.SC_FRESH3_DIR || "/tmp/sc-heldout/ood_fresh3";
const SRC = path.join(OUT, "sources");

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          "User-Agent": "SuperCompressFresh3/1.0",
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
    id: "wiki_postgres",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=PostgreSQL&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "wiki_paxos",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=Paxos_(computer_science)&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "wiki_raft",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=Raft_(algorithm)&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "wiki_lamport",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=Lamport_timestamp&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "wiki_cap",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=CAP_theorem&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "wiki_wasm",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=WebAssembly&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "wiki_webrtc",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=WebRTC&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "wiki_tls13",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=Transport_Layer_Security&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "wiki_cbor",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=CBOR&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "wiki_toml",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=TOML&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "wiki_go",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=Go_(programming_language)&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "wiki_graphql",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=GraphQL&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "rfc8446",
    url: "https://www.rfc-editor.org/rfc/rfc8446.txt",
    kind: "text",
  },
  {
    id: "rfc8949",
    url: "https://www.rfc-editor.org/rfc/rfc8949.txt",
    kind: "text",
  },
  {
    id: "rfc9111",
    url: "https://www.rfc-editor.org/rfc/rfc9111.txt",
    kind: "text",
  },
  {
    id: "toml_readme",
    url: "https://raw.githubusercontent.com/toml-lang/toml/main/README.md",
    kind: "text",
  },
  {
    id: "cpython_readme",
    url: "https://raw.githubusercontent.com/python/cpython/main/README.rst",
    kind: "text",
  },
  {
    id: "sqlite_readme",
    url: "https://raw.githubusercontent.com/sqlite/sqlite/master/README.md",
    kind: "text",
  },
];

const CASES = [
  {
    id: "pg_stonebraker",
    source: "wiki_postgres",
    input:
      "Who left Berkeley in 1982 after leading the Ingres team, then later started the post-Ingres project that became PostgreSQL?",
    answers: ["Michael Stonebraker"],
  },
  {
    id: "pg_postquel",
    source: "wiki_postgres",
    input: "What query language did Berkeley POSTGRES use before SQL was added in Postgres95?",
    answers: ["POSTQUEL"],
  },
  {
    id: "pg_jolly",
    source: "wiki_postgres",
    input:
      "Which Berkeley graduate student, working with Andrew Yu, helped replace POSTQUEL with SQL, creating Postgres95?",
    answers: ["Jolly Chen"],
  },
  {
    id: "paxos_lamport",
    source: "wiki_paxos",
    input: "Who proposed the Paxos family of protocols for consensus?",
    answers: ["Leslie Lamport"],
  },
  {
    id: "paxos_schneider",
    source: "wiki_paxos",
    input: "Which researcher is named Fred Schneider in the Paxos article?",
    answers: ["Fred Schneider"],
  },
  {
    id: "raft_ongaro",
    source: "wiki_raft",
    input: "Which Raft co-author tried to create a formal safety proof for membership changes?",
    answers: ["Diego Ongaro"],
  },
  {
    id: "lamport_author",
    source: "wiki_lamport",
    input: "Who invented Lamport timestamps?",
    answers: ["Leslie Lamport"],
  },
  {
    id: "cap_brewer",
    source: "wiki_cap",
    input: "Who conjectured the CAP theorem?",
    answers: ["Eric Brewer"],
  },
  {
    id: "cap_gilbert",
    source: "wiki_cap",
    input: "Who, with Nancy Lynch, published a formal proof related to Brewer CAP conjecture?",
    answers: ["Seth Gilbert"],
  },
  {
    id: "wasm_asmjs",
    source: "wiki_wasm",
    input: "Which Mozilla project (asm.js) is discussed in relation to WebAssembly history?",
    answers: ["asm.js"],
  },
  {
    id: "webrtc_ericsson",
    source: "wiki_webrtc",
    input: "Which company laboratory open-sourced an early WebRTC implementation mentioned in history?",
    answers: ["Ericsson Labs"],
  },
  {
    id: "webrtc_hangouts",
    source: "wiki_webrtc",
    input: "Which Google product is mentioned as using WebRTC in the article?",
    answers: ["Google Hangouts"],
  },
  {
    id: "tls_0rtt",
    source: "wiki_tls13",
    input:
      "What abbreviated early-data mode in TLS 1.3 saves a round trip but has weaker replay properties?",
    answers: ["0-RTT"],
  },
  {
    id: "tls_rescorla",
    source: "rfc8446",
    input: "Who is the listed author of RFC 8446 (TLS 1.3)?",
    answers: ["Rescorla"],
  },
  {
    id: "cbor_expand",
    source: "wiki_cbor",
    input: "What does CBOR stand for?",
    answers: ["Concise Binary Object Representation"],
  },
  {
    id: "cbor_bormann",
    source: "rfc8949",
    input: "Which surname appears as an RFC 8949 author?",
    answers: ["Bormann"],
  },
  {
    id: "toml_tom",
    source: "wiki_toml",
    input: "Who originally created TOML (full name)?",
    answers: ["Tom Preston-Werner"],
  },
  {
    id: "toml_pradyun",
    source: "toml_readme",
    input: "Who is listed as a maintainer alongside Tom Preston-Werner on the TOML README?",
    answers: ["Pradyun Gedam"],
  },
  {
    id: "go_renee",
    source: "wiki_go",
    input: "Who designed the Go gopher mascot?",
    answers: ["Renee French"],
  },
  {
    id: "py_psf",
    source: "cpython_readme",
    input: "Which foundation is mentioned as stewarding Python community resources in the CPython README?",
    answers: ["Python Software Foundation"],
  },
  {
    id: "sqlite_pd",
    source: "sqlite_readme",
    input: "How does the SQLite README describe the licensing dedication of the code (two-word phrase)?",
    answers: ["public domain"],
  },
  {
    id: "graphql_fb",
    source: "wiki_graphql",
    input: "Which company originally created GraphQL?",
    answers: ["Facebook"],
  },
  {
    id: "cache_cc",
    source: "rfc9111",
    input: "Which HTTP header name is central to cache directives in RFC 9111?",
    answers: ["Cache-Control"],
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
    cases.push({
      id: c.id,
      input: c.input,
      answers: c.answers,
      context: haystack(src, texts, c.source),
      source: c.source,
    });
  }

  const outPath = path.join(OUT, "hard_cases.jsonl");
  fs.writeFileSync(outPath, cases.map((c) => JSON.stringify(c)).join("\n") + "\n");
  fs.writeFileSync(
    path.join(OUT, "manifest.json"),
    JSON.stringify(
      {
        name: "ood_fresh3_hard",
        note: "Rebuilt for real-bench seed 4242 (Postgres/Paxos/Raft/CAP/Wasm/WebRTC/TLS/CBOR/TOML/Go/GraphQL/RFC).",
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
