/**
 * Headroom-style agent wrap: start the local compress proxy, then launch the
 * agent with base-URL env so EVERY request is auto-compressed.
 *
 * Usage: supercompress wrap <agent> [-- ...]
 * Agents: claude | codex | aider | opencode | gemini | goose | crush | pi | vibe
 */

const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

const PORT = Number(process.env.SUPERCOMPRESS_PORT || 8080);
const OPENAI = `http://127.0.0.1:${PORT}/v1`;
const ANTHROPIC = `http://127.0.0.1:${PORT}`;

const AGENTS = {
  claude: {
    bin: "claude",
    env: { ANTHROPIC_BASE_URL: ANTHROPIC },
    note: "Claude Code via Anthropic-compatible proxy (auto-compress all traffic).",
  },
  codex: {
    bin: "codex",
    env: {
      OPENAI_BASE_URL: OPENAI,
      OPENAI_API_BASE: OPENAI,
    },
    note: "Codex via OpenAI-compatible proxy. ChatGPT-login sessions may ignore base URL — use MCP + hooks from `supercompress plugin` too.",
  },
  aider: {
    bin: "aider",
    env: {
      OPENAI_API_BASE: OPENAI,
      OPENAI_BASE_URL: OPENAI,
    },
    argsPrefix: ["--openai-api-base", OPENAI],
    note: "Aider with OpenAI-compatible proxy.",
  },
  opencode: {
    bin: "opencode",
    env: {
      OPENAI_BASE_URL: OPENAI,
      ANTHROPIC_BASE_URL: ANTHROPIC,
    },
    note: "OpenCode via proxy env. Also install MCP with `supercompress plugin`.",
  },
  gemini: {
    bin: "gemini",
    env: {
      OPENAI_BASE_URL: OPENAI,
      GOOGLE_GEMINI_BASE_URL: OPENAI,
    },
    note: "Gemini CLI via OpenAI-compatible proxy when supported.",
  },
  goose: {
    bin: "goose",
    env: {
      OPENAI_HOST: OPENAI,
      OPENAI_BASE_URL: OPENAI,
    },
    note: "Goose via OpenAI-compatible proxy.",
  },
  crush: {
    bin: "crush",
    env: { OPENAI_BASE_URL: OPENAI, ANTHROPIC_BASE_URL: ANTHROPIC },
    note: "Crush via proxy env.",
  },
  pi: {
    bin: "pi",
    env: { OPENAI_BASE_URL: OPENAI, ANTHROPIC_BASE_URL: ANTHROPIC },
    note: "Pi via proxy env.",
  },
  vibe: {
    bin: "vibe",
    env: { OPENAI_BASE_URL: OPENAI, ANTHROPIC_BASE_URL: ANTHROPIC },
    note: "Mistral Vibe via proxy env.",
  },
  cursor: {
    bin: null,
    env: {},
    note:
      "Cursor is GUI — proxy base URL is optional. For subscription-safe auto, use `supercompress plugin` (MCP + hooks). To force proxy: Settings → Models → OpenAI Base URL = " +
      OPENAI,
  },
};

function waitForHealth(port, ms = 15000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ hostname: "127.0.0.1", port, path: "/health", timeout: 800 }, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on("error", retry);
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - started > ms) return reject(new Error("Proxy health timeout"));
      setTimeout(tick, 400);
    };
    tick();
  });
}

async function ensureProxy({ CONFIG_DIR, CONFIG_PATH, loadConfig, startServer, isHealthy }) {
  const config = loadConfig();
  if (!config || !config.api_key) {
    throw new Error("Not configured. Run `supercompress setup` first.");
  }
  const port = config.port || PORT;
  if (await isHealthy(port)) return port;
  console.log(`  → Starting SuperCompress proxy on localhost:${port}…`);
  await startServer(config);
  await waitForHealth(port);
  console.log(`  ✓ Proxy healthy on localhost:${port}`);
  return port;
}

async function wrap(agentName, passthroughArgs, deps) {
  const key = String(agentName || "").toLowerCase();
  const spec = AGENTS[key];
  if (!spec) {
    console.log("  Usage: supercompress wrap <agent> [-- agent-args…]");
    console.log("  Agents: " + Object.keys(AGENTS).join(", "));
    process.exit(1);
  }

  console.log(`  Wrap: ${key}`);
  console.log(`  ${spec.note}`);

  if (key === "cursor") {
    await ensureProxy(deps).catch((err) => {
      console.log(`  ⚠ ${err.message}`);
    });
    console.log("  → Run `supercompress plugin` for Cursor MCP + every-message hooks (recommended).");
    return;
  }

  const port = await ensureProxy(deps);
  const env = {
    ...process.env,
    ...spec.env,
    SUPERCOMPRESS_WRAP: key,
    SUPERCOMPRESS_PORT: String(port),
  };

  const args = [...(spec.argsPrefix || []), ...passthroughArgs];
  console.log(`  → exec ${spec.bin}${args.length ? " " + args.join(" ") : ""}`);
  const child = spawn(spec.bin, args, {
    env,
    stdio: "inherit",
    shell: false,
  });
  child.on("error", (err) => {
    console.error(`  ✗ Failed to launch ${spec.bin}: ${err.message}`);
    console.error(`  → Is \`${spec.bin}\` on PATH?`);
    process.exit(1);
  });
  child.on("exit", (code) => process.exit(code == null ? 1 : code));
}

module.exports = { wrap, AGENTS, ensureProxy };
