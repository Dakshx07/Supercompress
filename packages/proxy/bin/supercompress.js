#!/usr/bin/env node

/**
 * SuperCompress Proxy — CLI entry point
 *
 * Commands:
 *   setup     One-time setup: account link, agent detection, service registration
 *   start     Start the background proxy
 *   stop      Stop the background proxy
 *   status    Check if the proxy is running
 *   uninstall Remove the proxy and revert agent configs
 */

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const http = require("http");
const crypto = require("crypto");
const VERSION = require("../package.json").version;
const USAGE_URL = process.env.SUPERCOMPRESS_USAGE_URL || "https://www.supercompress.dev/api/usage";

const CONFIG_DIR = process.env.SUPERCOMPRESS_CONFIG_DIR || path.join(require("os").homedir(), ".supercompress");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const PID_PATH = path.join(CONFIG_DIR, "proxy.pid");
const LOG_PATH = path.join(CONFIG_DIR, "proxy.log");

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    }
  } catch {}
  return null;
}

function saveConfig(config) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function printLogo() {
  console.log("");
  console.log("  ╔══════════════════════════════════════╗");
  console.log(`  ║         SuperCompress v${VERSION.padEnd(8)}       ║`);
  console.log("  ║   Cut your coding agent costs ~65%   ║");
  console.log("  ╚══════════════════════════════════════╝");
  console.log("");
}

function printHelp() {
  console.log("Usage: supercompress <command>");
  console.log("");
  console.log("  Commands:");
  console.log("  setup       One-time setup — account link, auto-detect agents, MCP plugin, optional proxy");
  console.log("  plugin      Detect coding agents and install the SuperCompress MCP plugin (subscription-safe)");
  console.log("  connect     Link this install to your SuperCompress account");
  console.log("  start       Start the proxy server (if not running)");
  console.log("  stop        Stop the proxy server");
  console.log("  status      Check if the proxy is running");
  console.log("  agents      Show supported agents and detected integrations");
  console.log("  restart     Restart the proxy server");
  console.log("  uninstall   Remove proxy and revert all agent configs");
  console.log("");
  console.log("Examples:");
  console.log("  supercompress plugin");
  console.log("  supercompress setup");
  console.log("  supercompress status");
}

async function connectAccount() {
  const code = crypto.randomBytes(4).toString("hex");
  const connectUrl = `https://supercompress.dev/dashboard?connect=${code}&source=cli`;
  const openCommand = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try { require("child_process").execFileSync(openCommand, [connectUrl], { stdio: "ignore" }); } catch {}
  console.log(`  → Finish sign-in in the browser to link this install.`);
  console.log(`  → Connection code: ${code}`);
  const apiKey = await waitForDeviceConnect(code);
  const config = loadConfig() || {};
  saveConfig({ ...config, api_key: apiKey, connected_at: new Date().toISOString() });
  console.log("  ✓ SuperCompress account connected. No raw API key needed.");
}

async function main() {
  const cmd = process.argv[2] || "help";

  printLogo();

  switch (cmd) {
    case "connect":
      try { await connectAccount(); } catch (err) { console.error(`  ✗ ${err.message}`); process.exit(1); }
      break;
    case "plugin": {
      const detector = require("../src/detector");
      const found = detector.detectAll();
      console.log(`  Detected ${found.length} coding agent(s):`);
      for (const agent of found) {
        console.log(`    ✓ ${agent.name}`);
      }
      const mcpConfigured = detector.configureMcp();
      const rulePath = detector.writeCursorRule();
      const hooks = detector.writeCursorHooks();
      const agentHooks = detector.writeAgentPromptHooks();
      const cleared = detector.clearProxyOverrides();
      if (mcpConfigured.length) {
        console.log(`  ✓ MCP plugin installed for: ${mcpConfigured.join(", ")}`);
      } else {
        console.log("  ○ No MCP-capable agent configs found to update.");
      }
      console.log(`  ✓ Cursor rule written: ${rulePath}`);
      console.log(`  ✓ Cursor hooks written: ${hooks.hooksPath}`);
      console.log("    → beforeSubmitPrompt compresses EVERY user message → ~/.supercompress/inbox/");
      console.log("    → postToolUse auto-compresses large tool dumps");
      console.log("    → sessionStart injects every-message policy");
      if (agentHooks.installed.length) {
        console.log(`  ✓ Every-message prompt hooks: ${agentHooks.installed.join(", ")}`);
      }
      if (cleared.length) {
        console.log(`  ✓ Cleared provider API-key proxy overrides: ${cleared.join(", ")}`);
      }
      console.log("  → Restart Cursor / Claude / Codex so hooks reload.");
      break;
    }
    case "setup":
      await require("../src/setup")({ CONFIG_DIR, CONFIG_PATH, PID_PATH, LOG_PATH, loadConfig, saveConfig });
      break;

    case "start": {
      const config = loadConfig();
      if (!config || !config.api_key) {
        console.log("  ✗ Not configured. Run `supercompress setup` first.");
        process.exit(1);
      }
      // A launchd/systemd-managed proxy does not create our PID file. The
      // health endpoint is the source of truth for both managed and manual runs.
      if (await isHealthy(config.port || 8080)) {
        console.log("  ✓ Proxy is already running on port " + (config.port || 8080));
        return;
      }
      if (isRunning()) stopServer();
      await startServer(config);
      break;
    }

    case "stop":
      stopServer();
      break;

    case "status": {
      const config = loadConfig();
      if (!config) {
        console.log("  ○ Not configured. Run `supercompress setup` first.");
        return;
      }
      const port = config.port || 8080;
      const running = await isHealthy(port);
      if (running) {
        console.log(`  ✓ Proxy is RUNNING on localhost:${port}`);
        const agents = config.configured_agents || [];
        if (agents.length > 0) {
          console.log(`  → Configured for: ${agents.join(", ")}`);
        }
        await printUsageSummary(config.api_key).catch((err) => {
          console.log(`  → Usage summary unavailable: ${err.message}`);
        });
      } else {
        console.log(`  ○ Proxy is STOPPED (configured for localhost:${port})`);
        console.log("  → Run `supercompress setup` to reconnect and start it, or `supercompress start` to restart manually.");
      }
      break;
    }

    case "agents": {
      const { AGENT_CATALOG, detectAll } = require("../src/detector");
      const detected = new Map(detectAll().map((agent) => [agent.name, agent]));
      console.log(`  Supported coding agents (${AGENT_CATALOG.length} catalogued):`);
      for (const agent of AGENT_CATALOG) {
        const state = detected.get(agent.name);
        console.log(`    ${state ? "✓" : "·"} ${agent.name}${state ? ` — ${state.autoConfigurable ? "detected and configurable" : "detected; manual setup"}` : " — not detected"}`);
      }
      console.log("    ✓ Any new MCP-compatible client — use `supercompress-mcp`");
      console.log("\n  New or unlisted agent:");
      console.log("    Point its OpenAI-compatible base URL to http://localhost:8080/v1");
      console.log("    Or point its Anthropic-compatible base URL to http://localhost:8080");
      console.log("    Then run `supercompress status` to verify the proxy.");
      console.log("\n  Limits and upgrade status: run `supercompress status`.");
      break;
    }

    case "restart":
      stopServer();
      await new Promise((r) => setTimeout(r, 500));
      const cfg = loadConfig();
      if (cfg) await startServer(cfg);
      break;

    case "uninstall": {
      console.log("  → Stopping proxy...");
      stopServer();
      require("../src/service").unregister();
      console.log("  → Reverting agent configurations...");
      const { revertAll, removeMcp } = require("../src/detector");
      const undone = revertAll();
      undone.forEach((a) => console.log(`  → Reverted ${a}`));
      removeMcp().forEach((a) => console.log(`  → Removed ${a} MCP registration`));
      // Remove config dir
      if (fs.existsSync(CONFIG_DIR)) {
        fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
      }
      console.log("  ✓ SuperCompress uninstalled.");
      break;
    }

    case "help":
    default:
      printHelp();
      break;
  }
}

function isRunning() {
  try {
    if (fs.existsSync(PID_PATH)) {
      const pid = parseInt(fs.readFileSync(PID_PATH, "utf8").trim(), 10);
      // A PID alone is not enough: stale PID files can point at another process.
      process.kill(pid, 0);
      return true;
    }
  } catch {
    // stale PID
    try { fs.unlinkSync(PID_PATH); } catch {}
  }
  return false;
}

function waitForHealth(port, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const request = http.get({ hostname: "127.0.0.1", port, path: "/health", timeout: 800 }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              const parsed = JSON.parse(body);
              if (parsed.status === "ok" && parsed.service === "supercompress") return resolve(parsed);
            } catch {}
          }
          retry();
        });
      });
      request.on("error", retry);
      request.on("timeout", () => request.destroy());
    };
    const retry = () => {
      if (Date.now() - started >= timeoutMs) {
        reject(new Error(`Proxy did not become healthy on localhost:${port}`));
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

async function isHealthy(port) {
  try {
    await waitForHealth(port, 700);
    return true;
  } catch {
    return false;
  }
}

async function startServer(config) {
  const serverPath = path.join(__dirname, "..", "src", "server.js");
  const port = config.port || 8080;
  const logPath = path.join(CONFIG_DIR, "proxy.log");
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const logFd = fs.openSync(logPath, "a");
  const child = spawn("node", [serverPath, String(port)], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      SUPERCOMPRESS_API_KEY: config.api_key,
      SUPERCOMPRESS_CONFIG_DIR: CONFIG_DIR,
    },
  });
  child.on("close", () => {
    try { fs.closeSync(logFd); } catch {}
  });

  fs.writeFileSync(PID_PATH, String(child.pid));

  child.unref();

  try {
    await waitForHealth(port);
  } catch (err) {
    try { process.kill(child.pid, "SIGTERM"); } catch {}
    try { fs.unlinkSync(PID_PATH); } catch {}
    throw err;
  }

  console.log(`  ✓ Proxy is healthy on localhost:${port} (PID ${child.pid})`);
  console.log(`  → Configure your coding agents to use: http://localhost:${port}/v1`);
  console.log("  → Run `supercompress status` to check.");
}

function stopServer() {
  try {
    if (fs.existsSync(PID_PATH)) {
      const pid = parseInt(fs.readFileSync(PID_PATH, "utf8").trim(), 10);
      try {
        process.kill(pid, "SIGTERM");
        console.log("  ✓ Proxy stopped.");
      } catch {}
      try { fs.unlinkSync(PID_PATH); } catch {}
    }
  } catch {}
}

async function printUsageSummary(apiKey) {
  if (!apiKey) {
    console.log("  → No linked account found; usage summary unavailable.");
    return;
  }

  const response = await fetch(USAGE_URL, {
    method: "GET",
    headers: { "X-API-Key": apiKey },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || `HTTP ${response.status}`);
  }

  printPlanStatus(data);
  console.log(`  → Saved ${formatNum(data.total_tokens_saved || 0)} tokens across ${Object.keys(data.coding_agent_usage || {}).length} coding agents`);
  const entries = Object.entries(data.coding_agent_usage || {});
  if (!entries.length) {
    console.log("  → No per-agent usage yet.");
    return;
  }
  for (const [agent, snap] of entries) {
    console.log(
      `    • ${agent}: ${formatNum(snap.tokens_saved || 0)} saved, ${snap.requests || 0} requests, ${formatNum(snap.tokens_in || 0)} in → ${formatNum(snap.tokens_out || 0)} out`
    );
  }
}

function printPlanStatus(data) {
  if (!data.plan_name) return;
  if (data.unlimited) {
    console.log(`  → Plan: ${data.plan_name} (unlimited usage)`);
    return;
  }

  const used = formatNum(data.tokens_used_this_period || 0);
  const limit = formatNum(data.tokens_per_month || 0);
  const pct = Number(data.usage_pct || 0).toFixed(data.usage_pct % 1 ? 1 : 0);
  console.log(`  → Plan: ${data.plan_name} — ${used} / ${limit} tokens used (${pct}%)`);
  if (data.limit_reached || data.tokens_remaining === 0) {
    console.log(`  ⚠ Monthly limit reached. Upgrade to keep compressing: ${data.upgrade_url || "https://supercompress.dev/dashboard#billing"}`);
  } else if (Number(data.usage_pct || 0) >= 80) {
    console.log(`  ⚠ ${formatNum(data.tokens_remaining)} tokens remaining this period. Upgrade before you run out: ${data.upgrade_url || "https://supercompress.dev/dashboard#billing"}`);
  }
}

function formatNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

async function waitForDeviceConnect(code, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`https://www.supercompress.dev/api/connect-device?code=${encodeURIComponent(code)}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.status === "linked" && data.secret) {
      return data.secret;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Timed out waiting for browser sign-in. Re-run `supercompress setup`.");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
