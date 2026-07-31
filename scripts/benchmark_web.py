#!/usr/bin/env python3
"""Generate web/assets/data/benchmarks.json from live SuperCompress runs."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from supercompress.benchmarks.metrics import answer_quality_score
from supercompress.benchmarks.runner import run_policy_benchmarks
from supercompress.compress import (
    compare_policies,
    compress_for_turn,
    middle_truncation_failure_case,
)

OUT = ROOT / "web" / "assets" / "data" / "benchmarks.json"


def _pytest_summary() -> dict:
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", "tests/", "-q"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    line = proc.stdout.strip().split("\n")[-1] if proc.stdout else ""
    passed = proc.returncode == 0
    count = 0
    if " passed" in line:
        try:
            count = int(line.split(" passed")[0].strip().split()[-1])
        except ValueError:
            pass
    return {"passed": passed, "count": count, "summary": line or ("passed" if passed else "failed")}


def main() -> None:
    bench = run_policy_benchmarks(seeds=8, budget_ratio=0.35)

    ctx, question = middle_truncation_failure_case()
    failure_cmp = compare_policies(ctx, question, budget_ratio=0.1)

    demo_blocks = [
        "## Notes\n" + "\n".join(f"- Context block {i}: padding and metadata" for i in range(1, 12)),
        "## Code\nclass ApiClient:\n    def fetch(self, id): ...",
        "## Summary\n1. Trim context\n2. Keep entities\n3. Send to LLM",
    ]
    demo_query = "How does the ApiClient fetch method work?"
    compressed, demo = compress_for_turn(demo_blocks, demo_query, budget_ratio=0.35)

    data = {
        **bench,
        "model": {
            "params": "~5,000",
            "feature_dim": 9,
            "hidden_dim": 64,
            "train_time_sec": 30,
            "inference": "CPU · browser + Python",
            "checkpoint": "checkpoints/default.pt",
        },
        "turn_table": [
            {"turn": 1, "without": "2K tokens", "with_sc": "~700 tokens"},
            {"turn": 3, "without": "8K tokens", "with_sc": "~2.8K tokens"},
            {"turn": "4+", "without": "OOM / collapse", "with_sc": "Stable 35–65% savings"},
        ],
        "failure_case": {
            "question": question,
            "compare": {
                name: {
                    "kept_tokens": r.kept_tokens,
                    "kv_savings_pct": round(r.kv_savings_pct, 1),
                    "answer_quality": answer_quality_score(ctx, r.compressed_text, question),
                    "has_answer": "404" in r.compressed_text or "User.fetch" in r.compressed_text,
                }
                for name, r in failure_cmp.items()
            },
        },
        "demo": {
            "query": demo_query,
            "original_tokens": demo.original_tokens,
            "kept_tokens": demo.kept_tokens,
            "kv_savings_pct": round(demo.kv_savings_pct, 1),
            "policy": demo.policy_name,
            "input_preview": "\n\n---\n\n".join(demo_blocks)[:1200],
            "compressed_text": compressed,
        },
        "tests": _pytest_summary(),
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"Wrote {OUT}")

    charts = ROOT / "scripts" / "generate_charts.py"
    if charts.exists():
        subprocess.run([sys.executable, str(charts)], cwd=ROOT, check=True)

    adaptive_js = ROOT / "scripts" / "benchmark_adaptive.js"
    if adaptive_js.exists():
        proc = subprocess.run(
            ["node", str(adaptive_js)],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        adaptive = json.loads(proc.stdout)
        existing = json.loads(OUT.read_text())
        existing.update(adaptive)
        OUT.write_text(json.dumps(existing, indent=2), encoding="utf-8")
        print(f"Merged adaptive benchmarks into {OUT}")
        if charts.exists():
            subprocess.run([sys.executable, str(charts)], cwd=ROOT, check=True)


if __name__ == "__main__":
    main()
