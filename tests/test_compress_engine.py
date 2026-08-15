"""Unit tests for local compression engine and helpers."""

import pytest
from supercompress import (
    compress_for_turn,
    compress_context,
    CompressResult,
)
from supercompress.__init__ import (
    _extract_query_terms,
    _segment_blocks,
    _score_block,
    _trim_selected_lines,
    _estimate_tokens,
)


def test_compress_for_turn_basic():
    context = (
        "def compute_total(items):\n"
        "    total = 0\n"
        "    for item in items:\n"
        "        total += item.price\n"
        "    return total\n\n"
        "# Unrelated helper\n"
        "def unused_function():\n"
        "    return 'filler'\n"
    )
    result = compress_for_turn(context, user_query="How does compute_total calculate total?", budget_ratio=0.6)
    assert isinstance(result, CompressResult)
    assert "compute_total" in result.compressed_text
    assert result.original_tokens > 0
    assert result.kept_tokens > 0
    assert result.mode == "compiler"
    assert result.policy_name == "local-query-aware"


def test_compress_context_alias():
    context = "Line 1: error in auth\nLine 2: debug trace\nLine 3: success"
    result = compress_context(context, query="Where is the error?", budget_ratio=0.5)
    assert isinstance(result, CompressResult)
    assert "error" in result.compressed_text.lower()


def test_compress_empty_context():
    result = compress_for_turn("", user_query="test query")
    assert result.compressed_text == ""
    assert result.original_tokens == 0
    assert result.kept_tokens == 0
    assert result.tokens_saved_pct == 0.0
    assert result.policy_name == "noop"


def test_compress_invalid_budget_ratio():
    with pytest.raises(ValueError, match="budget_ratio must be in"):
        compress_for_turn("context", "query", budget_ratio=0.0)

    with pytest.raises(ValueError, match="budget_ratio must be in"):
        compress_for_turn("context", "query", budget_ratio=1.5)


def test_compress_context_blocks():
    blocks = [
        "System: You are an expert assistant.",
        "Tool output: user_id=42 authenticated.",
        "Chat history: previous conversation...",
    ]
    result = compress_for_turn(
        context="",
        user_query="What is the user_id?",
        context_blocks=blocks,
        budget_ratio=0.5,
    )
    assert "user_id=42" in result.compressed_text


def test_extract_query_terms():
    terms = _extract_query_terms("What does the compute_payment function return for auth_token?")
    assert "compute_payment" in terms
    assert "auth_token" in terms
    # Stopwords should be filtered out
    assert "what" not in terms
    assert "does" not in terms
    assert "the" not in terms
    assert "for" not in terms


def test_segment_blocks():
    lines = [
        "block 1 line 1",
        "block 1 line 2",
        "",
        "block 2 line 1",
        "",
        "",
        "block 3 line 1",
    ]
    blocks = _segment_blocks(lines)
    assert len(blocks) == 3
    assert blocks[0] == (0, 1)
    assert blocks[1] == (3, 3)
    assert blocks[2] == (6, 6)


def test_score_block():
    block_lines = ["def process_transaction(tx):", "    validate(tx)", "    return save(tx)"]
    query_terms = ["transaction", "process"]
    score = _score_block(
        block_lines=block_lines,
        query_terms=query_terms,
        block_index=0,
        total_blocks=2,
        start=0,
        end=2,
        total_lines=6,
    )
    assert score > 1.0


def test_estimate_tokens():
    text = "Hello world! This is a test of token estimation."
    tokens = _estimate_tokens(text)
    assert tokens == len(text) // 4
    assert _estimate_tokens("") == 1


def test_precision_mode_requires_api_key(monkeypatch):
    monkeypatch.delenv("SUPERCOMPRESS_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match='mode="precision" requires SUPERCOMPRESS_API_KEY'):
        compress_for_turn("context", "query", mode="precision")
