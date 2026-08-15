"""Unit tests for CompressResult dataclass."""

from supercompress.result import CompressResult


def test_compress_result_defaults():
    res = CompressResult(
        compressed_text="compressed output",
        original_tokens=100,
        kept_tokens=35,
    )
    assert res.tokens_saved == 65
    assert res.savings_pct == 65.0
    assert res.kv_savings_pct == 0.0  # default tokens_saved_pct was 0.0 unless set
    assert res.policy_name == "supercompress"
    assert res.mode == "compiler"


def test_compress_result_to_dict():
    res = CompressResult(
        compressed_text="sample text",
        original_tokens=200,
        kept_tokens=80,
        tokens_saved_pct=60.0,
        policy_name="supercompress",
        mode="precision",
        keep_ratio=0.4,
        kept_line_ratio=0.5,
        cache_prefix_applied=True,
    )
    d = res.to_dict()
    assert d["compressed_text"] == "sample text"
    assert d["original_tokens"] == 200
    assert d["kept_tokens"] == 80
    assert d["tokens_saved"] == 120
    assert d["savings_pct"] == 60.0
    assert d["tokens_saved_pct"] == 60.0
    assert d["kv_savings_pct"] == 60.0
    assert d["mode"] == "precision"
    assert d["cache_prefix_applied"] is True


def test_compress_result_zero_tokens():
    res = CompressResult(compressed_text="", original_tokens=0, kept_tokens=0)
    assert res.savings_pct == 0.0
    assert res.tokens_saved == 0
