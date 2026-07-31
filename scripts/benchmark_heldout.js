#!/usr/bin/env node
/**
 * Held-out / OOD compression benchmark.
 *
 * Uses public LongBench tasks + external docs — NOT the synthetic generators
 * or impact-presets used for marketing numbers.
 *
 * Primary quality signal for QA tasks: answer string(s) still present in
 * compressed context (answer containment). Also reports engine important_kept.
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const WEB = path.join(ROOT, "web", "assets");
const HELDOUT = process.env.SC_HELDOUT_DIR || "/tmp/sc-heldout";
const MAX_CTX_CHARS = Number(process.env.SC_MAX_CTX || 120_000);
const PER_TASK = Number(process.env.SC_PER_TASK || 25);
const SEED = Number(process.env.SC_SEED || 42);

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

/** True if any gold answer appears in compressed text (case-insensitive substring). */
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
  // Only score aliases that actually appear in the (clipped) original.
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
    kv_savings_pct: Math.round(r.kv_savings_pct * 10) / 10,
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
  return {
    n: rows.length,
    mean_cut_pct: mean(rows.map((r) => r.kv_savings_pct)),
    token_weighted_cut_pct: Math.round((1 - outTok / Math.max(inTok, 1)) * 1000) / 10,
    mean_important_kept_pct: mean(rows.map((r) => r.important_kept_pct)),
    min_important_kept_pct: Math.min(...rows.map((r) => r.important_kept_pct ?? 1)),
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

const QA_TASKS = [
  { file: "hotpotqa.jsonl", label: "longbench_hotpotqa" },
  { file: "2wikimqa.jsonl", label: "longbench_2wikimqa" },
  { file: "qasper.jsonl", label: "longbench_qasper" },
  { file: "multifieldqa_en.jsonl", label: "longbench_multifieldqa_en" },
  { file: "triviaqa.jsonl", label: "longbench_triviaqa" },
];

const CODE_TASKS = [
  { file: "lcc.jsonl", label: "longbench_lcc", code: true },
  { file: "repobench-p.jsonl", label: "longbench_repobench_p", code: true },
];

const SUM_TASKS = [
  { file: "gov_report.jsonl", label: "longbench_gov_report" },
  { file: "multi_news.jsonl", label: "longbench_multi_news" },
  { file: "samsum.jsonl", label: "longbench_samsum" },
];

/** Hand queries over external docs where the answer string is in the source. */
function docCases() {
  const docsDir = path.join(HELDOUT, "ood_docs");
  const rootExtras = HELDOUT;
  const cases = [];

  function add(file, query, answers, label) {
    const p = fs.existsSync(file) ? file : null;
    if (!p) return;
    const context = fs.readFileSync(p, "utf8");
    if (context.length < 200) return;
    cases.push({ context, query, answers, label, source: path.basename(file) });
  }

  add(
    path.join(docsDir, "wiki_PostgreSQL.txt"),
    "What kind of database system is PostgreSQL?",
    ["PostgreSQL", "relational"],
    "wiki_postgresql"
  );
  add(
    path.join(docsDir, "wiki_Rust_programming_language.txt"),
    "Who originally designed Rust and what company sponsored early development?",
    ["Graydon Hoare", "Mozilla"],
    "wiki_rust"
  );
  add(
    path.join(docsDir, "wiki_Raft_algorithm.txt"),
    "What problem does the Raft consensus algorithm solve?",
    ["consensus", "replicated"],
    "wiki_raft"
  );
  add(
    path.join(docsDir, "wiki_Bloom_filter.txt"),
    "What false positive / false negative properties does a Bloom filter have?",
    ["false positives", "false negatives"],
    "wiki_bloom"
  );
  add(
    path.join(docsDir, "wiki_CAP_theorem.txt"),
    "What does the CAP theorem say about distributed data stores?",
    ["consistency", "availability", "partition"],
    "wiki_cap"
  );
  add(
    path.join(docsDir, "wiki_Consistent_hashing.txt"),
    "What problem does consistent hashing address?",
    ["hash", "distributed"],
    "wiki_consistent_hashing"
  );
  add(
    path.join(docsDir, "wiki_Vector_clock.txt"),
    "What are vector clocks used for?",
    ["causality", "distributed"],
    "wiki_vector_clock"
  );
  add(
    path.join(docsDir, "wiki_HTTP_2.txt"),
    "What is HTTP/2?",
    ["HTTP/2", "multiplexing"],
    "wiki_http2"
  );
  add(
    path.join(docsDir, "rfc7540.txt"),
    "What is HTTP/2 and what framing does it introduce?",
    ["HTTP/2", "frame", "stream"],
    "rfc_http2"
  );
  add(
    path.join(docsDir, "rfc8446.txt"),
    "What TLS version does RFC 8446 define?",
    ["TLS 1.3", "Transport Layer Security"],
    "rfc_tls13"
  );
  add(
    path.join(rootExtras, "rfc9110.txt"),
    "What does RFC 9110 specify about HTTP semantics?",
    ["HTTP", "semantics", "GET"],
    "rfc_http_semantics"
  );
  add(
    path.join(docsDir, "redis_readme.txt"),
    "What is Redis primarily used for?",
    ["Redis", "in-memory"],
    "redis_readme"
  );
  add(
    path.join(docsDir, "caddy_readme.txt"),
    "What is Caddy?",
    ["Caddy", "web server"],
    "caddy_readme"
  );
  add(
    path.join(rootExtras, "pytorch_readme.md"),
    "What is PyTorch?",
    ["PyTorch", "tensor"],
    "pytorch_readme"
  );
  add(
    path.join(rootExtras, "kubernetes_readme.md"),
    "What is Kubernetes?",
    ["Kubernetes", "container"],
    "kubernetes_readme"
  );
  return cases;
}

async function main() {
  const rng = mulberry32(SEED);
  const byTask = {};
  const all = [];

  async function runTaskList(tasks, opts = {}) {
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
        // For code completion, gold is often the next line(s)
        if (opts.code && answers.length) {
          // keep as-is
        }
        const row = runOne(s.context || "", s.input || "", answers, {
          task: t.label,
          id: s._id || null,
        });
        rows.push(row);
        all.push(row);
        process.stderr.write(
          `.${t.label} ${rows.length}/${samples.length} cut=${row.kv_savings_pct}% ik=${((row.important_kept_pct || 0) * 100).toFixed(0)}% ans=${row.answer_all_kept}\n`
        );
      }
      byTask[t.label] = { summary: summarize(rows), samples: rows };
    }
  }

  await runTaskList(QA_TASKS);
  await runTaskList(CODE_TASKS, { code: true });
  await runTaskList(SUM_TASKS);

  // External docs
  const docs = docCases();
  const docRows = [];
  for (const d of docs) {
    const row = runOne(d.context, d.query, d.answers, {
      task: "ood_public_docs",
      id: d.label,
      source: d.source,
    });
    docRows.push(row);
    all.push(row);
    process.stderr.write(
      `.docs ${d.label} cut=${row.kv_savings_pct}% ik=${((row.important_kept_pct || 0) * 100).toFixed(0)}% ans=${row.answer_all_kept}\n`
    );
  }
  byTask.ood_public_docs = { summary: summarize(docRows), samples: docRows };

  const qaRows = all.filter((r) => QA_TASKS.some((t) => t.label === r.task));
  const out = {
    meta: {
      held_out: true,
      note:
        "LongBench (THUDM) + public Wikipedia/RFC/README docs. Not synthetic SC generators or impact-presets. Model was trained on synthetic feature noise, not these texts.",
      seed: SEED,
      per_task: PER_TASK,
      max_ctx_chars: MAX_CTX_CHARS,
      primary_qa_metric: "answer_containment",
    },
    overall: summarize(all),
    qa_only: summarize(qaRows),
    by_task: Object.fromEntries(
      Object.entries(byTask).map(([k, v]) => [k, v.summary])
    ),
    runs: all,
  };

  const outPath = path.join(WEB, "data", "heldout-benchmark-latest.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  fs.writeFileSync("/tmp/sc-heldout-benchmark.json", JSON.stringify(out, null, 2));
  process.stdout.write(
    JSON.stringify(
      {
        overall: out.overall,
        qa_only: out.qa_only,
        by_task: out.by_task,
        wrote: outPath,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
