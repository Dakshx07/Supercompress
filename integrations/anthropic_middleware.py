"""
SuperCompress Anthropic SDK Middleware

Transparent compression for Anthropic/Claude API calls.
Wraps the Anthropic Python SDK (both sync Anthropic and AsyncAnthropic)
to compress context before sending.

Installation:
    pip install supercompress anthropic

Usage:
    from anthropic_middleware import SuperCompressAnthropic, AsyncSuperCompressAnthropic

    # Synchronous client
    client = SuperCompressAnthropic(api_key="sk-ant-...")

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system="You are a helpful assistant.",
        messages=[
            {"role": "user", "content": long_context},
            {"role": "assistant", "content": "Previous response..."},
            {"role": "user", "content": "Follow-up question..."},
        ],
    )

    # Asynchronous client
    async_client = AsyncSuperCompressAnthropic(api_key="sk-ant-...")
    response = await async_client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        messages=[...],
    )
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

from anthropic import Anthropic, AsyncAnthropic

from supercompress import compress_for_turn

logger = logging.getLogger("supercompress")


def _extract_text_content(content: Any) -> str:
    """Extract plain text from string or structured content blocks."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
            elif isinstance(block, str):
                parts.append(block)
        return " ".join(parts)
    return str(content or "")


def _compress_anthropic_messages(
    messages: list[dict], budget_ratio: float, tracker: Any
) -> list[dict]:
    """Compress conversation history, preserving latest user message (including multimodal blocks)."""
    # Anthropic passes the system prompt via `system=`, so it never reaches here.
    if len(messages) <= 1:
        return messages

    # Last message should be from user
    last_msg = messages[-1]
    if last_msg.get("role") != "user":
        return messages

    history = messages[:-1]
    raw_content = last_msg.get("content", "")
    query = _extract_text_content(raw_content)

    # History only — keep Anthropic `system=` wholly outside compression.
    context_parts = []
    for msg in history:
        content = _extract_text_content(msg.get("content", ""))
        context_parts.append(f"[{msg.get('role', 'user')}] {content}")

    context = "\n".join(context_parts)

    # Compress
    result = compress_for_turn(context, query, budget_ratio=budget_ratio)

    tracker.total_original_tokens += result.original_tokens
    tracker.total_kept_tokens += result.kept_tokens

    logger.info(
        f"SuperCompress [Anthropic]: {result.original_tokens}→{result.kept_tokens} tok "
        f"({result.tokens_saved_pct:.1f}% saved)"
    )

    # Rebuild — query appended once (compress_for_turn does not include it).
    compressed_text_block = (
        f"[SuperCompress: {result.original_tokens}→{result.kept_tokens} tok, "
        f"{result.tokens_saved_pct:.1f}% saved]\n\n"
        f"{result.compressed_text}\n\n---\n\n{query}"
    )

    if isinstance(raw_content, list):
        # Preserve non-text multimodal items (image, document, audio)
        new_content: list[Any] = [{"type": "text", "text": compressed_text_block}]
        for part in raw_content:
            if isinstance(part, dict) and part.get("type") != "text":
                new_content.append(part)
    else:
        new_content = compressed_text_block

    return [{"role": "user", "content": new_content}]


class SuperCompressAnthropic:
    """Anthropic client wrapper with automatic prompt compression."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        budget_ratio: float = 0.35,
        **kwargs: Any,
    ):
        """Initialize SuperCompressAnthropic client."""
        self._client = Anthropic(api_key=api_key or os.getenv("ANTHROPIC_API_KEY"), **kwargs)
        self.budget_ratio = budget_ratio
        self.total_original_tokens = 0
        self.total_kept_tokens = 0

    @property
    def messages(self) -> _MessagesWrapper:
        """Access messages interface."""
        return _MessagesWrapper(self)

    def _compress_messages(self, messages: list[dict]) -> list[dict]:
        return _compress_anthropic_messages(messages, self.budget_ratio, self)

    def get_stats(self) -> dict[str, Any]:
        """Return cumulative compression statistics."""
        return {
            "total_original_tokens": self.total_original_tokens,
            "total_kept_tokens": self.total_kept_tokens,
            "total_savings_pct": (
                (1 - self.total_kept_tokens / max(self.total_original_tokens, 1)) * 100
                if self.total_original_tokens > 0
                else 0
            ),
        }

    def close(self) -> None:
        """Close underlying Anthropic client."""
        self._client.close()

    def __enter__(self) -> "SuperCompressAnthropic":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()


class _MessagesWrapper:
    """Wrapper for Anthropic messages namespace."""

    def __init__(self, parent: SuperCompressAnthropic):
        self._parent = parent

    def create(self, **kwargs: Any) -> Any:
        """Create an Anthropic message with compressed context."""
        if "messages" in kwargs:
            kwargs["messages"] = self._parent._compress_messages(kwargs["messages"])
        return self._parent._client.messages.create(**kwargs)


class AsyncSuperCompressAnthropic:
    """Async Anthropic client wrapper with automatic prompt compression."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        budget_ratio: float = 0.35,
        **kwargs: Any,
    ):
        """Initialize AsyncSuperCompressAnthropic client."""
        self._client = AsyncAnthropic(api_key=api_key or os.getenv("ANTHROPIC_API_KEY"), **kwargs)
        self.budget_ratio = budget_ratio
        self.total_original_tokens = 0
        self.total_kept_tokens = 0

    @property
    def messages(self) -> _AsyncMessagesWrapper:
        """Access async messages interface."""
        return _AsyncMessagesWrapper(self)

    def _compress_messages(self, messages: list[dict]) -> list[dict]:
        return _compress_anthropic_messages(messages, self.budget_ratio, self)

    def get_stats(self) -> dict[str, Any]:
        """Return cumulative compression statistics."""
        return {
            "total_original_tokens": self.total_original_tokens,
            "total_kept_tokens": self.total_kept_tokens,
            "total_savings_pct": (
                (1 - self.total_kept_tokens / max(self.total_original_tokens, 1)) * 100
                if self.total_original_tokens > 0
                else 0
            ),
        }

    async def aclose(self) -> None:
        """Close underlying AsyncAnthropic client connection pool."""
        await self._client.close()

    async def close(self) -> None:
        """Close underlying AsyncAnthropic client connection pool."""
        await self._client.close()

    async def __aenter__(self) -> "AsyncSuperCompressAnthropic":
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.aclose()


class _AsyncMessagesWrapper:
    """Wrapper for async Anthropic messages namespace."""

    def __init__(self, parent: AsyncSuperCompressAnthropic):
        self._parent = parent

    async def create(self, **kwargs: Any) -> Any:
        """Create an Anthropic message asynchronously with compressed context."""
        if "messages" in kwargs:
            kwargs["messages"] = self._parent._compress_messages(kwargs["messages"])
        return await self._parent._client.messages.create(**kwargs)


__all__ = ["AsyncSuperCompressAnthropic", "SuperCompressAnthropic"]
