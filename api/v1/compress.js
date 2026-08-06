/**
 * POST /api/v1/compress
 * Authenticated compression endpoint.
 * Rate-limited: 120 req/min per API key + monthly plan token limit.
 */
const { json, jsonWithRateLimit, checkRateLimit, clientIp, readBody } = require("../_lib/http");
const { bearerToken } = require("../_lib/auth");
const { KEY_PREFIX } = require("../_lib/keys");
const { authenticateKey, recordUsage } = require("../_lib/firebase-key-store");
const { compress, compressAdaptive, compressCCR, storeCcrBlocks, wrapCompressedForCache } = require("../_lib/engine");
const { FREE_TOKENS_PER_MONTH, isPaygEnabled } = require("../_lib/stripe");

const V1_RPM = 120; // per API key

/**
 * Free accounts hard-stop at the monthly free allowance (5M).
 * PAYG / legacy paid plans may exceed — overage is billed via Stripe meters.
 */
function enforceUsageLimit(owner) {
  const claims = owner.customClaims || {};
  const planId = claims.sc_plan || "free";

  if (isPaygEnabled(planId)) return;

  const month = new Date().toISOString().slice(0, 7);
  const tokensUsedThisPeriod = claims.sc_usage?.month === month
    ? claims.sc_usage.tokens_in || 0
    : 0;

  if (tokensUsedThisPeriod >= FREE_TOKENS_PER_MONTH) {
    const usedM = (tokensUsedThisPeriod / 1_000_000).toFixed(1);
    const freeM = (FREE_TOKENS_PER_MONTH / 1_000_000).toFixed(0);
    const err = new Error(
      `Free monthly allowance reached (${usedM}M / ${freeM}M tokens). Enable pay-as-you-go ($1 / 1M) so compression never hard-stops: https://www.supercompress.dev/dashboard#billing`
    );
    err.status = 429;
    throw err;
  }
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (req.method !== "POST" && req.method !== "GET") return json(res, 405, { detail: "Method not allowed" });

  try {
    // Support API key from: X-API-Key header, Authorization Bearer, or ?api_key query param
    const raw = req.headers["x-api-key"]
      || bearerToken(req.headers.authorization)
      || (req.query && req.query.api_key);
    if (!raw || !raw.startsWith(KEY_PREFIX)) {
      return json(res, 401, { detail: "Missing or invalid API key" });
    }

    // ── Rate limit by key prefix ──
    const keyPrefix = raw.slice(0, 24);
    const rl = checkRateLimit(`v1:${keyPrefix}`, V1_RPM);
    if (!rl.allowed) {
      return jsonWithRateLimit(res, 429, {
        detail: `Rate limit exceeded (${V1_RPM} requests/minute per key). Reduce request frequency or contact support.`,
        retry_after_seconds: Math.max(1, Math.ceil((rl.resetMs - Date.now()) / 1000)),
      }, rl);
    }

    // Read input outside mutateStore to avoid await inside sync callback
    let context, query, mode, budgetRatio, ccr, cache_prefix, coding_agent;
    if (req.method === "GET") {
      context = (req.query && req.query.context) || "";
      query = (req.query && req.query.query) || "Summarize this context.";
      mode = (req.query && req.query.mode) || "compiler";
      budgetRatio = mode === "fixed" ? parseFloat(req.query.budget_ratio || "0.35") : 0.35;
      ccr = (req.query && req.query.ccr === "true");
      cache_prefix = (req.query && req.query.cache_prefix === "true");
      coding_agent = (req.query && req.query.coding_agent) || null;
    } else {
      const body = readBody(req);
      context = body.context || "";
      query = body.query || "Summarize this context.";
      mode = body.mode || "compiler";
      budgetRatio = mode === "fixed" ? (body.budget_ratio ?? 0.35) : 0.35;
      ccr = body.ccr === true || body.ccr === "true";
      cache_prefix = body.cache_prefix === true || body.cache_prefix === "true";
      coding_agent = body.coding_agent || null;
    }

    if (!context.trim()) {
      return json(res, 422, { detail: "context required" });
    }
    if (context.length > 120_000) {
      return json(res, 422, { detail: "context too long (120k max)" });
    }

    const authenticated = await authenticateKey(raw);
    enforceUsageLimit(authenticated.owner);

    if (mode === "fixed" && (budgetRatio < 0.05 || budgetRatio > 1)) {
      const err = new Error("invalid budget_ratio");
      err.status = 422;
      throw err;
    }

    const result = mode === "fixed"
      ? compress(context, query, budgetRatio)
      : await (ccr ? compressCCR(context, query) : compressAdaptive(context, query));
    await recordUsage(authenticated.user, authenticated.owner, result);

    // Track coding agent usage in a dedicated Firestore collection (more reliable
    // than mutating the monolithic config/store document).
    if (coding_agent) {
      try {
        const { trackCodingAgentUsage } = require("../_lib/store");
        const tokensSaved = Math.max(0, (result.original_tokens || 0) - (result.kept_tokens || 0));
        await trackCodingAgentUsage(authenticated.ownerUid, coding_agent, {
          original_tokens: result.original_tokens,
          kept_tokens: result.kept_tokens,
          tokens_saved: tokensSaved,
        });
      } catch (err) {
        console.error("Failed to track coding agent usage:", err.message);
      }
    }

    // CacheAligner: persist block-level hashes to Blob (async, after mutateStore completes)
    // The compressCCR result (compiler+CCR mode) already has [SC-Retrieve: hash] markers
    // interspersed at the exact positions where blocks were dropped. We just need to
    // persist each block's text to Blob so retrieval works across cold starts.
    // For fixed+CCR, fall back to basic full-context storage (no block markers).
    let ccrInfo = null;
    if (ccr && result.ccr) {
      // Compiler mode + CCR: compressCCR produced interspersed markers
      const { stored, stored_hashes, full_stored } = await storeCcrBlocks(result.ccr, context);
      if (stored) {
        ccrInfo = {
          hash: result.ccr.hash,
          marker_hashes: result.ccr.marker_hashes || [],
          markers_count: result.ccr.markers_count || 0,
          stored_hashes,
          full_stored,
          retrieve_url: `/retrieve?hash=${result.ccr.hash}`,
        };
      }
    } else if (ccr) {
      // Fixed mode + CCR (or any mode where compressCCR wasn't used):
      // Fall back to simple full-context storage with end-of-text marker
      const { simpleHash, ccrStoreBlob } = require("../_lib/engine");
      const ccrHash = simpleHash(context);
      const stored = await ccrStoreBlob(ccrHash, context);
      if (stored) {
        ccrInfo = {
          hash: ccrHash,
          marker_hashes: [],
          markers_count: 0,
          stored_hashes: [],
          full_stored: true,
          retrieve_url: `/retrieve?hash=${ccrHash}`,
        };
      }
    }

    // CacheAligner: optionally wrap compressed text for provider prompt/prefix
    // caching. SuperCompress does not operate inside model KV cache.
    const rawText = ccrInfo && ccrInfo.markers_count === 0
      ? result.compressed_text + `\n[SC-Retrieve: ${ccrInfo.hash}]\n`
      : result.compressed_text;
    const finalText = cache_prefix
      ? wrapCompressedForCache(rawText, query).wrapped
      : rawText;

    return jsonWithRateLimit(res, 200, {
      compressed_text: finalText,
      original_tokens: result.original_tokens,
      kept_tokens: result.kept_tokens,
      tokens_saved: result.tokens_saved ?? Math.max(0, result.original_tokens - result.kept_tokens),
      tokens_saved_pct: Math.round((result.tokens_saved_pct ?? result.kv_savings_pct ?? 0) * 100) / 100,
      // deprecated alias — same value as tokens_saved_pct
      kv_savings_pct: Math.round((result.tokens_saved_pct ?? result.kv_savings_pct ?? 0) * 100) / 100,
      kept_line_ratio: result.kept_line_ratio,
      policy_name: result.policy_name,
      mode: result.mode || "compiler",
      keep_ratio: result.keep_ratio ?? result.budget_ratio,
      answer_quality: result.answer_quality,
      important_kept_pct: result.important_kept_pct,
      critical_lines_total: result.critical_lines_total,
      critical_lines_kept: result.critical_lines_kept,
      critical_lines_dropped: result.critical_lines_dropped,
      compression_risk: result.compression_risk,
      verifier: result.verifier,
      kept_blocks: result.kept_blocks,
      dropped_blocks: result.dropped_blocks,
      cache_prefix_applied: cache_prefix || false,
      ccr: ccrInfo,
    }, rl);
  } catch (err) {
    console.error("compress error", err);
    return json(res, err.status || 500, { detail: err.message || String(err) });
  }
};
