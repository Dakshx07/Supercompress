/**
 * Impact calculator — compiler-mode SuperCompress in-browser (model.json).
 * Removes as much as possible while keeping answer-critical context for the query.
 */
(function () {
  "use strict";

  const ASSUMPTIONS = {
    tokens_per_gpu_second: 2500,
    gpu_watts: 150,
    grid_kg_co2_per_kwh: 0.417,
    kv_share_of_prefill: 0.55,
    liters_water_per_kwh: 1.8,
  };

  let modelPromise = null;

  function $(id) {
    return document.getElementById(id);
  }

  function engine() {
    const E = window.SuperCompressEngine;
    if (!E) throw new Error("SuperCompress engine not loaded");
    return E;
  }

  function loadModelOnce() {
    if (!modelPromise) modelPromise = engine().loadModel("assets/data/model.json");
    return modelPromise;
  }

  function fmt(n, d = 0) {
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
  }

  function setStat(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function setEmpty() {
    [
      "impact-in-tokens",
      "impact-out-tokens",
      "impact-tokens-removed",
      "impact-pct-saved",
      "impact-chars-saved",
      "impact-quality",
      "impact-power-before",
      "impact-power-after",
      "impact-power-saved",
      "impact-water-saved",
      "impact-co2-saved",
    ].forEach((id) => setStat(id, "—"));
    const outPre = $("impact-compressed-out");
    if (outPre) outPre.textContent = "Press compress to keep query-critical evidence.";
    const status = $("impact-status");
    if (status) {
      status.textContent = "";
      status.classList.remove("impact-status--error", "impact-status--ok");
    }
  }

  function setLoading(on) {
    const btn = $("impact-send");
    if (!btn) return;
    btn.disabled = on;
    const label = btn.querySelector("span");
    if (label) {
      label.textContent = on ? "…" : "compress";
      return;
    }
    const compact = btn.classList.contains("sc-compress-btn") || btn.classList.contains("compress-button");
    btn.textContent = on ? (compact ? "…" : "Compressing…") : (compact ? "compress" : "Compress");
  }

  function setStatus(msg, type) {
    const el = $("impact-status");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("impact-status--error", "impact-status--ok");
    if (type) el.classList.add(`impact-status--${type}`);
  }

  function envForTokenCount(tokenCount) {
    const effective = Math.max(tokenCount, 0) * ASSUMPTIONS.kv_share_of_prefill;
    const gpuSeconds = effective / ASSUMPTIONS.tokens_per_gpu_second;
    const wattHours = (gpuSeconds * ASSUMPTIONS.gpu_watts) / 3600;
    const kwh = wattHours / 1000;
    return {
      watt_hours: wattHours,
      water_liters: kwh * ASSUMPTIONS.liters_water_per_kwh,
      co2_grams: kwh * ASSUMPTIONS.grid_kg_co2_per_kwh * 1000,
    };
  }

  function applyPreset(key) {
    const preset = (window.ImpactPresets || {})[key];
    if (!preset) return;
    const prompt = $("impact-prompt");
    const query = $("impact-query");
    if (prompt) prompt.value = preset.context;
    if (query) query.value = preset.query;
    document.querySelectorAll(".impact-preset-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.preset === key);
    });
    setEmpty();
    setStatus(`Loaded “${preset.label}”. Press Compress or Enter.`, null);
  }

  async function runCalc() {
    const context = ($("impact-prompt") || {}).value || "";
    const query = ($("impact-query") || {}).value?.trim() || "Summarize this context.";

    if (!context.trim()) {
      setEmpty();
      setStatus("Paste context, pick a preset, or drop a .md file.", null);
      return;
    }

    setLoading(true);
    setStatus("Evicting everything safe to drop for your question…", null);

    try {
      const model = await loadModelOnce();
      const E = engine();
      const result = E.compressAdaptive(context, query, model);
      const quality = result.answer_quality ?? E.answerQualityScore(context, result.compressed_text, query);
      const saved = Math.max(0, result.original_tokens - result.kept_tokens);
      const pct = result.kv_savings_pct ?? 0;
      const originalChars = context.length;
      const compressedChars = result.compressed_text.length;
      const charSaved = Math.max(0, originalChars - compressedChars);
      const charPct = originalChars > 0 ? (1 - compressedChars / originalChars) * 100 : 0;
      const before = envForTokenCount(result.original_tokens);
      const after = envForTokenCount(result.kept_tokens);

      setStat("impact-in-tokens", `${fmt(result.original_tokens)} tokens`);
      setStat("impact-out-tokens", `${fmt(result.kept_tokens)} tokens`);
      setStat("impact-tokens-removed", fmt(saved));
      setStat("impact-pct-saved", `${fmt(pct, 0)}%`);
      const outPre = $("impact-compressed-out");
      if (outPre) outPre.textContent = result.compressed_text || "(empty)";
      setStat(
        "impact-chars-saved",
        charSaved > 0
          ? `${fmt(charSaved)} chars (${fmt(charPct, 1)}%)`
          : `${fmt(charPct, 1)}%`
      );
      setStat("impact-quality", `${fmt(quality * 100, 0)}% retained`);
      setStat("impact-power-before", `${fmt(before.watt_hours * 1000, 3)} mWh`);
      setStat("impact-power-after", `${fmt(after.watt_hours * 1000, 3)} mWh`);
      setStat(
        "impact-power-saved",
        `${fmt(Math.max(0, before.watt_hours - after.watt_hours) * 1000, 3)} mWh`
      );
      setStat(
        "impact-water-saved",
        `${fmt(Math.max(0, (before.water_liters - after.water_liters) * 1000), 2)} mL`
      );
      setStat(
        "impact-co2-saved",
        `${fmt(Math.max(0, before.co2_grams - after.co2_grams), 3)} g`
      );
      setStatus(
        `Removed ${fmt(saved)} tokens (${fmt(pct, 1)}%) · kept ${fmt(result.kept_tokens)}/${fmt(result.original_tokens)} · ${fmt((result.important_kept_pct ?? quality) * 100, 0)}% important context`,
        "ok"
      );
    } catch (err) {
      setEmpty();
      setStatus(err.message || "Compression failed.", "error");
    } finally {
      setLoading(false);
    }
  }

  function handleFile(file) {
    if (!file) return;
    const ok =
      file.name.endsWith(".md") ||
      file.name.endsWith(".txt") ||
      file.name.endsWith(".markdown") ||
      file.type.startsWith("text/");
    if (!ok) {
      setStatus("Drop a .md or .txt file.", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const prompt = $("impact-prompt");
      if (prompt) prompt.value = String(reader.result || "");
      document.querySelectorAll(".impact-preset-btn").forEach((b) => b.classList.remove("active"));
      setEmpty();
      setStatus(`Loaded ${file.name}. Add a question and press Compress.`, null);
    };
    reader.readAsText(file);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const prompt = $("impact-prompt");
    const query = $("impact-query");
    const send = $("impact-send");
    const drop = $("impact-drop-zone");
    const fileInput = $("impact-file-input");

    document.querySelectorAll(".impact-preset-btn").forEach((btn) => {
      btn.addEventListener("click", () => applyPreset(btn.dataset.preset));
    });

    send?.addEventListener("click", runCalc);

    query?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runCalc();
      }
    });

    prompt?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        runCalc();
      }
    });

    drop?.addEventListener("click", () => fileInput?.click());
    drop?.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("impact-drop-zone--over");
    });
    drop?.addEventListener("dragleave", () => drop.classList.remove("impact-drop-zone--over"));
    drop?.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("impact-drop-zone--over");
      handleFile(e.dataTransfer?.files?.[0]);
    });
    fileInput?.addEventListener("change", () => handleFile(fileInput.files?.[0]));

    applyPreset("coding");
  });
})();
