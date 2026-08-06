/**
 * Shared neural boost loader for benchmark scripts.
 * When SC_NEURAL=0 or the model is unavailable, returns null (heuristic path).
 */
const path = require("path");
const fs = require("fs");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..");
const WEB = path.join(ROOT, "web", "assets");

let engine = null;
let model = null;
let neuralMod = null;

function getEngine() {
  if (engine) return engine;
  const sandbox = { globalThis: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(WEB, "js", "compress-engine.js"), "utf8"), sandbox);
  engine = sandbox.globalThis.SuperCompressEngine;
  return engine;
}

function getModel() {
  if (model) return model;
  model = JSON.parse(fs.readFileSync(path.join(WEB, "data", "model.json"), "utf8"));
  return model;
}

function getNeural() {
  if (neuralMod) return neuralMod;
  try {
    neuralMod = require(path.join(ROOT, "api", "_lib", "neural-rerank"));
  } catch {
    neuralMod = null;
  }
  return neuralMod;
}

async function loadNeuralBoost(context, query) {
  const neural = getNeural();
  if (!neural || !neural.neuralEnabled()) return null;
  const E = getEngine();
  if (typeof E.prepareNeuralBlocks !== "function") return null;
  const prep = E.prepareNeuralBlocks(context, query, getModel());
  if (!prep.blocks || !prep.blocks.length) return null;
  try {
    return await neural.scoreBlocks(prep.question || query, prep.blocks);
  } catch (err) {
    console.warn("[bench-neural] scoreBlocks failed:", err.message);
    return null;
  }
}

/**
 * compressAdaptive with neural when available.
 */
async function compressAdaptiveNeural(context, query, modelOverride = null) {
  const E = getEngine();
  const m = modelOverride || getModel();
  const neuralBoost = await loadNeuralBoost(context, query);
  return E.compressAdaptive(context, query, m, neuralBoost ? { neuralBoost } : null);
}

module.exports = {
  getEngine,
  getModel,
  loadNeuralBoost,
  compressAdaptiveNeural,
};
