#!/usr/bin/env node
/**
 * Brand-new anti-overfit bench (ood_fresh5 + never-used LongBench seed 6161).
 * Gates: answer containment ≥98% on scoreable; mean cut ≥55%; TW cut ≥55%.
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
const SEED = Number(process.env.SC_SEED || 6161);

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
/** Short answers ("Pig") must not match distractors like "pigment". */
function answerInText(hayNorm, answer) {
  const raw = norm(answer);
  const needle = raw.replace(/[.,;:!?\"']+$/g, "").trim();
  if (!needle || needle.length < 2) return false;
  if (needle.length <= 5) {
    const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9])${esc}(?:[^a-z0-9]|$)`, "i").test(hayNorm);
  }
  return hayNorm.includes(needle) || hayNorm.includes(raw);
}
function answerContained(compressed, answers) {
  const hay = norm(compressed);
  if (!answers || !answers.length) return null;
  const hits = [];
  for (const a of answers) {
    const needle = norm(a);
    if (!needle || needle.length < 2) continue;
    hits.push({ answer: a, kept: answerInText(hay, a) });
  }
  if (!hits.length) return null;
  const kept = hits.filter((h) => h.kept).length;
  return { kept, total: hits.length, all: kept === hits.length, any: kept > 0, hits };
}
/**
 * LongBench TriviaQA packs evidence passages into `input` and distractors into
 * `context`. Merge them and extract the trailing question so compression sees
 * the real gold evidence (not a spurious substring in distractors).
 */
function assembleSample(sample) {
  const input = String(sample.input || "");
  const context = String(sample.context || "");
  const looksPassageDump =
    /^Passage\s*:/i.test(input.trim()) ||
    (input.length > 400 && (input.match(/^Passage\s*:/gim) || []).length >= 1);
  if (!looksPassageDump) {
    return { context, query: input };
  }
  const lines = input.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const qLine = [...lines]
    .reverse()
    .find((l) => /\?\s*$/.test(l) || /^(who|what|where|when|why|which|how)\b/i.test(l));
  const query =
    qLine && qLine.length >= 8 && qLine.length < 400
      ? qLine
      : input.length > 500
        ? input.slice(-280)
        : input;
  const body = qLine ? lines.filter((l) => l !== qLine).join("\n") : input;
  return {
    context: `${body}\n\n${context}`.trim(),
    query,
  };
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
  const trivial = new Set(["yes", "no", "true", "false", "y", "n"]);
  const ctxNorm = norm(ctx);
  // Prefer a single primary gold when TriviaQA ships a huge alias list.
  let candidates = list.filter((a) => {
    const needle = norm(a);
    if (!needle || needle.length < 2) return false;
    if (trivial.has(needle.replace(/[^a-z0-9]/g, ""))) return false;
    return answerInText(ctxNorm, a);
  });
  if (candidates.length > 4) {
    candidates = [...candidates].sort((a, b) => norm(b).length - norm(a).length).slice(0, 1);
  }
  const present = candidates;
  const ans = present.length ? answerContained(compressed, present) : null;
  const dropped = ans ? ans.hits.filter((h) => !h.kept).map((h) => h.answer) : [];
  return {
    ...meta,
    query: String(q).slice(0, 180),
    answers_scored: present,
    dropped_answers: dropped,
    original_tokens: r.original_tokens,
    kept_tokens: r.kept_tokens,
    kv_savings_pct: Math.round(r.kv_savings_pct * 10) / 10,
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
  const drops = withAns.filter((r) => !r.answer_all_kept);
  return {
    n: rows.length,
    mean_cut_pct: mean(rows.map((r) => r.kv_savings_pct)),
    token_weighted_cut_pct: Math.round((1 - outTok / Math.max(inTok, 1)) * 1000) / 10,
    answer_all_kept_rate: withAns.length
      ? withAns.filter((r) => r.answer_all_kept).length / withAns.length
      : null,
    answer_drops: drops.length,
    scoreable_answers: withAns.length,
    drop_ids: drops.map((r) => ({ id: r.id, task: r.task, dropped: r.dropped_answers, query: r.query })),
    mean_latency_ms: mean(rows.map((r) => r.latency_ms)),
    total_tokens_in: inTok,
    total_tokens_out: outTok,
  };
}

// New seed on the proven LongBench task family (never used with 6161).
const NEW_LONGBENCH = [
  { file: "hotpotqa.jsonl", label: "longbench_hotpotqa" },
  { file: "2wikimqa.jsonl", label: "longbench_2wikimqa" },
  { file: "multifieldqa_en.jsonl", label: "longbench_multifieldqa_en" },
  { file: "qasper.jsonl", label: "longbench_qasper" },
];

async function main() {
  const rng = mulberry32(SEED);
  const byTask = {};
  const all = [];

  const hardPath = path.join(HELDOUT, "ood_fresh5", "hard_cases.jsonl");
  if (!fs.existsSync(hardPath)) {
    console.error("missing hard dataset — run: node scripts/build_ood_fresh5.js");
    process.exit(1);
  }
  const hardLines = fs
    .readFileSync(hardPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const hardRows = [];
  for (const s of hardLines) {
    const row = runOne(s.context || "", s.input || "", s.answers || [], {
      task: "ood_fresh5_hard",
      id: s.id || null,
    });
    hardRows.push(row);
    all.push(row);
    process.stderr.write(
      `.ood_fresh5_hard ${hardRows.length}/${hardLines.length} cut=${row.kv_savings_pct}% ans=${row.answer_all_kept} id=${row.id}\n`
    );
  }
  byTask.ood_fresh5_hard = summarize(hardRows);

  for (const t of NEW_LONGBENCH) {
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
      const assembled = assembleSample(s);
      const row = runOne(assembled.context, assembled.query, answers, {
        task: t.label,
        id: s._id || null,
      });
      rows.push(row);
      all.push(row);
      process.stderr.write(
        `.${t.label} ${rows.length}/${samples.length} cut=${row.kv_savings_pct}% ans=${row.answer_all_kept}\n`
      );
    }
    byTask[t.label] = summarize(rows);
  }

  const withAns = all.filter((r) => r.answer_all_kept != null);
  const out = {
    meta: {
      fresh5_bench: true,
      note:
        "Brand-new dataset: ood_fresh5_hard (CRDT/Wasm/Redis/GraphQL/Protobuf/Deno/RFC8259/esbuild) + LongBench hotpot/2wiki/multifield/qasper at never-used seed 6161. Primary = answer containment.",
      seed: SEED,
      per_task: PER_TASK,
      prior_real_bench_seed: 4242,
      prior_fresh4_seed: 9091,
      tuned_against_seeds: [777, 2026, 4242, 9091],
      hard_ood_path: hardPath,
    },
    gates: {},
    overall: summarize(all),
    answer_scoreable: summarize(withAns),
    by_task: byTask,
  };
  out.gates.avg_cut_ge_55 = out.overall.mean_cut_pct >= 55;
  out.gates.token_weighted_cut_ge_55 = out.overall.token_weighted_cut_pct >= 55;
  out.gates.always_answer_ge_98 =
    out.answer_scoreable.answer_all_kept_rate == null ||
    out.answer_scoreable.answer_all_kept_rate >= 0.98;
  out.gates.pass =
    out.gates.avg_cut_ge_55 &&
    out.gates.token_weighted_cut_ge_55 &&
    out.gates.always_answer_ge_98;

  const outPath = path.join(WEB, "data", "fresh5-benchmark-latest.json");
  fs.writeFileSync(outPath, JSON.stringify({ ...out, samples: all }, null, 2));
  console.log(JSON.stringify({ ...out, wrote: outPath }, null, 2));
  process.exit(out.gates.pass ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
