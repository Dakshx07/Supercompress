#!/usr/bin/env python3
"""Compare FIFO vs SuperCompress on long synthetic context."""

from __future__ import annotations

from supercompress import compare_policies, compress_for_turn

NOTES = """## Session notes
- User asked about fetch() behavior when rows are missing
- Prior attempts used head/tail truncation and lost the answer line
- Need to preserve function definitions and entity matches
"""

CODE = """## api/client.py
class ApiClient:
    def fetch(self, row_id: int):
        row = self.db.get(row_id)
        if row is None:
            return None
        return row.to_dict()
"""

SUMMARY = """## Summary
1. Compress context before LLM inference
2. Keep entity-bearing lines under budget
3. Log kv_savings_pct each call
"""


def main() -> None:
    blocks = [NOTES, CODE, SUMMARY]
    query = "What does fetch return when the row is missing?"

    print("SuperCompress — policy comparison\n")
    print(f"Question: {query}\n")

    merged = "\n\n---\n\n".join(blocks)
    cmp = compare_policies(merged, query, budget_ratio=0.35)

    for name, result in cmp.items():
        print(f"── {name} ({result.policy_name})")
        print(f"   tokens: {result.original_tokens} → {result.kept_tokens}")
        print(f"   KV savings: {result.kv_savings_pct:.1f}%")
        print()

    compressed, stats = compress_for_turn(blocks, query)
    print("── compress_for_turn()")
    print(f"   policy: {stats.policy_name}")
    print(f"   KV savings: {stats.kv_savings_pct:.1f}%")
    print(f"   preview: {compressed[:200].replace(chr(10), ' ')}…")


if __name__ == "__main__":
    main()
