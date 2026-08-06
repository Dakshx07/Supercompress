/**
 * Live sustainability counters — illustrative estimates with documented assumptions.
 */
(function () {
  "use strict";

  const STORAGE_KEY = "sc_dashboard_totals_v1";
  const E = window.SuperCompressEngine;

  function loadTotals() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
    catch (_) { return {}; }
  }

  function saveTotals(t) { localStorage.setItem(STORAGE_KEY, JSON.stringify(t)); }

  let totals = Object.assign({ tokens: 0, gpu_seconds: 0, wh: 0, co2: 0, runs: 0 }, loadTotals());

  function render() {
    const fmt = (n, d) => n.toLocaleString(undefined, { maximumFractionDigits: d });
    const el = (id, val) => { const n = document.getElementById(id); if (n) n.textContent = val; };
    el("dash-tokens", fmt(totals.tokens, 0));
    el("dash-gpu-sec", fmt(totals.gpu_seconds, 2));
    el("dash-wh", fmt(totals.wh, 4));
    el("dash-co2", fmt(totals.co2 * 1000, 2) + " g");
    el("dash-runs", fmt(totals.runs, 0));
  }

  function recordRun(tokensSaved, sus) {
    totals.tokens += tokensSaved;
    totals.gpu_seconds += sus.gpu_seconds_avoided;
    totals.wh += sus.watt_hours_saved;
    totals.co2 += sus.co2_kg_avoided;
    totals.runs += 1;
    saveTotals(totals);
    render();
  }

  async function loadBenchmarks() {
    const table = document.getElementById("benchmark-table-body");
    if (!table) return;
    try {
      const res = await fetch("assets/data/benchmarks.json");
      const data = await res.json();
      const summary = data.summary || {};
      const order = ["FIFO", "Truncation", "Summarization", "H2O", "SuperCompress", "H2O-fallback"];
      table.innerHTML = "";
      for (const name of order) {
        if (!summary[name]) continue;
        const s = summary[name];
        const tr = document.createElement("tr");
        if (name === "SuperCompress") tr.className = "row-highlight";
        tr.innerHTML = `
          <td>${name}</td>
          <td>${s.avg_tokens_saved_pct}%</td>
          <td>${(s.avg_answer_quality * 100).toFixed(1)}%</td>
          <td>${(s.avg_entity_recall * 100).toFixed(1)}%</td>
          <td>${(s.avg_oracle_recall * 100).toFixed(1)}%</td>
          <td>${s.avg_latency_ms} ms</td>`;
        table.appendChild(tr);
      }
      const head = document.getElementById("bench-headline");
      if (head && data.headline) {
        head.textContent = `SuperCompress retains ${(data.headline.supercompress_answer_quality * 100).toFixed(0)}% answer quality at ${data.headline.supercompress_tokens_saved_pct}% KV savings (Truncation: ${(data.headline.truncation_answer_quality * 100).toFixed(0)}%).`;
      }
    } catch (e) {
      table.innerHTML = `<tr><td colspan="6">Benchmark data unavailable offline.</td></tr>`;
    }
  }

  function renderScale(turns) {
    const tokensPerTurn = 800;
    const sus = E.sustainabilityFromTokensSaved(turns * tokensPerTurn);
    const wh = sus.watt_hours_saved;
    const co2kg = sus.co2_kg_avoided;
    const gx10Hours = sus.gpu_seconds_avoided / 3600;
    const fmt = (n, d) => n.toLocaleString(undefined, { maximumFractionDigits: d });
    const el = (id, val) => { const n = document.getElementById(id); if (n) n.textContent = val; };
    el("scale-turns-val", fmt(turns, 0));
    el("scale-wh", fmt(wh / 1000, 1));
    el("scale-co2", fmt(co2kg, 1));
    el("scale-gx10", fmt(gx10Hours, 0));
    el("scale-copy", `${fmt(turns, 0)} compressions × ~${tokensPerTurn} tokens saved → ~${fmt(wh / 1000, 1)} kWh and ~${fmt(co2kg, 1)} kg CO₂ avoided (documented assumptions).`);
  }

  window.SCDashboard = { recordRun, render };
  document.addEventListener("DOMContentLoaded", () => {
    render();
    loadBenchmarks();
    renderScale(1000000);
    const slider = document.getElementById("scale-turns");
    slider?.addEventListener("input", () => renderScale(parseInt(slider.value, 10)));
  });
})();
