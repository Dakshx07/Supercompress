#!/usr/bin/env node
/**
 * Deep compression smoke — prove real savings across every path:
 * hosted API, local engine, proxy compressor, MCP (Cursor/FreeBuff/OpenCode).
 */

const assert = require("assert");
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const HOME = os.homedir();
const CONFIG_DIR = path.join(HOME, ".supercompress");
const MCP = path.join(ROOT, "src", "mcp.js");

const results = [];
const pass = (n, d = "") => {
  results.push({ ok: true, n, d });
  console.log(`PASS  ${n}${d ? ` — ${d}` : ""}`);
};
const fail = (n, d) => {
  results.push({ ok: false, n, d });
  console.error(`FAIL  ${n} — ${d}`);
};

function variedContext(n = 50) {
  return Array.from({ length: n }, (_, i) =>
    [
      `src/svc_${i}.ts: export async function fetch${i}(id: string) { const r = await api.get("/v1/"+id); return r.data.value${i}; }`,
      `test/svc_${i}.test.ts: expect(await fetch${i}("x")).toEqual(expect.anything());`,
      `// NOTE_${i}: fetch${i} loads resource and returns value${i}`,
    ].join("\n")
  ).join("\n");
}

function fatLogs(n = 400) {
  const lines = [];
  for (let i = 0; i < n; i++) {
    if (i === 242) {
      lines.push(`[ERR] job=1242 payment.charge connection reset`);
    } else {
      lines.push(`[OK] worker handled job status=ok processed fine`);
    }
  }
  return lines.join("\n");
}

function requestCompress(apiKey, body) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "www.supercompress.dev",
        path: "/api/v1/compress",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = { raw: data };
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function mcpCall(env, tool, args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MCP], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, SUPERCOMPRESS_API_KEY: undefined, ...env },
    });
    let buf = "";
    const replies = [];
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {}
      if (err) reject(err);
      else resolve(replies);
    };
    const timer = setTimeout(() => finish(new Error(`MCP timeout buf=${buf.slice(0, 400)}`)), timeoutMs);
    child.stdout.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          replies.push(msg);
          if (msg.id === 3) finish();
        } catch {}
      }
    });
    child.stderr.on("data", () => {});
    child.on("error", (err) => finish(err));
    const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "compress-deep", version: "1" },
      },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: tool, arguments: args } });
  });
}

function unwrapMcpCompress(call) {
  assert.ok(call && call.result, "missing MCP result");
  assert.ok(!call.result.isError, JSON.stringify(call.result).slice(0, 300));
  const text = (call.result.content || []).map((c) => c.text || "").join("\n");
  const data = JSON.parse(text);
  const compressed = data.compressed_text || data.compressed_context || "";
  assert.ok(String(compressed).trim(), "empty compressed output");
  assert.ok(!/Missing or invalid API key/i.test(text), "auth failed");
  const orig = data.original_tokens || 0;
  const saved = data.tokens_saved || 0;
  const kv = data.tokens_saved_pct || data.savings_pct || 0;
  assert.ok(orig > 50, `original_tokens too small: ${orig}`);
  assert.ok(saved > 0 || kv > 0, `no savings saved=${saved} kv=${kv}`);
  assert.match(String(compressed), /fetch7|value7|payment|ERROR|job=1242/i);
  return { orig, saved, kv, compressed: String(compressed), kept: data.kept_tokens || data.compressed_tokens };
}

async function main() {
  console.log("\n=== Deep compression smoke ===\n");
  // Ensure parent process cannot poison compressor with a bad env key.
  delete process.env.SUPERCOMPRESS_API_KEY;
  process.env.SUPERCOMPRESS_CONFIG_DIR = CONFIG_DIR;

  const live = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, "config.json"), "utf8"));
  assert.ok(live.api_key && live.api_key.startsWith("sc_"), "missing linked SuperCompress account");

  // 1) Hosted API coding
  try {
    const ctx = variedContext(60);
    const res = await requestCompress(live.api_key, {
      context: ctx,
      query: "What does fetch7 return?",
      mode: "compiler",
      coding_agent: "deep-test-hosted",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 240));
    assert.ok(res.body.compressed_text);
    assert.ok(res.body.tokens_saved > 1000);
    assert.match(res.body.compressed_text, /fetch7|value7/i);
    pass(
      "hosted API compress coding context",
      `orig=${res.body.original_tokens} saved=${res.body.tokens_saved} kv=${res.body.tokens_saved_pct}%`
    );
  } catch (e) {
    fail("hosted API compress coding context", e.message);
  }

  // 2) Hosted API logs — prove size drop + keep the failure needle
  try {
    const logs = fatLogs(400);
    const res = await requestCompress(live.api_key, {
      context: logs,
      query: "Which job failed and why?",
      mode: "compiler",
      coding_agent: "deep-test-logs",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 240));
    assert.ok(res.body.compressed_text, "missing compressed_text");
    assert.match(res.body.compressed_text, /242|1242|payment|ERROR|connection reset/i);
    const inChars = logs.length;
    const outChars = String(res.body.compressed_text).length;
    assert.ok(outChars < inChars * 0.5, `logs not shrunk enough in=${inChars} out=${outChars}`);
    assert.ok((res.body.tokens_saved || 0) > 100, `weak token savings: ${res.body.tokens_saved}`);
    pass(
      "hosted API compress logs",
      `chars ${inChars}→${outChars}; tokens orig=${res.body.original_tokens} saved=${res.body.tokens_saved} kv=${res.body.tokens_saved_pct}%`
    );
  } catch (e) {
    fail("hosted API compress logs", e.message);
  }

  // 3) Local engine
  try {
    const engine = require(path.join(ROOT, "src/local-engine"));
    const ctx = variedContext(40);
    const out = engine.compress(ctx, "What does fetch7 return?");
    assert.ok(out.compressed_text);
    assert.ok(out.compressed_text.length < ctx.length);
    assert.match(out.compressed_text, /fetch7|value7/i);
    assert.ok(out.tokens_saved > 0);
    pass("local-engine compress", `kept=${out.kept_tokens} saved=${out.tokens_saved}`);
  } catch (e) {
    fail("local-engine compress", e.message);
  }

  // 4) Proxy compressor with poisoned env key (must fall back to config)
  try {
    process.env.SUPERCOMPRESS_API_KEY = "${SUPERCOMPRESS_API_KEY}";
    delete require.cache[require.resolve(path.join(ROOT, "src/compressor.js"))];
    const compressor = require(path.join(ROOT, "src/compressor.js"));
    const msgs = [{ role: "system", content: "You are a coding assistant." }];
    for (let i = 0; i < 30; i++) {
      msgs.push({
        role: "user",
        content: `Please review src/svc_${i}.ts which exports async function fetch${i}(id){ return (await api.get(id)).data.value${i}; }`,
      });
      msgs.push({ role: "assistant", content: `fetch${i} returns value${i} from the API payload.` });
    }
    msgs.push({ role: "user", content: "Explain fetch7 carefully and cite the return value." });
    const out = await compressor.compress(msgs, "deep-test-proxy");
    assert.ok(!out.skip_reason, `unexpected skip: ${out.skip_reason}`);
    assert.ok(out.tokens_saved > 100, `weak savings: ${out.tokens_saved}`);
    assert.ok(out.messages.some((m) => /fetch7|value7/i.test(m.content || "")));
    pass(
      "proxy compressor.compress (ignores placeholder env key)",
      `orig=${out.original_tokens} compressed=${out.compressed_tokens} saved=${out.tokens_saved} pct=${out.savings_pct}`
    );
  } catch (e) {
    fail("proxy compressor.compress (ignores placeholder env key)", e.message);
  } finally {
    delete process.env.SUPERCOMPRESS_API_KEY;
  }

  // 5-7) MCP paths
  const mcpCases = [
    [
      "Cursor wiring + bad placeholder ignored",
      {
        SUPERCOMPRESS_CONFIG_DIR: CONFIG_DIR,
        SUPERCOMPRESS_API_KEY: "${SUPERCOMPRESS_API_KEY}",
      },
    ],
    [
      "FreeBuff wiring",
      {
        SUPERCOMPRESS_CONFIG_DIR: JSON.parse(fs.readFileSync(path.join(HOME, ".agents/mcp.json"), "utf8"))
          .mcpServers.supercompress.env.SUPERCOMPRESS_CONFIG_DIR,
      },
    ],
    [
      "OpenCode wiring",
      {
        SUPERCOMPRESS_CONFIG_DIR: JSON.parse(
          fs.readFileSync(path.join(HOME, ".config/opencode/opencode.jsonc"), "utf8")
        ).mcp.supercompress.environment.SUPERCOMPRESS_CONFIG_DIR,
      },
    ],
  ];

  for (const [label, env] of mcpCases) {
    try {
      let lastErr = null;
      let stats = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${attempt}`;
          const replies = await mcpCall(env, "compress_context", {
            context: `${variedContext(45)}\n\n// deep-session ${stamp} ${label}\n`,
            query: "What does fetch7 return?",
            session_id: `compress-deep-${stamp}`,
          });
          const tools = replies.find((r) => r.id === 2);
          assert.ok(tools?.result?.tools?.some((t) => t.name === "compress_context"), "tools/list missing compress_context");
          const call = replies.find((r) => r.id === 3);
          stats = unwrapMcpCompress(call);
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          if (!/503|billing unavailable|temporar/i.test(String(e.message || e)) || attempt === 3) throw e;
          await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        }
      }
      if (lastErr) throw lastErr;
      pass(`MCP compress (${label})`, `orig=${stats.orig} saved=${stats.saved} kv=${stats.kv}%`);
    } catch (e) {
      fail(`MCP compress (${label})`, e.message);
    }
  }

  // 8) usage summary
  try {
    const replies = await mcpCall({ SUPERCOMPRESS_CONFIG_DIR: CONFIG_DIR }, "usage_summary", {});
    const call = replies.find((r) => r.id === 3);
    assert.ok(call?.result, "no usage result");
    assert.ok(!call.result.isError, JSON.stringify(call.result).slice(0, 240));
    const text = (call.result.content || []).map((c) => c.text || "").join("\n");
    const parsed = JSON.parse(text);
    assert.ok("total_tokens_saved" in parsed || "coding_agent_usage" in parsed || "total_requests" in parsed);
    pass(
      "MCP usage_summary",
      `requests=${parsed.total_requests ?? "n/a"} saved=${parsed.total_tokens_saved ?? "n/a"}`
    );
  } catch (e) {
    fail("MCP usage_summary", e.message);
  }

  // 9) empty-compression safety
  try {
    delete require.cache[require.resolve(path.join(ROOT, "src/compressor.js"))];
    const compressor = require(path.join(ROOT, "src/compressor.js"));
    const pad = "SAME LINE REPEAT. ".repeat(200);
    const out = await compressor.compress(
      [
        { role: "system", content: "sys" },
        { role: "user", content: pad },
        { role: "assistant", content: pad },
        { role: "user", content: "summarize" },
      ],
      "deep-test-empty"
    );
    assert.ok(Array.isArray(out.messages) && out.messages.length >= 2);
    assert.ok(out.messages.map((m) => m.content || "").join("\n").trim().length > 0, "messages wiped");
    pass("empty-compression safety", out.skip_reason ? `skip=${out.skip_reason}` : `saved=${out.tokens_saved}`);
  } catch (e) {
    fail("empty-compression safety", e.message);
  }

  // 10) OpenCode connected
  try {
    let bin;
    try {
      bin = execFileSync("which", ["opencode"], { encoding: "utf8" }).trim();
    } catch {
      bin = path.join(HOME, ".opencode/bin/opencode");
    }
    const out = execFileSync(bin, ["mcp", "list"], { encoding: "utf8", timeout: 20000 });
    assert.match(out, /supercompress/i);
    assert.match(out, /connected/i);
    pass("OpenCode mcp list still connected");
  } catch (e) {
    fail("OpenCode mcp list still connected", e.message);
  }

  // 11) FreeBuff config still has plugin
  try {
    const fb = JSON.parse(fs.readFileSync(path.join(HOME, ".agents/mcp.json"), "utf8"));
    assert.ok(fb.mcpServers.supercompress);
    assert.ok(fb.mcpServers.supercompress.env.SUPERCOMPRESS_CONFIG_DIR);
    pass("FreeBuff mcp.json still has supercompress");
  } catch (e) {
    fail("FreeBuff mcp.json still has supercompress", e.message);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== Summary: passed=${results.length - failed.length} failed=${failed.length} total=${results.length} ===`);
  if (failed.length) {
    for (const f of failed) console.log(" -", `${f.n}: ${f.d}`);
    process.exitCode = 1;
  } else {
    console.log("All deep compression checks passed.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
