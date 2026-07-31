#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const { execFileSync, spawn } = require("child_process");
const os = require("os");
const path = require("path");

const PACKAGE_ROOT = path.resolve(__dirname, "..");

function request(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: "127.0.0.1", port, path: requestPath }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on("error", reject);
    req.setTimeout(2000, () => req.destroy(new Error("request timeout")));
  });
}

async function waitForHealth(child, port, getStderr) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await request(port, "/health");
      if (response.status === 200) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`proxy did not become healthy\n${getStderr()}`);
}

function detectorMatrix() {
  const detectorPath = path.join(PACKAGE_ROOT, "src/detector.js");
  delete require.cache[require.resolve(detectorPath)];

  const home = fs.mkdtempSync(path.join(os.tmpdir(), "supercompress-agents-"));
  const originalHome = os.homedir;
  const originalShell = process.env.SHELL;
  const originalConfigDir = process.env.SUPERCOMPRESS_CONFIG_DIR;
  os.homedir = () => home;
  process.env.SHELL = "/bin/bash";
  process.env.SUPERCOMPRESS_CONFIG_DIR = path.join(home, ".supercompress");

  const fixtures = {
    Cursor: [".cursor/config.json", '{"theme":"dark"}'],
    Windsurf: [".windsurf/config.json", '{"model":"x"}'],
    Continue: [".continue/config.json", '{"models":[]}'],
    Cline: [".cline/config.json", '{"apiProvider":"anthropic"}'],
    "Claude Code": [".claude/settings.json", '{"env":{"FOO":"bar"}}'],
    Codex: [".codex/config.toml", 'model = "gpt-5"\n'],
    Aider: [".config/aider/conf.yml", "model: gpt-4o\n"],
  };

  try {
    for (const [name, [relativePath, content]] of Object.entries(fixtures)) {
      const filePath = path.join(home, relativePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content);
    }

    const detector = require(detectorPath);
    assert.ok(detector.AGENT_CATALOG.length >= 40, "agent catalog should cover at least 40 integrations");
    assert.equal(new Set(detector.AGENT_CATALOG.map((agent) => agent.name)).size, detector.AGENT_CATALOG.length, "agent catalog has duplicate names");
    const detectedNames = detector.detectAll().map((agent) => agent.name);
    for (const name of Object.keys(fixtures)) assert.ok(detectedNames.includes(name), `${name} was not detected`);
    const originals = Object.fromEntries(Object.entries(fixtures).map(([name, [relativePath]]) => [
      name,
      fs.readFileSync(path.join(home, relativePath), "utf8"),
    ]));
    const configured = detector.configureAll();
    assert.deepEqual(configured, ["Cursor", "Windsurf", "Continue", "Cline", "Claude Code", "Codex"]);
    detector.configureMcp();
    detector.revertAll();

    for (const [name, [relativePath]] of Object.entries(fixtures)) {
      assert.equal(fs.readFileSync(path.join(home, relativePath), "utf8"), originals[name], `${name} config was not restored exactly`);
    }
  } finally {
    os.homedir = originalHome;
    if (originalShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = originalShell;
    if (originalConfigDir === undefined) delete process.env.SUPERCOMPRESS_CONFIG_DIR;
    else process.env.SUPERCOMPRESS_CONFIG_DIR = originalConfigDir;
    delete require.cache[require.resolve(detectorPath)];
    fs.rmSync(home, { recursive: true, force: true });
  }
}

async function main() {
  const help = execFileSync(process.execPath, ["bin/supercompress.js", "help"], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
  });
  assert.match(help, /supercompress <command>/i);
  assert.match(help, /setup/);

  const localEngine = require(path.join(PACKAGE_ROOT, "src/local-engine"));
  const context = Array.from({ length: 80 }, (_, index) =>
    `Relevant implementation detail ${index}: the compressor preserves query-critical evidence.`
  ).join("\n");
  const compressed = localEngine.compress(context, "What does the compressor preserve?");
  assert.ok(compressed);
  assert.equal(typeof compressed.compressed_text, "string");
  detectorMatrix();

  const port = 18765;
  const child = spawn(process.execPath, ["src/server.js", String(port)], {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, SUPERCOMPRESS_CONFIG_DIR: path.join(__dirname, ".tmp-config") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  try {
    const health = await waitForHealth(child, port, () => stderr);
    assert.equal(health.body.service, "supercompress");
    assert.equal(health.body.status, "ok");

    const models = await request(port, "/v1/models");
    assert.equal(models.status, 200);
    assert.ok(Array.isArray(models.body.data));
    assert.ok(models.body.data.some((model) => model.id === "gpt-4o-mini"));
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
  console.log("proxy smoke tests passed");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
