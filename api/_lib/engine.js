/**
 * Server-side compression — reuses web/assets/js/compress-engine.js + model.json.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

let engine = null;
let model = null;

function projectRoot() {
  return path.join(__dirname, "..", "..");
}

function readAsset(localName, webRelPath) {
  const local = path.join(__dirname, localName);
  if (fs.existsSync(local)) return fs.readFileSync(local, "utf8");
  return fs.readFileSync(path.join(projectRoot(), "web/assets", webRelPath), "utf8");
}

function getEngine() {
  if (engine) return engine;

  const code = readAsset("compress-engine.js", "js/compress-engine.js");
  const sandbox = { globalThis: {}, window: undefined };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  engine = sandbox.globalThis.SuperCompressEngine;
  if (!engine) throw new Error("Failed to load SuperCompressEngine");
  return engine;
}

function getModel() {
  if (model) return model;
  model = JSON.parse(readAsset("model.json", "data/model.json"));
  return model;
}

function compress(context, query, budgetRatio = 0.35) {
  const E = getEngine();
  return E.compressContext(context, query, budgetRatio, "SuperCompress", getModel());
}

function compressAdaptive(context, query) {
  const E = getEngine();
  return E.compressAdaptive(context, query, getModel());
}

/**
 * CCR compression: uses the browser engine's compressCCR which properly intersperses
 * [SC-Retrieve: hash] markers at the exact positions where blocks were dropped.
 *
 * This is the CacheAligner path — aligns server-side CCR behavior with browser-side CCR.
 */
function compressCCR(context, query) {
  const E = getEngine();
  return E.compressCCR(context, query, getModel(), { enableMarkers: true });
}

/**
 * Simple hash function — MUST match web/assets/js/compress-engine.js simpleHash exactly.
 * If the two diverge, client-side hashes won't match server-side hashes and CCR retrieval will fail.
 */
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h = ((h << 5) - h) + c;
    h = h & h;
  }
  return Math.abs(h).toString(16).padStart(8, '0') + '_' + str.length.toString(16);
}

/**
 * Store CCR data to Firestore for retrieval.
 */
async function ccrStoreFirestore(hash, originalText) {
  try {
    const admin = require("firebase-admin");
    const { initFirebaseAdmin } = require("./auth");
    initFirebaseAdmin();
    await admin.firestore().doc(`ccr/${hash}`).set({
      original: originalText,
      hash,
      stored_at: new Date().toISOString(),
      token_count: originalText.split(/\s+/).length,
    });
    return true;
  } catch (err) {
    console.error("CCR store failed:", err.message);
    return false;
  }
}

async function storeCcrBlocks(ccr, fullText) {
  const hashes = Array.isArray(ccr?.marker_hashes) ? ccr.marker_hashes : [];
  const storedHashes = [];
  const E = getEngine();

  for (const hash of hashes) {
    const original = E.ccrRetrieve(hash);
    if (original && await ccrStoreFirestore(hash, original)) storedHashes.push(hash);
  }

  const fullStored = Boolean(ccr?.hash) && await ccrStoreFirestore(ccr.hash, fullText);
  return {
    stored: fullStored || storedHashes.length > 0,
    stored_hashes: storedHashes,
    full_stored: fullStored,
  };
}

/**
 * CacheAligner: wrap compressed text in a stable XML preamble/postamble
 * to maximize KV cache hits on the provider side (OpenAI, Anthropic, vLLM).
 *
 * The preamble is byte-for-byte identical across all calls, creating a
 * cacheable prefix that providers can reuse without recomputation.
 *
 * @param {string} compressedText
 * @param {string} query
 * @param {{ addAnthropicMarkers?: boolean }} [options]
 * @returns {{ wrapped: string, preambleTokens: number, totalTokens: number }}
 */
function wrapCompressedForCache(compressedText, query) {
  const E = getEngine();
  return E.cacheWrap(compressedText, query);
}

module.exports = { compress, compressAdaptive, compressCCR, getEngine, getModel, simpleHash,  ccrStoreFirestore, storeCcrBlocks, wrapCompressedForCache };
