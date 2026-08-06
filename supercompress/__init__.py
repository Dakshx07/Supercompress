"""
SuperCompress — prompt compression for LLM applications.

Compress long context windows into their most token-efficient form
while preserving answer quality. Works as a standalone library, an
LLM SDK middleware layer, a browser-side engine, and an MCP server.

Typical usage:

    from supercompress import compress_for_turn

    compressed, stats = compress_for_turn(
        context_blocks=[system_prompt, tool_outputs, chat_history],
        user_query=user_message,
        budget_ratio=0.35,
    )
    # Send `compressed` to your LLM instead of the full context.

For the hosted API (API key required):

    from supercompress.client import SuperCompress

    sc = SuperCompress(api_key="sc_live_...")
    result = sc.compress(context, query, mode="precision")
"""

from __future__ import annotations

import os
import re
import warnings
from dataclasses import dataclass
from typing import Any, Optional

__version__ = "0.6.1"

_QUERY_STOPWORDS = {
    "what",
    "how",
    "does",
    "do",
    "the",
    "is",
    "are",
    "was",
    "were",
    "why",
    "when",
    "where",
    "which",
    "who",
    "whom",
    "whose",
    "function",
    "return",
    "returns",
    "returning",
    "class",
    "def",
    "import",
    "from",
    "this",
    "that",
    "with",
    "into",
    "about",
    "for",
    "and",
    "or",
    "of",
    "to",
}

# ── Data types ──────────────────────────────────────────────────────


@dataclass
class CompressResult:
    """Result of a local compression operation.

    ``tokens_saved_pct`` is percent of prompt tokens removed:
    ``(1 - kept/original) * 100``.
    """

    compressed_text: str
    original_tokens: int = 0
    kept_tokens: int = 0
    tokens_saved_pct: float = 0.0
    policy_name: str = "supercompress"
    mode: str = "compiler"
    keep_ratio: float = 0.35
    compression_risk: Optional[float] = None
    confidence: Optional[float] = None
    ccr: Optional[dict[str, Any]] = None

    @property
    def tokens_saved(self) -> int:
        return max(0, self.original_tokens - self.kept_tokens)

    @property
    def savings_pct(self) -> float:
        if self.original_tokens == 0:
            return 0.0
        return (1 - self.kept_tokens / self.original_tokens) * 100

    @property
    def kv_savings_pct(self) -> float:
        """Deprecated alias of tokens_saved_pct."""
        return self.tokens_saved_pct

    def to_dict(self) -> dict[str, Any]:
        return {
            "compressed_text": self.compressed_text,
            "original_tokens": self.original_tokens,
            "kept_tokens": self.kept_tokens,
            "tokens_saved": self.tokens_saved,
            "savings_pct": round(self.savings_pct, 1),
            "tokens_saved_pct": self.tokens_saved_pct,
            "kv_savings_pct": self.tokens_saved_pct,  # deprecated alias
            "policy_name": self.policy_name,
            "mode": self.mode,
            "keep_ratio": self.keep_ratio,
            "compression_risk": self.compression_risk,
            "confidence": self.confidence,
            "ccr": self.ccr,
        }


# ── Local compression engine ────────────────────────────────────────


def compress_for_turn(
    context: str,
    user_query: str,
    context_blocks: Optional[list[str]] = None,
    budget_ratio: float = 0.35,
    mode: str = "compiler",
) -> CompressResult:
    """
    Compress a conversation turn using a lightweight, query-aware local
    fallback.

    The local fallback keeps a compact set of blocks that are most likely
    to matter for the current query. It is intentionally simple, but it is
    no longer blind head/tail truncation.

    Args:
        context: Full context to compress (lines of text).
        user_query: The current user question (kept intact).
        context_blocks: Alternative to ``context`` — pass a list of blocks.
        budget_ratio: Fraction of tokens to keep (0.0–1.0). Default 0.35.
        mode: ``"compiler"`` for maximum reduction, ``"precision"`` for
              quality-guaranteed compression (uses hosted API if available).

    Returns:
        A :class:`CompressResult` with the compressed text and statistics.
    """
    if context_blocks:
        context = "\n".join(context_blocks)

    lines = context.split("\n")
    n = len(lines)
    keep = min(n, max(1, int(round(n * budget_ratio))))

    if n == 0:
        compressed = user_query
        return CompressResult(
            compressed_text=compressed,
            original_tokens=0,
            kept_tokens=0,
            tokens_saved_pct=0.0,
            policy_name="local-query-aware",
            mode=mode,
            keep_ratio=budget_ratio,
        )

    query_terms = _extract_query_terms(user_query)
    blocks = _segment_blocks(lines)
    scored_blocks = []
    for block_index, (start, end) in enumerate(blocks):
        block_lines = lines[start : end + 1]
        score = _score_block(block_lines, query_terms, block_index, len(blocks), start, end, n)
        scored_blocks.append((score, start, end, block_lines))

    scored_blocks.sort(key=lambda item: (-item[0], item[1]))

    selected: list[tuple[int, int, list[str]]] = []
    used = 0
    for score, start, end, block_lines in scored_blocks:
        block_len = len(block_lines)
        if selected and used + block_len > keep and used >= max(1, keep // 2):
            continue
        selected.append((start, end, block_lines))
        used += block_len
        if used >= keep:
            break

    if not selected:
        selected = [(0, min(n - 1, keep - 1), lines[:keep])]

    selected.sort(key=lambda item: item[0])
    kept_lines = [line for _, _, block_lines in selected for line in block_lines]

    if len(kept_lines) > keep:
        kept_lines = _trim_selected_lines(kept_lines, query_terms, keep)

    original_tokens = _estimate_tokens(context)
    kept_tokens = _estimate_tokens("\n".join(kept_lines))
    savings = round((1 - kept_tokens / max(original_tokens, 1)) * 100, 1)

    compressed = "\n".join(kept_lines) + "\n\n---\n\n" + user_query
    return CompressResult(
        compressed_text=compressed,
        original_tokens=original_tokens,
        kept_tokens=kept_tokens,
        tokens_saved_pct=savings,
        policy_name="local-query-aware",
        mode=mode,
        keep_ratio=budget_ratio,
    )



def _estimate_tokens(text: str) -> int:
    """Rough token estimate (~4 chars per token)."""
    return max(1, len(text) // 4)


def _extract_query_terms(user_query: str) -> list[str]:
    terms: list[str] = []
    seen: set[str] = set()
    for raw in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", user_query or ""):
        term = raw.lower()
        if len(term) <= 2 or term in _QUERY_STOPWORDS or term in seen:
            continue
        seen.add(term)
        terms.append(term)
    return terms


def _segment_blocks(lines: list[str]) -> list[tuple[int, int]]:
    blocks: list[tuple[int, int]] = []
    start: Optional[int] = None
    for idx, line in enumerate(lines):
        if line.strip():
            if start is None:
                start = idx
        elif start is not None:
            blocks.append((start, idx - 1))
            start = None
    if start is not None:
        blocks.append((start, len(lines) - 1))
    return blocks or [(0, len(lines) - 1)]


def _score_block(
    block_lines: list[str],
    query_terms: list[str],
    block_index: int,
    total_blocks: int,
    start: int,
    end: int,
    total_lines: int,
) -> float:
    score = 0.0
    first_line = block_lines[0].strip() if block_lines else ""
    block_text = "\n".join(block_lines)
    lower_text = block_text.lower()

    if start == 0:
        score += 0.25
    if end >= total_lines - 1:
        score += 0.25
    if block_index == 0 or block_index == max(0, total_blocks - 1):
        score += 0.15

    if first_line.startswith("#"):
        score += 0.8
    if re.match(r"^(def|class|async\s+def|function|const|let|var|public|private|protected|static)\b", first_line):
        score += 0.8
    if re.match(r"^(\d+\.|[-*+])\s+", first_line):
        score += 0.25
    if re.match(r"^(traceback|error|exception|failed|timeout|denied|invalid)\b", lower_text):
        score += 0.35

    if query_terms:
        hits = sum(1 for term in query_terms if term in lower_text)
        score += hits * 1.8
        for term in query_terms:
            if first_line and term in first_line.lower():
                score += 0.9
    else:
        score += 0.05

    if len(block_lines) > 6 and not query_terms:
        score -= 0.15

    return score


def _trim_selected_lines(kept_lines: list[str], query_terms: list[str], keep: int) -> list[str]:
    if len(kept_lines) <= keep:
        return kept_lines

    scored = []
    total = len(kept_lines)
    for idx, line in enumerate(kept_lines):
        score = 0.0
        lower = line.lower()
        if idx == 0:
            score += 0.25
        if idx == total - 1:
            score += 0.25
        if line.strip().startswith("#"):
            score += 0.6
        if re.match(r"^(def|class|async\s+def|function|const|let|var|public|private|protected|static)\b", line.strip()):
            score += 0.6
        for term in query_terms:
            if term in lower:
                score += 1.6
        scored.append((score, idx, line))

    scored.sort(key=lambda item: (-item[0], item[1]))
    chosen = sorted(idx for _, idx, _ in scored[:keep])
    return [kept_lines[i] for i in chosen]


def compress_context(
    text: str,
    query: str,
    budget_ratio: float = 0.35,
) -> CompressResult:
    """Alias for :func:`compress_for_turn` with a single context string."""
    return compress_for_turn(text, query, budget_ratio=budget_ratio)


# ── Public API ──────────────────────────────────────────────────────

from .client import SuperCompress

__all__ = [
    "compress_for_turn",
    "compress_context",
    "CompressResult",
    "SuperCompress",
    "__version__",
]

if not os.getenv("SUPERCOMPRESS_API_KEY"):
    warnings.warn(
        "No SUPERCOMPRESS_API_KEY set - using the local fallback engine. "
        "Results may be degraded. Get a free API key at https://supercompress.dev/dashboard",
        RuntimeWarning,
        stacklevel=2,
    )
