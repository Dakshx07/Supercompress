const fs = require("fs");
const path = require("path");
const vm = require("vm");

let engine;
let model;

function getEngine() {
  if (engine) return engine;
  const code = fs.readFileSync(path.join(__dirname, "assets", "compress-engine.js"), "utf8");
  const sandbox = { globalThis: {}, window: undefined };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  engine = sandbox.globalThis.SuperCompressEngine;
  if (!engine) throw new Error("Local compression engine failed to load");
  return engine;
}

function compress(context, query) {
  if (!model) model = JSON.parse(fs.readFileSync(path.join(__dirname, "assets", "model.json"), "utf8"));
  return getEngine().compressAdaptive(context, query, model);
}

module.exports = { compress };
