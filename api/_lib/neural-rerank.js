/**
 * Hosted neural block reranker — BGE cross-encoder via Transformers.js (ONNX).
 *
 * Default: onnx-community/bge-reranker-v2-m3-ONNX (~568M, q8 ~0.5–1.1GB).
 * Scores query–block pairs with raw logits → sigmoid.
 *
 * Env:
 *   SC_NEURAL=0              disable
 *   SC_RERANKER_MODEL        HF id (default onnx-community/bge-reranker-v2-m3-ONNX)
 *   SC_RERANKER_DTYPE        q8 | int8 | q4 | fp32 | … (default q8)
 *   SC_RERANKER_MAX_BLOCKS   max blocks to score (default 128)
 *   SC_MODEL_DIR             cache root (default <repo>/models, /tmp on Vercel)
 */

const path = require("path");
const fs = require("fs");

const DEFAULT_MODEL =
  process.env.SC_RERANKER_MODEL || "onnx-community/bge-reranker-v2-m3-ONNX";
const MODEL_DIR =
  process.env.SC_MODEL_DIR ||
  process.env.TRANSFORMERS_CACHE ||
  (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
    ? path.join("/tmp", "sc-models")
    : path.join(__dirname, "..", "..", "models"));

let sessionPromise = null;
let unavailableReason = null;

/** HF hub cache layout: org/name → org/name under MODEL_DIR */
function modelCachePath(modelId = DEFAULT_MODEL) {
  const parts = String(modelId).split("/").filter(Boolean);
  return path.join(MODEL_DIR, ...parts);
}

function neuralEnabled() {
  if (process.env.SC_NEURAL === "0" || process.env.SC_NEURAL === "false") return false;
  if (unavailableReason) return false;
  if (process.env.SC_NEURAL === "1" || process.env.SC_NEURAL === "true") return true;
  // Auto-enable when configured model (or legacy base) is already cached.
  if (fs.existsSync(modelCachePath(DEFAULT_MODEL))) return true;
  if (fs.existsSync(path.join(MODEL_DIR, "Xenova", "bge-reranker-base"))) return true;
  // Vercel cold-start download of ~1GB is too heavy unless explicitly enabled.
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) return false;
  return true;
}

function ensureCacheDir() {
  fs.mkdirSync(MODEL_DIR, { recursive: true });
  process.env.TRANSFORMERS_CACHE = MODEL_DIR;
  process.env.HF_HOME = MODEL_DIR;
}

function sigmoid(x) {
  if (x >= 20) return 1;
  if (x <= -20) return 0;
  return 1 / (1 + Math.exp(-x));
}

async function getSession() {
  if (!neuralEnabled()) return null;
  if (sessionPromise) return sessionPromise;

  sessionPromise = (async () => {
    ensureCacheDir();
    let transformers;
    try {
      transformers = require("@huggingface/transformers");
    } catch (err) {
      try {
        transformers = require("@xenova/transformers");
      } catch (err2) {
        unavailableReason = `transformers.js not installed: ${err2.message}`;
        console.warn(`[supercompress-neural] ${unavailableReason}`);
        return null;
      }
    }

    const { AutoTokenizer, AutoModelForSequenceClassification, env } = transformers;
    if (env) {
      env.cacheDir = MODEL_DIR;
      env.allowLocalModels = true;
      if (env.backends?.onnx?.wasm) {
        env.backends.onnx.wasm.numThreads = 1;
      }
    }

    const dtype = process.env.SC_RERANKER_DTYPE || "q8";
    console.log(`[supercompress-neural] loading ${DEFAULT_MODEL} (dtype=${dtype}) → ${MODEL_DIR}`);
    try {
      const tokenizer = await AutoTokenizer.from_pretrained(DEFAULT_MODEL);
      let model;
      try {
        model = await AutoModelForSequenceClassification.from_pretrained(DEFAULT_MODEL, { dtype });
      } catch {
        try {
          model = await AutoModelForSequenceClassification.from_pretrained(DEFAULT_MODEL, {
            dtype: "int8",
          });
        } catch {
          model = await AutoModelForSequenceClassification.from_pretrained(DEFAULT_MODEL, {
            quantized: true,
          });
        }
      }
      console.log(`[supercompress-neural] ready: ${DEFAULT_MODEL}`);
      return { tokenizer, model };
    } catch (err) {
      unavailableReason = err.message;
      console.warn(`[supercompress-neural] load failed: ${unavailableReason}`);
      return null;
    }
  })();

  return sessionPromise;
}

async function scoreOne(session, query, passage) {
  const q = String(query || "").slice(0, 512);
  const p = String(passage || "").slice(0, 1200);
  const inputs = await session.tokenizer(q, {
    text_pair: p,
    padding: true,
    truncation: true,
  });
  const out = await session.model(inputs);
  const logits = out.logits?.data || out.logits;
  const arr = Array.from(logits || [0]);
  // BGE reranker is a single-logit relevance head
  return sigmoid(arr[0] || 0);
}

/**
 * Score (query, passage) pairs. Returns [0,1] relevance.
 */
function minMaxNormalize(scores) {
  if (!scores.length) return scores;
  let min = Infinity;
  let max = -Infinity;
  for (const s of scores) {
    if (s < min) min = s;
    if (s > max) max = s;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-9) {
    return scores.map(() => 0.5);
  }
  return scores.map((s) => (s - min) / (max - min));
}

async function scorePairs(query, passages, { normalize = true } = {}) {
  const session = await getSession();
  if (!session || !passages.length) return passages.map(() => 0);

  const scores = new Array(passages.length).fill(0);
  // Sequential on Air — wasm ONNX is memory-sensitive under parallel load
  for (let i = 0; i < passages.length; i++) {
    try {
      scores[i] = await scoreOne(session, query, passages[i]);
    } catch {
      scores[i] = 0;
    }
  }
  return normalize ? minMaxNormalize(scores) : scores;
}

function queryTermsLight(query) {
  return String(query || "")
    .split(/[^A-Za-z0-9']+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4)
    .slice(0, 24);
}

async function scoreBlocks(query, blocks) {
  if (!neuralEnabled() || !blocks || !blocks.length) return null;
  const maxBlocks = Math.max(8, parseInt(process.env.SC_RERANKER_MAX_BLOCKS || "128", 10) || 128);
  const terms = queryTermsLight(query);
  const scored = blocks.map((b, idx) => {
    const text = String(b.text || "");
    const len = text.length;
    const lower = text.toLowerCase();
    let overlap = 0;
    for (const t of terms) if (lower.includes(t.toLowerCase())) overlap += 1;
    // Prefer query-overlapping + mid-size evidence over raw length (short answer spans matter)
    const priority =
      overlap * 5000 +
      Math.min(len, 800) +
      (/\b(born|died|father|mother|played|portrayed|president|lifespan|disease|attended|institute)\b/i.test(
        text
      )
        ? 1200
        : 0);
    return { b, idx, len, overlap, priority };
  });

  const picked = new Map();
  const take = (arr, limit) => {
    const cap = limit == null ? maxBlocks : Math.min(limit, maxBlocks);
    for (const c of arr) {
      if (picked.size >= cap) break;
      const id = c.b.id != null ? c.b.id : c.idx;
      if (picked.has(id)) continue;
      if (c.len < 24) continue;
      picked.set(id, c);
    }
  };

  // Reserve ~25% of slots for low-overlap / mid-corpus bridges (multi-hop hop-1).
  const bridgeBudget = Math.max(4, Math.floor(maxBlocks * 0.25));
  const primaryBudget = Math.max(8, maxBlocks - bridgeBudget);

  // 1) strong query overlap first
  take(
    scored.filter((c) => c.overlap > 0).sort((a, b) => b.priority - a.priority),
    primaryBudget
  );
  // 2) role/evidence language
  take(
    scored
      .filter((c) =>
        /\b(born|died|father|played|portrayed|president|lifespan|disease|attended|institute|married|founded)\b/i.test(
          c.b.text || ""
        )
      )
      .sort((a, b) => b.priority - a.priority),
    primaryBudget
  );
  // 3) fill remaining primary by priority
  take(
    scored.slice().sort((a, b) => b.priority - a.priority),
    primaryBudget
  );

  // 4) low-overlap mid-corpus fill — hop-1 bridges often have zero query terms
  const lowOverlap = scored
    .filter((c) => c.overlap === 0 && c.len >= 40)
    .sort((a, b) => {
      // Prefer mid-document position + relational language over raw length
      const aRel = /\b(born|died|father|mother|played|portrayed|president|attended|married|painted|voice|retriever|commission)\b/i.test(
        a.b.text || ""
      )
        ? 1
        : 0;
      const bRel = /\b(born|died|father|mother|played|portrayed|president|attended|married|painted|voice|retriever|commission)\b/i.test(
        b.b.text || ""
      )
        ? 1
        : 0;
      if (bRel !== aRel) return bRel - aRel;
      const aMid = 1 - Math.abs(a.idx / Math.max(blocks.length - 1, 1) - 0.45);
      const bMid = 1 - Math.abs(b.idx / Math.max(blocks.length - 1, 1) - 0.45);
      return bMid - aMid || b.priority - a.priority;
    });
  take(lowOverlap, maxBlocks);

  // 5) final fill if still under budget
  take(scored.slice().sort((a, b) => b.priority - a.priority), maxBlocks);

  const candidates = [...picked.values()];
  if (!candidates.length) return null;

  // Do not emit an all-zero Map when the ONNX session is unavailable — that
  // falsely enables the neural path and then disables further attempts via
  // unavailableReason, leaving later samples without real scores.
  const session = await getSession();
  if (!session) return null;

  const passages = candidates.map((c) => c.b.text);
  const scores = await scorePairs(query, passages);
  const boost = new Map();
  candidates.forEach((c, i) => {
    const id = c.b.id != null ? c.b.id : c.idx;
    boost.set(id, scores[i] || 0);
  });
  return boost;
}

async function warmup() {
  if (!neuralEnabled()) return { ok: false, reason: unavailableReason || "disabled" };
  const session = await getSession();
  if (!session) return { ok: false, reason: unavailableReason || "unavailable" };
  const s = await scorePairs("warmup", ["neural reranker ready"]);
  return { ok: true, model: DEFAULT_MODEL, cache: MODEL_DIR, sample: s[0] };
}

module.exports = {
  neuralEnabled,
  getSession,
  scorePairs,
  scoreBlocks,
  warmup,
  modelCachePath,
  DEFAULT_MODEL,
  MODEL_DIR,
};
