#!/usr/bin/env node
/**
 * ood_fresh6 — brand-new sources, never used in fresh3/4/5 or seed 4242.
 * Gold answers are rare strings buried mid-haystack (not page-title keywords).
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const OUT = process.env.SC_FRESH6_DIR || "/tmp/sc-heldout/ood_fresh6";
const SRC = path.join(OUT, "sources");

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          "User-Agent": "SuperCompressFresh6/1.0",
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
    id: "wiki_raft",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=Raft_(algorithm)&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "wiki_paxos",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=Paxos_(computer_science)&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "wiki_quic",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=QUIC&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "wiki_tailscale",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=Tailscale&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "wiki_nix",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=Nix_(package_manager)&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "wiki_zig",
    url: "https://en.wikipedia.org/w/api.php?action=parse&page=Zig_(programming_language)&prop=text&format=json&formatversion=2",
    kind: "wiki",
  },
  {
    id: "rfc9000",
    url: "https://www.rfc-editor.org/rfc/rfc9000.txt",
    kind: "text",
  },
  {
    id: "rfc8446",
    url: "https://www.rfc-editor.org/rfc/rfc8446.txt",
    kind: "text",
  },
  {
    id: "sqlite_readme",
    url: "https://raw.githubusercontent.com/sqlite/sqlite/master/README.md",
    kind: "text",
  },
  {
    id: "uv_readme",
    url: "https://raw.githubusercontent.com/astral-sh/uv/main/README.md",
    kind: "text",
  },
];

/** Prefer non-title golds that must be retrieved from body text. */
const CASES = [
  {
    id: "raft_ongaro",
    source: "wiki_raft",
    input: "Who co-authored the Raft consensus algorithm paper with John Ousterhout?",
    answers: ["Diego Ongaro"],
  },
  {
    id: "raft_leader_election",
    source: "wiki_raft",
    input: "In Raft, what is the name of the process by which a new leader is chosen after a failure?",
    answers: ["leader election"],
  },
  {
    id: "paxos_lamport",
    source: "wiki_paxos",
    input: "Who introduced the Paxos family of consensus protocols?",
    answers: ["Leslie Lamport"],
  },
  {
    id: "quic_multiplex",
    source: "wiki_quic",
    input: "QUIC multiplexes streams over a single connection using which underlying transport protocol?",
    answers: ["UDP"],
  },
  {
    id: "quic_google",
    source: "wiki_quic",
    input: "Which company originally designed QUIC before it was standardized at the IETF?",
    answers: ["Google"],
  },
  {
    id: "tailscale_wireguard",
    source: "wiki_tailscale",
    input: "Tailscale builds its mesh VPN on top of which open-source VPN protocol?",
    answers: ["WireGuard"],
  },
  {
    id: "nix_dolstra",
    source: "wiki_nix",
    input: "Who created the Nix package manager?",
    answers: ["Eelco Dolstra"],
  },
  {
    id: "zig_kelley",
    source: "wiki_zig",
    input: "Who created the Zig programming language?",
    answers: ["Andrew Kelley"],
  },
  {
    id: "rfc9000_quic",
    source: "rfc9000",
    input: "RFC 9000 specifies which transport protocol?",
    answers: ["QUIC"],
  },
  {
    id: "rfc8446_tls13",
    source: "rfc8446",
    input: "RFC 8446 is the standards-track specification for which version of TLS?",
    answers: ["TLS 1.3"],
  },
  {
    id: "sqlite_hipp",
    source: "sqlite_readme",
    input: "According to the SQLite README, who is the primary author of SQLite?",
    answers: ["D. Richard Hipp"],
  },
  {
    id: "uv_astral",
    source: "uv_readme",
    input: "Which company or org develops the uv Python package manager according to its README?",
    answers: ["Astral"],
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
  // Bury gold deeper: more distractors before and after than fresh5
  const before = shuffled.slice(0, 6).join("\n\n==== DISTRACTOR ====\n\n");
  const after = shuffled.slice(6).join("\n\n==== DISTRACTOR ====\n\n");
  return [
    before.slice(0, 50000),
    "\n\n===== SOURCE DOCUMENT =====\n\n",
    goldText.slice(0, 40000),
    "\n\n===== END SOURCE =====\n\n",
    after.slice(0, 50000),
  ].join("");
}

async function loadWiki(url) {
  const raw = await fetchUrl(url);
  const j = JSON.parse(raw);
  return stripHtml(j.parse?.text || "");
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
      process.stderr.write(`skip ${c.id}: missing source\n`);
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
        name: "ood_fresh6_hard",
        note: "Brand-new 2026-07-30 sources (Raft/Paxos/QUIC/Tailscale/Nix/Zig/RFC9000/RFC8446/sqlite/uv). Deeper bury. Never used in prior benches.",
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
