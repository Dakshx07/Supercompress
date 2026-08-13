/**
 * Founder usage charts — same dither kit as dashboard Analytics.
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function paint(payload) {
    const kit = window.DitherKitLite;
    const data = window.SCAnalyticsData;
    if (!kit || !data?.bundleToSeries) return;

    const bundle = payload.analytics || {};
    bundle.live = true;
    bundle.byDay = bundle.byDay || payload.by_day || {};
    const series = data.bundleToSeries(bundle);
    const totals = payload.totals || {};

    const processed = Number(totals.processed || series.totalIn || 0);
    const saved = Number(totals.tokens_saved || series.totalSaved || 0);
    const tin = Number(totals.tokens_in || series.totalIn || 0);
    const tout = Number(totals.tokens_out || 0);
    const cut = Number(totals.cut_pct || series.cut || 0);

    if ($("fu-kpi-cut-sub")) {
      $("fu-kpi-cut-sub").textContent = `${kit.formatCompact(saved)} saved · ${kit.formatCompact(tin)} in this month`;
    }
    if ($("fu-kpi-users-sub")) {
      $("fu-kpi-users-sub").textContent = `${totals.users_with_usage || 0} with usage · ${totals.users || 0} signed up`;
    }

    const washes = [
      ["fu-wash-cut", { color: "brand", intensity: 0.88 }],
      ["fu-wash-processed", { color: "brand", intensity: 0.7 }],
      ["fu-wash-saved", { color: "brand", intensity: 0.62 }],
      ["fu-wash-in", { color: "sky", intensity: 0.58 }],
      ["fu-wash-out", { color: "sky", intensity: 0.5 }],
      ["fu-wash-users", { color: "sky", intensity: 0.55 }],
    ];
    for (const [id, opts] of washes) {
      const el = $(id);
      if (!el) continue;
      kit.renderDitherWash(el, opts);
      kit.startDitherWashLoop(el, opts);
    }

    const setNum = (id, n, compact, suffix) => {
      const el = $(id);
      if (!el) return;
      const v = Number(n) || 0;
      el.textContent = (compact && kit.formatCompact ? kit.formatCompact(v) : String(Math.round(v))) + (suffix || "");
    };
    setNum("fu-kpi-cut", cut, false, "%");
    setNum("fu-kpi-processed", processed, true);
    setNum("fu-kpi-saved", saved, true);
    setNum("fu-kpi-in", tin, true);
    setNum("fu-kpi-out", tout, true);
    setNum("fu-kpi-users", totals.users_with_usage || 0, false);

    const areaEl = $("fu-area");
    const barsEl = $("fu-bars");
    const areaMax = Math.max(1, ...series.areaData.map((d) => d.y));
    const reqMax = Math.max(1, ...series.reqs.map((r) => r.value));
    if (areaEl) {
      kit.renderAreaChart(areaEl, {
        color: "brand",
        variant: "gradient",
        bloom: "aura",
        unit: "tokens",
        tooltipTitle: "Tokens saved",
        yMax: areaMax,
        data: series.areaData,
        interactive: true,
        empty: !series.areaData.some((d) => d.y > 0) && processed <= 0,
        emptyLabel: series.areaData.some((d) => d.y > 0) ? "" : "Monthly totals on claims · daily bars when store days exist",
      });
      kit.startChartDitherLoop(areaEl, {
        kind: "area",
        color: "brand",
        variant: "gradient",
        bloom: "aura",
        data: series.areaData,
        interactive: true,
        yMax: areaMax,
        unit: "tokens",
        tooltipTitle: "Tokens saved",
      });
    }
    if (barsEl) {
      const barOpts = {
        data: series.reqs.map((r) => ({ label: r.label, value: r.value, full: r.full })),
        orientation: "vertical",
        color: "brand",
        variant: "gradient",
        bloom: "aura",
        maxBars: Math.max(8, series.reqs.length),
        progress: 1,
        yMax: reqMax,
        unit: "requests",
        tooltipTitle: "Requests",
        interactive: true,
        empty: !series.reqs.some((r) => r.value > 0),
        emptyLabel: "No daily request rows",
      };
      kit.renderBarChart(barsEl, barOpts);
      kit.startChartDitherLoop(barsEl, { kind: "bar", ...barOpts });
    }

    const esc = data.escapeHtml;
    const board = payload.leaderboard || [];
    const maxIn = Math.max(1, ...board.slice(0, 12).map((r) => r.tokens_in || r.recorded_tokens_in || 0));
    if ($("fu-leaders")) {
      $("fu-leaders").innerHTML = board.length
        ? board
            .slice(0, 12)
            .map((r) => {
              const tinR = r.tokens_in || r.recorded_tokens_in || 0;
              const pct = Math.round((tinR / maxIn) * 100);
              const cut = r.cut_pct || 0;
              return `<li class="rank-row">
                <span class="rank-idx">${r.rank}</span>
                <div class="rank-main">
                  <p class="rank-name">${esc(r.email || r.name || r.uid)}</p>
                  <p class="rank-meta">${esc(r.plan)} · ${kit.formatCompact(r.tokens_saved || r.recorded_tokens_saved)} saved · ${cut}% cut</p>
                  <div class="rank-track"><span class="rank-fill" data-w="${pct}"></span></div>
                </div>
                <div class="rank-val">${kit.formatCompact(tinR)}<small>tokens in</small></div>
              </li>`;
            })
            .join("")
        : `<li class="rank-row"><div class="rank-main"><p class="rank-name">No usage yet</p></div></li>`;
      requestAnimationFrame(() => {
        document.querySelectorAll("#founder-usage .rank-fill").forEach((el) => {
          el.style.width = `${el.getAttribute("data-w")}%`;
        });
      });
    }

    const tbody = $("fu-tbody");
    if (tbody) {
      tbody.innerHTML = board
        .map((r) => {
          const tinR = r.tokens_in || r.recorded_tokens_in || 0;
          const toutR = r.tokens_out || 0;
          const sav = r.tokens_saved || r.recorded_tokens_saved || 0;
          return `<tr>
            <td>${r.rank}</td>
            <td><strong>${esc(r.email)}</strong>${r.name ? `<div class="int-stat-note">${esc(r.name)}</div>` : ""}</td>
            <td>${esc(r.plan)}</td>
            <td>${kit.formatCompact(tinR)}</td>
            <td>${kit.formatCompact(toutR)}</td>
            <td>${kit.formatCompact(sav)}</td>
            <td>${r.cut_pct || 0}%</td>
            <td>${r.requests || r.recorded_requests || 0}</td>
          </tr>`;
        })
        .join("") || `<tr><td colspan="8" class="int-empty">No signed-up users.</td></tr>`;
    }

    const pill = $("fu-data-pill");
    if (pill) {
      pill.className = "an-pill an-pill--live";
      pill.textContent = payload.cached ? "Live · cached" : "Live · all accounts";
    }
  }

  window.SCFounderAnalytics = { paint };
})();
