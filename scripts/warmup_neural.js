#!/usr/bin/env node
/** Pre-download / verify the hosted BGE v2-m3 reranker into ./models */
const path = require("path");
process.env.SC_MODEL_DIR = process.env.SC_MODEL_DIR || path.join(__dirname, "..", "models");
process.env.SC_NEURAL = process.env.SC_NEURAL || "1";

const neural = require("../api/_lib/neural-rerank");

(async () => {
  console.log("model:", neural.DEFAULT_MODEL);
  console.log("cache:", neural.MODEL_DIR);
  const r = await neural.warmup();
  console.log(r);
  if (!r.ok) process.exit(1);
  const scores = await neural.scorePairs("auth timeout root cause", [
    "JWT expired after 15m in auth middleware → 401",
    "Footer copyright 2024 all rights reserved",
  ]);
  console.log("rank check:", scores);
  process.exit(scores[0] >= scores[1] ? 0 : 2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
