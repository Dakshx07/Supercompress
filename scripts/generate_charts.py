#!/usr/bin/env python3
"""Generate SVG benchmark charts from benchmarks.json for the website."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BENCH = ROOT / "web" / "assets" / "data" / "benchmarks.json"
OUT = ROOT / "web" / "assets" / "img"


def _bar_chart(
    title: str,
    labels: list[str],
    values: list[float],
    ymax: float,
    unit: str,
    highlight: str = "SuperCompress",
    colors: dict | None = None,
) -> str:
    w, h = 920, 320
    ml, mr, mt, mb = 60, 24, 48, 56
    cw = w - ml - mr
    ch = h - mt - mb
    n = len(labels)
    bar_w = cw / max(n, 1) * 0.55
    default = colors or {}
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" role="img" aria-label="{title}">',
        f'<rect width="{w}" height="{h}" rx="16" fill="#fafafa" stroke="#e5e7eb"/>',
        f'<text x="{ml}" y="32" font-family="system-ui,sans-serif" '
        f'font-size="16" font-weight="600" fill="#0f172a">{title}</text>',
    ]
    for i in range(5):
        y = mt + ch - (ch / 4) * i
        val = ymax / 4 * i
        parts.append(f'<line x1="{ml}" y1="{y:.1f}" x2="{w - mr}" y2="{y:.1f}" stroke="#e5e7eb"/>')
        parts.append(
            f'<text x="{ml - 8}" y="{y + 4:.1f}" text-anchor="end" '
            f'font-size="10" fill="#64748b">{val:.0f}{unit}</text>'
        )
    for i, (lab, val) in enumerate(zip(labels, values)):
        x = ml + (i + 0.5) * (cw / n) - bar_w / 2
        bh = (val / ymax) * ch if ymax else 0
        y = mt + ch - bh
        fill = default.get(lab, "#2563eb" if lab == highlight else "#93c5fd")
        if lab == highlight:
            fill = "#2563eb"
        elif lab in ("Truncation", "FIFO"):
            fill = "#cbd5e1"
        parts.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{bar_w:.1f}" height="{bh:.1f}" rx="6" fill="{fill}"/>')
        parts.append(
            f'<text x="{x + bar_w/2:.1f}" y="{h - 28}" text-anchor="middle" '
            f'font-size="11" fill="#334155">{lab}</text>'
        )
        parts.append(
            f'<text x="{x + bar_w/2:.1f}" y="{y - 6:.1f}" text-anchor="middle" '
            f'font-size="10" fill="#1e40af">{val:.1f}{unit}</text>'
        )
    parts.append("</svg>")
    return "\n".join(parts)


def _impact_chart(tokens_m: float, kwh: float, co2_kg: float) -> str:
    w, h = 920, 280
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}"
  role="img" aria-label="Environmental impact projection">
  <rect width="{w}" height="{h}" rx="16" fill="#f0fdf4" stroke="#bbf7d0"/>
  <text x="40" y="40" font-family="system-ui,sans-serif" font-size="16"
    font-weight="600" fill="#14532d">1M compressions × ~{tokens_m:.0f}K tokens saved (avg)</text>
  <g font-family="system-ui,sans-serif">
    <rect x="40" y="70" width="250" height="160" rx="12" fill="#fff" stroke="#86efac"/>
    <text x="165" y="110" text-anchor="middle" font-size="28" font-weight="600" fill="#15803d">{tokens_m:.0f}M</text>
    <text x="165" y="135" text-anchor="middle" font-size="12" fill="#166534">tokens avoided</text>
    <rect x="335" y="70" width="250" height="160" rx="12" fill="#fff" stroke="#86efac"/>
    <text x="460" y="110" text-anchor="middle" font-size="28" font-weight="600" fill="#15803d">{kwh:.1f}</text>
    <text x="460" y="135" text-anchor="middle" font-size="12" fill="#166534">kWh saved (est.)</text>
    <rect x="630" y="70" width="250" height="160" rx="12" fill="#fff" stroke="#86efac"/>
    <text x="755" y="110" text-anchor="middle" font-size="28" font-weight="600" fill="#15803d">{co2_kg:.1f}</text>
    <text x="755" y="135" text-anchor="middle" font-size="12" fill="#166534">kg CO₂ avoided (est.)</text>
  </g>
  <text x="40" y="260" font-size="11" fill="#64748b">
    Assumptions: 2,500 tok/GPU-s · 150W GPU · 0.417 kg CO₂/kWh · 55% KV share
  </text>
</svg>'''


def main() -> None:
    if not BENCH.exists():
        print(f"Missing {BENCH} — run scripts/benchmark_web.py first", file=sys.stderr)
        raise SystemExit(1)
    data = json.loads(BENCH.read_text())
    summary = data.get("summary", {})
    order = [k for k in ("FIFO", "Truncation", "Summarization", "H2O", "SuperCompress") if k in summary]

    kv = [summary[k]["avg_tokens_saved_pct"] for k in order]
    quality = [summary[k]["avg_answer_quality"] * 100 for k in order]
    oracle = [summary[k]["avg_oracle_recall"] * 100 for k in order]
    # Useful retention = KV savings × oracle recall (both 0–1 scale on recall).
    useful = [round(summary[k]["avg_tokens_saved_pct"] * summary[k]["avg_oracle_recall"], 1) for k in order]

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "chart-kv-savings.svg").write_text(
        _bar_chart("Useful context retained by policy", order, useful, 70, "%"), encoding="utf-8"
    )
    (OUT / "chart-answer-quality.svg").write_text(
        _bar_chart("Answer quality proxy by policy", order, quality, 100, "%"), encoding="utf-8"
    )
    (OUT / "chart-oracle-recall.svg").write_text(
        _bar_chart("Critical context retained at 35% budget", order, oracle, 100, "%"), encoding="utf-8"
    )

    adaptive = data.get("adaptive", {})
    if adaptive.get("presets"):
        labels = [adaptive["presets"][k]["label"] for k in adaptive["presets"]]
        values = [adaptive["presets"][k]["tokens_saved_pct"] for k in adaptive["presets"]]
        ymax = max(max(values) * 1.1, 100)
        (OUT / "chart-adaptive-savings.svg").write_text(
            _bar_chart(
                "Adaptive KV savings on long-context presets",
                labels,
                values,
                ymax,
                "%",
                highlight="",
                colors={lab: "#2563eb" for lab in labels},
            ),
            encoding="utf-8",
        )

    from supercompress.benchmarks.metrics import sustainability_from_tokens_saved

    avg_removed = adaptive.get("summary", {}).get("avg_tokens_removed", 800)
    sus = sustainability_from_tokens_saved(1_000_000 * avg_removed)
    (OUT / "chart-impact.svg").write_text(
        _impact_chart(avg_removed, sus.watt_hours_saved / 1000, sus.co2_kg_avoided),
        encoding="utf-8",
    )
    print(f"Wrote charts to {OUT}")


if __name__ == "__main__":
    main()
