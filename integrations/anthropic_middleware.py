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
    messages: list[dict], system: Optional[str], budget_ratio: float, tracker: Any
) -> list[dict]:
    _ = system
    if len(messages) <= 1:
        return messages

    # Last message should be from user
    last_msg = messages[-1]
    if last_msg.get("role") != "user":
        return messages

    history = messages[:-1]
    query = _extract_text_content(last_msg.get("content", ""))

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
    compressed_content = (
        f"[SuperCompress: {result.original_tokens}→{result.kept_tokens} tok, "
        f"{result.tokens_saved_pct:.1f}% saved]\n\n"
        f"{result.compressed_text}\n\n---\n\n{query}"
    )

    return [{"role": "user", "content": compressed_content}]


class SuperCompressAnthropic:
    """Anthropic client wrapper with automatic prompt compression."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        budget_ratio: float = 0.35,
        **kwargs: Any,
    ):
        self._client = Anthropic(api_key=api_key or os.getenv("ANTHROPIC_API_KEY"), **kwargs)
        self.budget_ratio = budget_ratio
        self.total_original_tokens = 0
        self.total_kept_tokens = 0

    @property
    def messages(self) -> _MessagesWrapper:
        return _MessagesWrapper(self)

    def _compress_messages(self, messages: list[dict], system: Optional[str] = None) -> list[dict]:
        return _compress_anthropic_messages(messages, system, self.budget_ratio, self)

    def get_stats(self) -> dict[str, Any]:
        return {
            "total_original_tokens": self.total_original_tokens,
            "total_kept_tokens": self.total_kept_tokens,
            "total_savings_pct": (
                (1 - self.total_kept_tokens / max(self.total_original_tokens, 1)) * 100
                if self.total_original_tokens > 0
                else 0
            ),
        }


class _MessagesWrapper:
    def __init__(self, parent: SuperCompressAnthropic):
        self._parent = parent

    def create(self, **kwargs: Any) -> Any:
        if "messages" in kwargs:
            kwargs["messages"] = self._parent._compress_messages(
                kwargs["messages"],
                kwargs.get("system"),
            )
        return self._parent._client.messages.create(**kwargs)


class AsyncSuperCompressAnthropic:
    """Async Anthropic client wrapper with automatic prompt compression."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        budget_ratio: float = 0.35,
        **kwargs: Any,
    ):
        self._client = AsyncAnthropic(api_key=api_key or os.getenv("ANTHROPIC_API_KEY"), **kwargs)
        self.budget_ratio = budget_ratio
        self.total_original_tokens = 0
        self.total_kept_tokens = 0

    @property
    def messages(self) -> _AsyncMessagesWrapper:
        return _AsyncMessagesWrapper(self)

    def _compress_messages(self, messages: list[dict], system: Optional[str] = None) -> list[dict]:
        return _compress_anthropic_messages(messages, system, self.budget_ratio, self)

    def get_stats(self) -> dict[str, Any]:
        return {
            "total_original_tokens": self.total_original_tokens,
            "total_kept_tokens": self.total_kept_tokens,
            "total_savings_pct": (
                (1 - self.total_kept_tokens / max(self.total_original_tokens, 1)) * 100
                if self.total_original_tokens > 0
                else 0
            ),
        }


class _AsyncMessagesWrapper:
    def __init__(self, parent: AsyncSuperCompressAnthropic):
        self._parent = parent

    async def create(self, **kwargs: Any) -> Any:
        if "messages" in kwargs:
            kwargs["messages"] = self._parent._compress_messages(
                kwargs["messages"],
                kwargs.get("system"),
            )
        return await self._parent._client.messages.create(**kwargs)


__all__ = ["SuperCompressAnthropic", "AsyncSuperCompressAnthropic"]
