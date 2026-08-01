const $ = (id) => document.getElementById(id);

const apiKeyEl = $("apiKey");
const queryEl = $("query");
const contextEl = $("context");
const contextMeta = $("contextMeta");
const runBtn = $("runBtn");
const loadExampleBtn = $("loadExampleBtn");
const statusEl = $("status");
const results = $("results");
const proofEl = $("proof");
const compareEl = $("compare");
const statsEl = $("stats");
const qualityEl = $("quality");
const keptBlocksEl = $("keptBlocks");
const droppedBlocksEl = $("droppedBlocks");
const evidenceEl = $("evidence");
const beforeBox = $("beforeBox");
const beforeMeta = $("beforeMeta");
const outputEl = $("output");
const outputMeta = $("outputMeta");
const endpointEl = $("endpoint");
const resultSummary = $("resultSummary");
const rawJson = $("rawJson");

let exampleCache = null;

function fmt(n) {
  return Number(n || 0).toLocaleString();
}

function pct(n, digits = 1) {
  return `${Number(n || 0).toFixed(digits)}%`;
}

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function updateContextMeta() {
  const text = contextEl.value || "";
  const lines = text ? text.split("\n").length : 0;
  contextMeta.textContent = `${fmt(text.length)} chars · ${fmt(lines)} lines`;
}

function setStatus(msg, kind = "") {
  statusEl.textContent = msg;
  statusEl.className = `hint${kind ? ` ${kind}` : ""}`;
}

function queryTerms(query) {
  const stop = new Set([
    "a", "an", "the", "and", "or", "for", "to", "of", "in", "on", "at", "by",
    "is", "was", "were", "be", "been", "did", "does", "do", "what", "why",
    "how", "when", "where", "which", "who", "with", "from", "into", "return",
    "returned", "taken", "this", "that", "user",
  ]);
  const terms = [];
  const seen = new Set();
  for (const raw of String(query || "").match(/[A-Za-z0-9_./:-]+/g) || []) {
    const t = raw.trim();
    if (t.length < 3) continue;
    const key = t.toLowerCase();
    if (stop.has(key) || seen.has(key)) continue;
    seen.add(key);
    terms.push(t);
  }
  return terms.slice(0, 16);
}

function extractEvidence(text, query) {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const lowerTerms = terms.map((t) => t.toLowerCase());
  return String(text || "")
    .split("\n")
    .filter((line) => {
      const l = line.toLowerCase();
      return lowerTerms.some((t) => l.includes(t));
    })
    .slice(0, 24);
}

function highlight(line, query) {
  let out = esc(line);
  for (const term of queryTerms(query)) {
    const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    out = out.replace(re, "<mark>$1</mark>");
  }
  return out;
}

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Recompute size stats in the browser from the actual strings — not from API claims. */
function localVerify(input, compressed, apiData) {
  const inChars = input.length;
  const outChars = compressed.length;
  const inLines = input ? input.split("\n").length : 0;
  const outLines = compressed ? compressed.split("\n").length : 0;
  const charPct = inChars ? (1 - outChars / inChars) * 100 : 0;
  const apiChar = Number(apiData.char_savings_pct || 0);
  const apiTokensIn = Number(apiData.original_tokens || 0);
  const apiTokensOut = Number(apiData.kept_tokens || 0);
  const tokenPct = apiTokensIn > 0 ? (1 - apiTokensOut / apiTokensIn) * 100 : 0;
  const charMatch = Math.abs(charPct - apiChar) < 0.2;
  return {
    inChars,
    outChars,
    inLines,
    outLines,
    charPct,
    tokenPct,
    charMatch,
    outputHash: simpleHash(compressed),
    inputHash: simpleHash(input),
  };
}

function renderProof(data, input, compressed, local) {
  const when = new Date().toISOString();
  proofEl.innerHTML = `
    <div>
      <strong>Source</strong>
      <span class="ok">Live ${esc(data.endpoint || "API")}</span><br>
      ${when}<br>
      latency ${fmt(data.latency_ms)} ms
    </div>
    <div>
      <strong>Local size check</strong>
      ${fmt(local.inChars)} → ${fmt(local.outChars)} chars<br>
      ${pct(local.charPct)} smaller<br>
      <span class="${local.charMatch ? "ok" : "bad"}">
        ${local.charMatch ? "matches API char_savings" : "API char_savings mismatch"}
      </span>
    </div>
    <div>
      <strong>Content hashes</strong>
      in ${local.inputHash}<br>
      out ${local.outputHash}<br>
      critical ${fmt(data.critical_lines_kept || 0)}/${fmt(data.critical_lines_total || 0)} lines
    </div>
    <div>
      <strong>Not precoded</strong>
      Edit query/context and re-run.<br>
      Same input is deterministic;<br>
      different input changes these numbers.
    </div>
  `;
}

function renderCompare(data, local) {
  const compression = Number(data.tokens_saved_pct || local.tokenPct || 0);
  const critical = Number(data.important_kept_pct != null ? data.important_kept_pct * 100 : 0);
  compareEl.innerHTML = `
    <div class="compare-card">
      <div class="eyebrow">Before</div>
      <div class="big">${fmt(data.original_tokens)} tokens</div>
      <div class="detail">
        ${fmt(local.inChars)} chars · ${fmt(local.inLines)} lines
      </div>
    </div>
    <div class="compare-arrow" aria-hidden="true">→</div>
    <div class="compare-card after">
      <div class="eyebrow">After</div>
      <div class="big">${fmt(data.kept_tokens)} tokens</div>
      <div class="detail">
        ${compression.toFixed(1)}% compression<br>
        ${critical.toFixed(0)}% critical retained
        (${fmt(data.critical_lines_kept || 0)}/${fmt(data.critical_lines_total || 0)} lines)
      </div>
    </div>
  `;
}

function renderStats(data, local) {
  const kv = Number(data.tokens_saved_pct || 0);
  const critical = Number(data.important_kept_pct != null ? data.important_kept_pct * 100 : 0);
  const quality = data.answer_quality != null ? Number(data.answer_quality) * 100 : null;

  statsEl.innerHTML = `
    <div class="stat accent">
      <span class="label">Compression</span>
      <div class="value">${pct(kv)}</div>
      <div class="sub">${fmt(data.original_tokens)} → ${fmt(data.kept_tokens)} tokens</div>
      <div class="bar"><i style="width:${Math.min(100, kv)}%"></i></div>
    </div>
    <div class="stat accent">
      <span class="label">Critical retained</span>
      <div class="value">${pct(critical, 0)}</div>
      <div class="sub">${fmt(data.critical_lines_kept || 0)} / ${fmt(data.critical_lines_total || 0)} critical lines in output</div>
      <div class="bar"><i style="width:${Math.min(100, critical)}%"></i></div>
    </div>
    <div class="stat">
      <span class="label">Answer quality</span>
      <div class="value">${quality == null ? "—" : pct(quality, 0)}</div>
      <div class="sub">entity ${(Number((data.verifier || {}).entity_recall || 0) * 100).toFixed(0)}% · keyword ${(Number((data.verifier || {}).keyword_recall || 0) * 100).toFixed(0)}%</div>
    </div>
    <div class="stat">
      <span class="label">Size (local check)</span>
      <div class="value">${pct(local.charPct, 0)}</div>
      <div class="sub">${fmt(local.inChars)} → ${fmt(local.outChars)} chars · ${fmt(data.latency_ms)}ms</div>
    </div>
  `;
}

function renderQuality(data) {
  const v = data.verifier || {};
  const quality = data.answer_quality != null ? pct(Number(data.answer_quality) * 100, 0) : "—";
  const important =
    data.important_kept_pct != null ? pct(Number(data.important_kept_pct) * 100, 0) : "—";
  const entity = v.entity_recall != null ? pct(Number(v.entity_recall) * 100, 0) : "—";
  const keyword = v.keyword_recall != null ? pct(Number(v.keyword_recall) * 100, 0) : "—";
  const score = v.score != null ? Number(v.score).toFixed(2) : "—";
  const risk = data.compression_risk || v.risk || "—";

  qualityEl.innerHTML = `
    <div class="stat">
      <span class="label">Answer quality</span>
      <div class="value">${quality}</div>
      <div class="sub">verifier score ${score}</div>
    </div>
    <div class="stat">
      <span class="label">Critical retained</span>
      <div class="value">${important}</div>
      <div class="sub">independent line check vs input</div>
    </div>
    <div class="stat">
      <span class="label">Entity recall</span>
      <div class="value">${entity}</div>
      <div class="sub">query entities in output</div>
    </div>
    <div class="stat">
      <span class="label">Keyword recall</span>
      <div class="value">${keyword}</div>
      <div class="sub">query terms preserved</div>
    </div>
    <div class="stat">
      <span class="label">Compression risk</span>
      <div class="value" style="text-transform:capitalize;font-size:1.25rem">${esc(risk)}</div>
      <div class="sub">policy ${esc(data.policy_name || "—")}</div>
    </div>
  `;
}

function renderBlocks(el, blocks, kind) {
  const list = Array.isArray(blocks) ? blocks : [];
  if (!list.length) {
    el.innerHTML = `<div class="empty">No ${kind} blocks reported for this run.</div>`;
    return;
  }
  el.innerHTML = list
    .slice(0, 20)
    .map((b) => {
      const lines =
        b.start_line != null && b.end_line != null
          ? `lines ${b.start_line}–${b.end_line}`
          : "lines n/a";
      const tokens = b.tokens != null ? `${fmt(b.tokens)} tokens` : "";
      const score = b.score != null ? `score ${Number(b.score).toFixed(1)}` : "";
      const reason = b.reason
        ? `<div class="reason">${esc(b.reason)}</div>`
        : kind === "dropped"
          ? `<div class="reason">low-value context</div>`
          : "";
      return `
        <div class="block-item ${kind}">
          <div class="title">${esc(b.type || "block")}</div>
          <div class="meta-line">${[lines, tokens, score].filter(Boolean).join(" · ")}</div>
          ${reason}
        </div>
      `;
    })
    .join("");
}

function renderEvidence(compressed, query, provided) {
  const lines = Array.isArray(provided) && provided.length
    ? provided
    : extractEvidence(compressed, query);
  if (!lines.length) {
    evidenceEl.innerHTML = `<div class="empty">No query-matching lines found in compressed output.</div>`;
    return;
  }
  evidenceEl.innerHTML = lines
    .map((line) => `<div class="evidence-line">${highlight(line, query)}</div>`)
    .join("");
}

function renderBefore(input) {
  const excerpt = String(input || "");
  const shown =
    excerpt.length > 3500
      ? `${excerpt.slice(0, 1800)}\n\n… [${fmt(excerpt.length - 3600)} chars omitted] …\n\n${excerpt.slice(-1800)}`
      : excerpt;
  beforeBox.textContent = shown;
  beforeMeta.textContent = `${fmt(excerpt.length)} chars total · hash ${simpleHash(excerpt)}`;
}

function renderAll(data, input, query) {
  const compressed = String(data.compressed_text || "");
  const local = localVerify(input, compressed, data);
  const compression = Number(data.tokens_saved_pct || 0);
  const critical = Number(data.important_kept_pct != null ? data.important_kept_pct * 100 : 0);
  resultSummary.textContent = `${data.policy_name || "SuperCompress"}: ${compression.toFixed(1)}% compression, ${critical.toFixed(0)}% critical retained — measured on this response.`;

  renderProof(data, input, compressed, local);
  renderCompare(data, local);
  renderStats(data, local);
  renderQuality(data);
  renderBlocks(keptBlocksEl, data.kept_blocks, "kept");
  renderBlocks(droppedBlocksEl, data.dropped_blocks, "dropped");
  renderEvidence(compressed, query, data.evidence_lines);
  renderBefore(input);

  outputEl.value = compressed;
  outputMeta.textContent = `${fmt(local.outChars)} chars · ${fmt(local.outLines)} lines · hash ${local.outputHash}`;
  rawJson.textContent = JSON.stringify(data, null, 2);
}

async function bootstrap() {
  const res = await fetch("/bootstrap");
  if (!res.ok) throw new Error("Failed to load local bootstrap");
  const data = await res.json();
  exampleCache = data;
  if (data.endpoint) endpointEl.textContent = data.endpoint;
  apiKeyEl.value = "";
  queryEl.value = "";
  contextEl.value = "";
  updateContextMeta();
  setStatus("Paste API key + context, or load the example log. Every compress hits the live API.");
}

async function loadExample() {
  if (!exampleCache) await bootstrap();
  const data = exampleCache || {};
  if (data.query) queryEl.value = data.query;
  if (data.context) contextEl.value = data.context;
  updateContextMeta();
  setStatus(`Loaded example (${fmt((data.context || "").length)} chars). Compress to call the live API.`);
}

async function compress() {
  const api_key = apiKeyEl.value.trim();
  const query = queryEl.value.trim();
  const context = contextEl.value;

  if (!api_key.startsWith("sc_")) {
    setStatus("Paste a valid SuperCompress API key (sc_live_…).", "error");
    apiKeyEl.focus();
    return;
  }
  if (!query) {
    setStatus("Add a query.", "error");
    queryEl.focus();
    return;
  }
  if (!context.trim()) {
    setStatus("Paste input context (or load the example).", "error");
    contextEl.focus();
    return;
  }

  runBtn.disabled = true;
  runBtn.textContent = "Compressing…";
  setStatus("Calling live SuperCompress API…");

  try {
    const res = await fetch("/compress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key, query, context, mode: "compiler" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.detail || data.message || `Request failed (${res.status})`);
    }

    results.hidden = false;
    renderAll(data, context, query);
    setStatus(
      `Live response — ${pct(data.tokens_saved_pct)} compression · ${pct(Number(data.important_kept_pct || 0) * 100, 0)} critical · ${fmt(data.latency_ms)}ms`,
      "ok",
    );
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    setStatus(err.message || String(err), "error");
  } finally {
    runBtn.disabled = false;
    runBtn.textContent = "Compress with SuperCompress";
  }
}

contextEl.addEventListener("input", updateContextMeta);
runBtn.addEventListener("click", compress);
loadExampleBtn.addEventListener("click", () => loadExample().catch((err) => setStatus(err.message || String(err), "error")));
bootstrap().catch((err) => setStatus(err.message || String(err), "error"));
