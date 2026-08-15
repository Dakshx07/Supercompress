"""Unit tests for asynchronous AsyncSuperCompress client."""

import asyncio
import json
import pytest
import httpx
from supercompress.client import AsyncSuperCompress, COMPRESS_ENDPOINT, RETRIEVE_ENDPOINT
from supercompress.result import CompressResult


def test_async_client_missing_api_key(monkeypatch):
    monkeypatch.delenv("SUPERCOMPRESS_API_KEY", raising=False)
    with pytest.raises(ValueError, match="SuperCompress API key required"):
        AsyncSuperCompress()


def test_async_client_init_with_env(monkeypatch):
    async def _test():
        monkeypatch.setenv("SUPERCOMPRESS_API_KEY", "sc_live_async123")
        sc = AsyncSuperCompress()
        assert sc.api_key == "sc_live_async123"
        assert sc.base_url == "https://www.supercompress.dev"
        await sc.aclose()

    asyncio.run(_test())


def test_async_client_compress_success():
    async def _test():
        def mock_handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path == COMPRESS_ENDPOINT
            assert request.headers["X-API-Key"] == "sc_live_testasync"
            body = json.loads(request.content.decode("utf-8"))
            assert body["context"] == "async context to compress"
            assert body["query"] == "how does it work?"

            return httpx.Response(
                200,
                json={
                    "compressed_text": "async compressed text",
                    "original_tokens": 1200,
                    "kept_tokens": 400,
                    "tokens_saved": 800,
                    "tokens_saved_pct": 66.7,
                    "kept_line_ratio": 0.33,
                    "policy_name": "supercompress",
                    "mode": "compiler",
                    "keep_ratio": 0.35,
                    "cache_prefix_applied": False,
                },
            )

        sc = AsyncSuperCompress(api_key="sc_live_testasync")
        sc._client = httpx.AsyncClient(
            base_url=sc.base_url,
            headers={"X-API-Key": sc.api_key},
            transport=httpx.MockTransport(mock_handler),
        )

        async with sc:
            result = await sc.compress(
                context="async context to compress",
                query="how does it work?",
                mode="compiler",
            )

        assert isinstance(result, CompressResult)
        assert result.compressed_text == "async compressed text"
        assert result.original_tokens == 1200
        assert result.kept_tokens == 400
        assert result.tokens_saved == 800
        assert result.tokens_saved_pct == 66.7

    asyncio.run(_test())


def test_async_client_retrieve():
    async def _test():
        def mock_handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path == RETRIEVE_ENDPOINT
            assert request.url.params["hash"] == "hash123_45"
            return httpx.Response(
                200,
                json={"original": "async original recovered"},
            )

        sc = AsyncSuperCompress(api_key="sc_live_testasync")
        sc._client = httpx.AsyncClient(
            base_url=sc.base_url,
            headers={"X-API-Key": sc.api_key},
            transport=httpx.MockTransport(mock_handler),
        )

        async with sc:
            res = await sc.retrieve("hash123_45")
            assert res == "async original recovered"

            res_kw = await sc.retrieve(ccr_hash="hash123_45")
            assert res_kw == "async original recovered"

    asyncio.run(_test())


def test_async_client_retrieve_404():
    async def _test():
        def mock_handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(404, json={"detail": "Not found"})

        sc = AsyncSuperCompress(api_key="sc_live_testasync")
        sc._client = httpx.AsyncClient(
            base_url=sc.base_url,
            headers={"X-API-Key": sc.api_key},
            transport=httpx.MockTransport(mock_handler),
        )

        async with sc:
            res = await sc.retrieve("missing_hash")

        assert res is None

    asyncio.run(_test())


def test_async_client_http_error():
    async def _test():
        def mock_handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(500, json={"detail": "Internal server error"})

        sc = AsyncSuperCompress(api_key="sc_live_testasync")
        sc._client = httpx.AsyncClient(
            base_url=sc.base_url,
            headers={"X-API-Key": sc.api_key},
            transport=httpx.MockTransport(mock_handler),
        )

        async with sc:
            with pytest.raises(httpx.HTTPStatusError):
                await sc.compress("context", "query")

    asyncio.run(_test())


def test_async_client_disables_redirects():
    async def _test():
        sc = AsyncSuperCompress(api_key="sc_live_testasync")
        assert sc._client.follow_redirects is False
        await sc.aclose()

    asyncio.run(_test())
