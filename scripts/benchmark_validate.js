#!/usr/bin/env node
/**
 * Anti-overfit validation: NEW seed + NEW docs, same held-out LongBench tasks
 * but freshly shuffled samples never used in the seed-777 tuning loop.
 *
 * Primary: gold answer containment. Also reports cut + engine IK.
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const WEB = path.join(ROOT, "web", "assets");
const HELDOUT = process.env.SC_HELDOUT_DIR || "/tmp/sc-heldout";
const MAX_CTX_CHARS = Number(process.env.SC_MAX_CTX || 120_000);
const PER_TASK = Number(process.env.SC_PER_TASK || 15);
const SEED = Number(process.env.SC_SEED || 2026); // never used in tuning

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
  return { kept, total: hits.length, all: kept === hits.length, any: kept > 0 };
}
async function sampleJsonl(file, n, rng) {
  const lines = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) if (line.trim()) lines.push(line);
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
    tokens_saved_pct: Math.round(r.tokens_saved_pct * 10) / 10,
    important_kept_pct: r.important_kept_pct,
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
    answer_drops: withAns.filter((r) => !r.answer_all_kept).length,
    scoreable_answers: withAns.length,
    mean_latency_ms: mean(rows.map((r) => r.latency_ms)),
    total_tokens_in: inTok,
    total_tokens_out: outTok,
  };
}

const QA_TASKS = [
  { file: "musique.jsonl", label: "longbench_musique" },
  { file: "narrativeqa.jsonl", label: "longbench_narrativeqa" },
  { file: "passage_retrieval_en.jsonl", label: "longbench_passage_retrieval_en" },
];
const OTHER = [
  { file: "qmsum.jsonl", label: "longbench_qmsum" },
  { file: "trec.jsonl", label: "longbench_trec" },
];

function fresh2Docs() {
  const dir = path.join(HELDOUT, "ood_fresh2");
  const cases = [];
  function add(file, query, answers, label) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) return;
    const context = fs.readFileSync(p, "utf8");
    if (context.length < 200) return;
    cases.push({ context, query, answers, label, source: file });
  }
  add("wiki_Linux.txt", "What is Linux?", ["Linux", "operating system"], "wiki_linux");
  add("wiki_DNS.txt", "What does DNS stand for and what does it do?", ["Domain Name System", "DNS"], "wiki_dns");
  add("wiki_OAuth.txt", "What is OAuth used for?", ["OAuth", "authorization"], "wiki_oauth");
  add("wiki_MapReduce.txt", "What is MapReduce?", ["MapReduce", "Google"], "wiki_mapreduce");
  add("wiki_TCP.txt", "What does TCP provide?", ["TCP", "reliable"], "wiki_tcp");
  add("wiki_Redis.txt", "What is Redis?", ["Redis", "in-memory"], "wiki_redis");
  add("wiki_Docker.txt", "What is Docker?", ["Docker", "containers"], "wiki_docker");
  add("wiki_Zookeeper.txt", "What is Apache ZooKeeper used for?", ["ZooKeeper", "distributed"], "wiki_zookeeper");
  add("rfc8259.txt", "What does RFC 8259 define?", ["JSON", "JavaScript Object Notation"], "rfc_json");
  add("rust_readme.md", "What is Rust?", ["Rust", "programming language"], "rust_readme");
  add("numpy_readme.md", "What is NumPy?", ["NumPy", "Python"], "numpy_readme");
  return cases;
}

async function main() {
  const rng = mulberry32(SEED);
  const byTask = {};
  const all = [];

  async function runTasks(tasks) {
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
          `.${t.label} ${rows.length}/${samples.length} cut=${row.tokens_saved_pct}% ans=${row.answer_all_kept}\n`
        );
      }
      byTask[t.label] = summarize(rows);
    }
  }

  await runTasks(QA_TASKS);
  await runTasks(OTHER);

  const docs = fresh2Docs();
  const docRows = [];
  for (const d of docs) {
    const row = runOne(d.context, d.query, d.answers, {
      task: "ood_fresh2_docs",
      id: d.label,
      source: d.source,
    });
    docRows.push(row);
    all.push(row);
    process.stderr.write(`.docs ${d.label} cut=${row.tokens_saved_pct}% ans=${row.answer_all_kept}\n`);
  }
  byTask.ood_fresh2_docs = summarize(docRows);

  const withAns = all.filter((r) => r.answer_all_kept != null);
  const out = {
    meta: {
      validation: true,
      anti_overfit: true,
      note: "Seed 2026 (never used in tuning) + brand-new wiki/RFC/README docs (ood_fresh2). LongBench tasks reshuffled. Primary = answer containment.",
      seed: SEED,
      per_task: PER_TASK,
      tuned_against_seed: 777,
    },
    gates: {
      avg_cut_ge_55: null,
      always_answer_ge_98: null,
    },
    overall: summarize(all),
    answer_scoreable: summarize(withAns),
    by_task: byTask,
  };
  out.gates.avg_cut_ge_55 = out.overall.mean_cut_pct >= 55;
  out.gates.token_weighted_cut_ge_55 = out.overall.token_weighted_cut_pct >= 55;
  out.gates.always_answer_ge_98 =
    out.overall.answer_all_kept_rate != null && out.overall.answer_all_kept_rate >= 0.98;
  out.gates.pass = out.gates.avg_cut_ge_55 && out.gates.always_answer_ge_98;

  const outPath = path.join(WEB, "data", "validate-benchmark-latest.json");
  fs.writeFileSync(outPath, JSON.stringify({ ...out, samples: all }, null, 2));
  console.log(JSON.stringify({ ...out, wrote: outPath }, null, 2));
  if (!out.gates.pass) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
