/**
 * Judge-proof playground — side-by-side baseline vs SuperCompress, no API keys.
 */
(function () {
  "use strict";

  const E = window.SuperCompressEngine;
  let model = null;
  const POLICIES = ["FIFO", "Truncation", "Summarization", "H2O", "SuperCompress"];

  function $(id) { return document.getElementById(id); }

  function formatPct(n) { return `${n.toFixed(1)}%`; }

  function renderTokenBar(container, kept, total, label) {
    const pct = total > 0 ? (kept / total) * 100 : 0;
    const saved = total - kept;
    container.innerHTML = `
      <div class="token-bar-wrap">
        <div class="token-bar-label">${label}: <strong>${kept}</strong> / ${total} tokens kept · ${formatPct((saved / Math.max(total, 1)) * 100)} saved</div>
        <div class="token-bar" aria-hidden="true">
          <span class="token-bar-kept" style="width:${pct.toFixed(1)}%"></span>
          <span class="token-bar-removed" style="width:${(100 - pct).toFixed(1)}%"></span>
        </div>
      </div>`;
  }

  function renderImpactPanel(el, tokensSaved) {
    const sus = E.sustainabilityFromTokensSaved(Math.max(tokensSaved, 0));
    el.innerHTML = `
      <h4 class="impact-panel-title">Environmental impact (this run)</h4>
      <div class="impact-grid">
        <div><span class="impact-val">${tokensSaved.toLocaleString()}</span><span class="impact-lbl">tokens avoided</span></div>
        <div><span class="impact-val">${sus.gpu_seconds_avoided.toFixed(3)}s</span><span class="impact-lbl">GPU-sec avoided</span></div>
        <div><span class="impact-val">${(sus.watt_hours_saved * 1000).toFixed(2)}</span><span class="impact-lbl">mWh saved (est.)</span></div>
        <div><span class="impact-val">${(sus.co2_kg_avoided * 1000).toFixed(2)}g</span><span class="impact-lbl">CO₂ avoided (est.)</span></div>
      </div>
      <p class="impact-note">Illustrative · 2,500 tok/GPU-s · 150W · 55% KV share · 0.417 kg CO₂/kWh</p>`;
  }

  function renderAnnotations(container, annotations, title) {
    container.innerHTML = `<h4>${title}</h4>`;
    const heat = document.createElement("div");
    heat.className = "line-heatmap";
    annotations.slice(0, 120).forEach((a) => {
      const cell = document.createElement("span");
      cell.className = `heat-cell ${a.kept ? "kept" : "removed"}`;
      cell.title = `${a.kept ? "keep" : "drop"}: ${a.reason}\n${a.text}`;
      heat.appendChild(cell);
    });
    container.appendChild(heat);
    const list = document.createElement("div");
    list.className = "line-viz";
    annotations.filter((a) => a.text.includes("CRITICAL") || a.text.includes("User.fetch") || a.reason.includes("entity") || (!a.kept && a.line_index > 2)).slice(0, 20).forEach((a) => {
      const row = document.createElement("div");
      row.className = `line-row ${a.kept ? "kept" : "removed"}`;
      row.innerHTML = `<span class="line-tag">${a.kept ? "keep" : "drop"}</span><code>${escapeHtml(a.text || " ")}</code><span class="line-reason">${a.reason}</span>`;
      list.appendChild(row);
    });
    container.appendChild(list);
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function renderAnswerPanel(el, label, result, question) {
    const quality = E.answerQualityScore(result.original_text, result.compressed_text, question);
    el.innerHTML = `
      <div class="demo-panel-head">
        <strong>${label}</strong>
        <span class="demo-badge">${result.policy_name}</span>
      </div>
      <div class="panel-token-bar"></div>
      <p class="demo-stats">Answer quality <strong>${(quality * 100).toFixed(0)}%</strong> · ${formatPct(result.kv_savings_pct)} KV saved</p>
      <pre class="demo-output">${escapeHtml(result.compressed_text.slice(0, 4000))}</pre>`;
    renderTokenBar(el.querySelector(".panel-token-bar"), result.kept_tokens, result.original_tokens, label);
    return quality;
  }

  function renderCompareAll(container, context, question, budget) {
    container.innerHTML = "<h4>All policies</h4>";
    const table = document.createElement("table");
    table.className = "compare-table mini-compare";
    table.innerHTML = "<thead><tr><th>Policy</th><th>Kept</th><th>Saved</th><th>Quality</th></tr></thead>";
    const tbody = document.createElement("tbody");
    POLICIES.forEach((name) => {
      const r = E.compressContext(context, question, budget, name, model);
      const q = E.answerQualityScore(r.original_text, r.compressed_text, question);
      const tr = document.createElement("tr");
      if (name === "SuperCompress") tr.className = "row-highlight";
      tr.innerHTML = `<td>${name}</td><td>${r.kept_tokens}/${r.original_tokens}</td><td>${formatPct(r.kv_savings_pct)}</td><td>${(q * 100).toFixed(0)}%</td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

  async function runDemo() {
    const context = ($("demo-context") || {}).value || "";
    const question = ($("demo-question") || {}).value || "Summarize this context.";
    const budget = parseFloat(($("demo-budget") || {}).value || "0.35");
    const status = $("demo-status");
    const truncPanel = $("demo-truncation");
    const scPanel = $("demo-supercompress");
    const vizTrunc = $("viz-truncation");
    const vizSc = $("viz-supercompress");
    const impactPanel = $("demo-impact");
    const compareAll = $("demo-compare-all");

    if (!context.trim()) {
      if (status) status.textContent = "Paste context above to run the demo.";
      return;
    }

    if (status) status.textContent = "Compressing…";
    if (!model) {
      try { model = await E.loadModel(); } catch (e) { model = null; }
    }

    const trunc = E.compressContext(context, question, budget, "Truncation", model);
    const sc = E.compressContext(context, question, budget, "SuperCompress", model);
    const qTrunc = renderAnswerPanel(truncPanel, "Truncation baseline", trunc, question);
    const qSc = renderAnswerPanel(scPanel, "SuperCompress", sc, question);

    renderAnnotations(vizTrunc, trunc.line_annotations, "Truncation — line retention map");
    renderAnnotations(vizSc, sc.line_annotations, "SuperCompress — line retention map");

    const tokensSaved = sc.original_tokens - sc.kept_tokens;
    if (impactPanel) renderImpactPanel(impactPanel, tokensSaved);
    if (compareAll) renderCompareAll(compareAll, context, question, budget);

    const sus = E.sustainabilityFromTokensSaved(tokensSaved);
    if (window.SCDashboard) window.SCDashboard.recordRun(tokensSaved, sus);

    if (status) {
      const verdict = qSc >= qTrunc ? "SuperCompress ≥ truncation quality" : "review quality";
      status.innerHTML = `${verdict} · <strong>${tokensSaved.toLocaleString()}</strong> tokens avoided this run · <strong>${(sus.co2_kg_avoided * 1000).toFixed(2)}g</strong> CO₂ est.`;
    }
  }

  function loadFailureCase() {
    const sample = E.middleTruncationFailureCase();
    if ($("demo-context")) $("demo-context").value = sample.context;
    if ($("demo-question")) $("demo-question").value = sample.question;
    if ($("demo-budget") && sample.budget) $("demo-budget").value = String(sample.budget);
    runDemo();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    try { model = await E.loadModel(); } catch (_) { /* H2O fallback in engine */ }
    $("demo-run")?.addEventListener("click", runDemo);
    $("demo-failure-case")?.addEventListener("click", loadFailureCase);
    $("demo-compare-all-btn")?.addEventListener("click", runDemo);
    loadFailureCase();
  });
})();
