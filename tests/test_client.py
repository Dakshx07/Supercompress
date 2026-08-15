"""Unit tests for synchronous SuperCompress client."""

import json
import pytest
import httpx
from supercompress.client import SuperCompress, COMPRESS_ENDPOINT, RETRIEVE_ENDPOINT
from supercompress.result import CompressResult


def test_client_missing_api_key(monkeypatch):
    monkeypatch.delenv("SUPERCOMPRESS_API_KEY", raising=False)
    with pytest.raises(ValueError, match="SuperCompress API key required"):
        SuperCompress()


def test_client_init_with_env(monkeypatch):
    monkeypatch.setenv("SUPERCOMPRESS_API_KEY", "sc_live_env123")
    sc = SuperCompress()
    assert sc.api_key == "sc_live_env123"
    assert sc.base_url == "https://www.supercompress.dev"
    sc.close()


def test_client_compress_success():
    def mock_handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == COMPRESS_ENDPOINT
        assert request.headers["X-API-Key"] == "sc_live_testkey"
        body = json.loads(request.content.decode("utf-8"))
        assert body["context"] == "line1\nline2\nline3"
        assert body["query"] == "test query"
        assert body["mode"] == "precision"

        return httpx.Response(
            200,
            json={
                "compressed_text": "kept key lines",
                "original_tokens": 1000,
                "kept_tokens": 350,
                "tokens_saved": 650,
                "tokens_saved_pct": 65.0,
                "kept_line_ratio": 0.35,
                "policy_name": "supercompress",
                "mode": "precision",
                "keep_ratio": 0.35,
                "cache_prefix_applied": False,
            },
        )

    sc = SuperCompress(api_key="sc_live_testkey")
    sc._client = httpx.Client(
        base_url=sc.base_url,
        headers={"X-API-Key": sc.api_key},
        transport=httpx.MockTransport(mock_handler),
    )

    with sc:
        result = sc.compress(
            context="line1\nline2\nline3",
            query="test query",
            mode="precision",
            budget_ratio=0.35,
        )

    assert isinstance(result, CompressResult)
    assert result.compressed_text == "kept key lines"
    assert result.original_tokens == 1000
    assert result.kept_tokens == 350
    assert result.tokens_saved == 650
    assert result.tokens_saved_pct == 65.0
    assert result.mode == "precision"


def test_client_retrieve_found():
    def mock_handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == RETRIEVE_ENDPOINT
        assert request.url.params["hash"] == "a1b2c3d4_20"
        return httpx.Response(200, json={"original": "retrieved original text"})

    sc = SuperCompress(api_key="sc_live_testkey")
    sc._client = httpx.Client(
        base_url=sc.base_url,
        headers={"X-API-Key": sc.api_key},
        transport=httpx.MockTransport(mock_handler),
    )

    res = sc.retrieve("a1b2c3d4_20")
    sc.close()
    assert res == "retrieved original text"


def test_client_retrieve_404():
    def mock_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"detail": "Not found"})

    sc = SuperCompress(api_key="sc_live_testkey")
    sc._client = httpx.Client(
        base_url=sc.base_url,
        headers={"X-API-Key": sc.api_key},
        transport=httpx.MockTransport(mock_handler),
    )

    res = sc.retrieve("non_existent_hash")
    sc.close()
    assert res is None


def test_client_compress_http_error():
    def mock_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"detail": "Unauthorized API key"})

    sc = SuperCompress(api_key="sc_live_invalid")
    sc._client = httpx.Client(
        base_url=sc.base_url,
        headers={"X-API-Key": sc.api_key},
        transport=httpx.MockTransport(mock_handler),
    )

    with sc:
        with pytest.raises(httpx.HTTPStatusError):
            sc.compress("context", "query")
