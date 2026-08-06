#!/usr/bin/env node
/**
 * Fresh OOD eval — tasks + docs never used in prior held-out tuning loops.
 *
 * Primary metric: gold answer containment (independent of engine IK).
 * Also reports engine important_kept_pct honestly (no restore-to-target floor).
 *
 * New LongBench: musique, narrativeqa, passage_retrieval_en, qmsum, trec
 * Fresh docs: /tmp/sc-heldout/ood_fresh
 * Seed default 777 (disjoint from prior seed-42 runs on overlapping corpora).
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const WEB = path.join(ROOT, "web", "assets");
const HELDOUT = process.env.SC_HELDOUT_DIR || "/tmp/sc-heldout";
const MAX_CTX_CHARS = Number(process.env.SC_MAX_CTX || 120_000);
const PER_TASK = Number(process.env.SC_PER_TASK || 20);
const SEED = Number(process.env.SC_SEED || 777);

const sandbox = { globalThis: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(WEB, "js", "compress-engine.js"), "utf8"), sandbox);
const E = sandbox.globalThis.SuperCompressEngine;
const model = JSON.parse(fs.readFileSync(path.join(WEB, "data", "model.json"), "utf8"));

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function answerContained(compressed, answers) {
  const hay = norm(compressed);
  if (!answers || !answers.length) return null;
  const hits = [];
  for (const a of answers) {
    const needle = norm(a);
    if (!needle || needle.length < 2) continue;
    hits.push({ answer: a, kept: hay.includes(needle) });
  }
  if (!hits.length) return null;
  const kept = hits.filter((h) => h.kept).length;
  return { kept, total: hits.length, all: kept === hits.length, any: kept > 0, hits };
}

async function sampleJsonl(file, n, rng) {
  const lines = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line.trim()) lines.push(line);
  }
  return shuffle(lines, rng)
    .slice(0, n)
    .map((l) => JSON.parse(l));
}

function clip(ctx) {
  if (ctx.length <= MAX_CTX_CHARS) return ctx;
  return ctx.slice(0, MAX_CTX_CHARS) + "\n…[truncated for bench]…";
}

function runOne(context, query, answers, meta) {
  const ctx = clip(context);
  const q = query || "Summarize the key facts and decisions in this context.";
  const t0 = Date.now();
  const r = E.compressAdaptive(ctx, q, model);
  const ms = Date.now() - t0;
  const compressed = r.compressed_text || "";
  const list = Array.isArray(answers) ? answers : answers ? [answers] : [];
  const present = list.filter((a) => {
    const needle = norm(a);
    return needle.length >= 2 && norm(ctx).includes(needle);
  });
  const ans = present.length ? answerContained(compressed, present) : null;
  return {
    ...meta,
    original_tokens: r.original_tokens,
    kept_tokens: r.kept_tokens,
    tokens_removed: r.original_tokens - r.kept_tokens,
    tokens_saved_pct: Math.round(r.tokens_saved_pct * 10) / 10,
    important_kept_pct: r.important_kept_pct,
    answer_in_original: present.length > 0,
    answer_all_kept: ans ? ans.all : null,
    answer_any_kept: ans ? ans.any : null,
    answer_kept_frac: ans ? ans.kept / ans.total : null,
    latency_ms: ms,
  };
}

function mean(xs) {
  const v = xs.filter((x) => x != null && !Number.isNaN(x));
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function summarize(rows) {
  const inTok = rows.reduce((s, r) => s + r.original_tokens, 0);
  const outTok = rows.reduce((s, r) => s + r.kept_tokens, 0);
  const withAns = rows.filter((r) => r.answer_all_kept != null);
  const iks = rows.map((r) => r.important_kept_pct).filter((x) => x != null);
  return {
    n: rows.length,
    mean_cut_pct: mean(rows.map((r) => r.tokens_saved_pct)),
    token_weighted_cut_pct: Math.round((1 - outTok / Math.max(inTok, 1)) * 1000) / 10,
    mean_important_kept_pct: mean(iks),
    min_important_kept_pct: iks.length ? Math.min(...iks) : null,
    pct_runs_ik_ge_98: iks.length ? iks.filter((x) => x >= 0.98).length / iks.length : null,
    answer_all_kept_rate: withAns.length
      ? withAns.filter((r) => r.answer_all_kept).length / withAns.length
      : null,
    answer_any_kept_rate: withAns.length
      ? withAns.filter((r) => r.answer_any_kept).length / withAns.length
      : null,
    mean_answer_kept_frac: mean(rows.map((r) => r.answer_kept_frac)),
    mean_latency_ms: mean(rows.map((r) => r.latency_ms)),
    total_tokens_in: inTok,
    total_tokens_out: outTok,
  };
}

/** Tasks never used in prior held-out benchmark_heldout.js loops. */
const FRESH_QA = [
  { file: "musique.jsonl", label: "longbench_musique" },
  { file: "narrativeqa.jsonl", label: "longbench_narrativeqa" },
  { file: "passage_retrieval_en.jsonl", label: "longbench_passage_retrieval_en" },
];

const FRESH_OTHER = [
  { file: "qmsum.jsonl", label: "longbench_qmsum" },
  { file: "trec.jsonl", label: "longbench_trec" },
];

function freshDocCases() {
  const dir = path.join(HELDOUT, "ood_fresh");
  const cases = [];
  function add(file, query, answers, label) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) return;
    const context = fs.readFileSync(p, "utf8");
    if (context.length < 200) return;
    cases.push({ context, query, answers, label, source: file });
  }

  add("wiki_Transformer.txt", "What architecture uses self-attention instead of recurrence?", ["Transformer", "self-attention"], "wiki_transformer");
  add("wiki_Kubernetes.txt", "What is Kubernetes used for?", ["Kubernetes", "container"], "wiki_kubernetes");
  add("wiki_Bitcoin.txt", "Who created Bitcoin and what problem does it solve?", ["Satoshi Nakamoto", "Bitcoin"], "wiki_bitcoin");
  add("wiki_GraphQL.txt", "What is GraphQL?", ["GraphQL", "query language"], "wiki_graphql");
  add("wiki_WebAssembly.txt", "What is WebAssembly?", ["WebAssembly", "Wasm"], "wiki_wasm");
  add("wiki_Kafka.txt", "What is Apache Kafka?", ["Kafka", "streaming"], "wiki_kafka");
  add("wiki_Dijkstra.txt", "What does Dijkstra's algorithm compute?", ["shortest", "path"], "wiki_dijkstra");
  add("wiki_Merkle.txt", "What is a Merkle tree used for?", ["hash", "Merkle"], "wiki_merkle");
  add("wiki_CRDT.txt", "What problem do CRDTs solve?", ["conflict", "replicated"], "wiki_crdt");
  add("wiki_BPE.txt", "What is byte pair encoding used for?", ["token", "subword"], "wiki_bpe");
  add("wiki_Paxos.txt", "What is the Paxos algorithm for?", ["consensus", "Paxos"], "wiki_paxos");
  add("wiki_SQLite.txt", "What kind of database is SQLite?", ["SQLite", "embedded"], "wiki_sqlite");
  add("rfc7519.txt", "What does JWT stand for in RFC 7519?", ["JSON Web Token", "JWT"], "rfc_jwt");
  add("go_readme.md", "What is the Go programming language?", ["Go", "open source"], "go_readme");
  add("react_readme.md", "What is React?", ["React", "UI"], "react_readme");
  add("nextjs_readme.md", "What is Next.js?", ["Next.js", "React"], "nextjs_readme");
  return cases;
}

async function main() {
  const rng = mulberry32(SEED);
  const byTask = {};
  const all = [];

  async function runTaskList(tasks) {
    for (const t of tasks) {
      const file = path.join(HELDOUT, "data", t.file);
      if (!fs.existsSync(file)) {
        console.error("missing", file);
        continue;
      }
      const samples = await sampleJsonl(file, PER_TASK, rng);
      const rows = [];
      for (const s of samples) {
        let answers = s.answers;
        if (typeof answers === "string") answers = [answers];
        if (!Array.isArray(answers)) answers = [];
        const row = runOne(s.context || "", s.input || "", answers, {
          task: t.label,
          id: s._id || null,
        });
        rows.push(row);
        all.push(row);
        process.stderr.write(
          `.${t.label} ${rows.length}/${samples.length} cut=${row.tokens_saved_pct}% ik=${
            row.important_kept_pct == null ? "n/a" : ((row.important_kept_pct || 0) * 100).toFixed(0)
          }% ans=${row.answer_all_kept}\n`
        );
      }
      byTask[t.label] = { summary: summarize(rows), samples: rows };
    }
  }

  await runTaskList(FRESH_QA);
  await runTaskList(FRESH_OTHER);

  const docs = freshDocCases();
  const docRows = [];
  for (const d of docs) {
    const row = runOne(d.context, d.query, d.answers, {
      task: "ood_fresh_docs",
      id: d.label,
      source: d.source,
    });
    docRows.push(row);
    all.push(row);
    process.stderr.write(
      `.docs ${d.label} cut=${row.tokens_saved_pct}% ik=${
        row.important_kept_pct == null ? "n/a" : ((row.important_kept_pct || 0) * 100).toFixed(0)
      }% ans=${row.answer_all_kept}\n`
    );
  }
  byTask.ood_fresh_docs = { summary: summarize(docRows), samples: docRows };

  const qaRows = all.filter((r) => FRESH_QA.some((t) => t.label === r.task) || r.task === "ood_fresh_docs");
  const out = {
    meta: {
      fresh_ood: true,
      note:
        "NEW tasks (musique/narrativeqa/passage_retrieval/qmsum/trec) + brand-new wiki/RFC/README docs. Seed 777. No restore-to-98% hard floor. Primary = answer containment.",
      seed: SEED,
      per_task: PER_TASK,
      max_ctx_chars: MAX_CTX_CHARS,
      primary_qa_metric: "answer_containment",
      hard_floor_removed: true,
    },
    overall: summarize(all),
    qa_primary: summarize(qaRows),
    by_task: Object.fromEntries(Object.entries(byTask).map(([k, v]) => [k, v.summary])),
  };

  const outPath = path.join(WEB, "data", "fresh-benchmark-latest.json");
  fs.writeFileSync(outPath, JSON.stringify({ ...out, samples: all }, null, 2));
  console.log(JSON.stringify({ ...out, wrote: outPath }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
