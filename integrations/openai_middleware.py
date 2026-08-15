"""
SuperCompress OpenAI SDK Middleware

A transparent middleware wrapper for the OpenAI Python SDK.
Automatically compresses conversation context before sending to the API.
Supports both synchronous (OpenAI) and asynchronous (AsyncOpenAI) clients,
streaming and non-streaming responses.

Installation:
    pip install supercompress openai

Usage:
    from openai_middleware import SuperCompressOpenAI, AsyncSuperCompressOpenAI

    # Synchronous client
    client = SuperCompressOpenAI(
        api_key="sk-...",
        budget_ratio=0.35,  # keep 35% of tokens
    )

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[...],
    )

    # Asynchronous client
    async_client = AsyncSuperCompressOpenAI(
        api_key="sk-...",
        budget_ratio=0.35,
    )
    response = await async_client.chat.completions.create(
        model="gpt-4o",
        messages=[...],
    )
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional, Union

from openai import AsyncOpenAI, OpenAI
from openai.types.chat import ChatCompletion
from openai.types.chat.chat_completion_chunk import ChatCompletionChunk

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


def _compress_messages_helper(
    messages: list[dict], budget_ratio: float, tracker: Any
) -> list[dict]:
    """Compress conversation history, preserving system and latest user message."""
    if len(messages) <= 2:
        return messages

    system_msgs = [m for m in messages if m.get("role") == "system"]
    non_system = [m for m in messages if m.get("role") != "system"]

    if len(non_system) < 2:
        return messages

    last_msg = non_system[-1]
    if last_msg.get("role") != "user":
        return messages

    history = non_system[:-1]
    raw_query = last_msg.get("content", "")
    query = _extract_text_content(raw_query)

    context_lines = []
    for msg in history:
        role = msg.get("role", "unknown")
        content = _extract_text_content(msg.get("content", ""))
        context_lines.append(f"[{role}] {content}")

    context = "\n".join(context_lines)

    result = compress_for_turn(context, query, budget_ratio=budget_ratio)

    tracker.total_original_tokens += result.original_tokens
    tracker.total_kept_tokens += result.kept_tokens

    savings = result.tokens_saved_pct
    logger.info(
        f"SuperCompress: {result.original_tokens}→{result.kept_tokens} tok "
        f"({savings:.1f}% saved) — policy={result.policy_name}"
    )

    compressed_content = (
        f"[SuperCompress: {result.original_tokens}→{result.kept_tokens} tok, "
        f"{savings:.1f}% saved]\n\n"
        f"{result.compressed_text}\n\n---\n\n{query}"
    )

    return system_msgs + [{"role": "user", "content": compressed_content}]


class SuperCompressOpenAI:
    """OpenAI client wrapper with automatic prompt compression.

    Supports both streaming (stream=True) and non-streaming responses.
    Tracks cumulative token savings via get_stats().
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        budget_ratio: float = 0.35,
        base_url: Optional[str] = None,
        **kwargs: Any,
    ):
        api_key = api_key or os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError(
                "OpenAI API key required. Pass it to SuperCompressOpenAI() "
                "or set the OPENAI_API_KEY environment variable."
            )
        self._client = OpenAI(api_key=api_key, base_url=base_url, **kwargs)
        self.budget_ratio = budget_ratio
        self.total_original_tokens = 0
        self.total_kept_tokens = 0

    @property
    def chat(self) -> _ChatWrapper:
        return _ChatWrapper(self)

    @property
    def models(self) -> Any:
        return self._client.models

    def _compress_messages(self, messages: list[dict]) -> list[dict]:
        return _compress_messages_helper(messages, self.budget_ratio, self)

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


class _ChatWrapper:
    def __init__(self, parent: SuperCompressOpenAI):
        self._parent = parent

    @property
    def completions(self) -> _CompletionWrapper:
        return _CompletionWrapper(self._parent)


class _CompletionWrapper:
    def __init__(self, parent: SuperCompressOpenAI):
        self._parent = parent

    def create(self, **kwargs: Any) -> Union[ChatCompletion, Any]:
        if "messages" in kwargs:
            kwargs["messages"] = self._parent._compress_messages(kwargs["messages"])
        return self._parent._client.chat.completions.create(**kwargs)


class AsyncSuperCompressOpenAI:
    """Async OpenAI client wrapper with automatic prompt compression."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        budget_ratio: float = 0.35,
        base_url: Optional[str] = None,
        **kwargs: Any,
    ):
        api_key = api_key or os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError(
                "OpenAI API key required. Pass it to AsyncSuperCompressOpenAI() "
                "or set the OPENAI_API_KEY environment variable."
            )
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url, **kwargs)
        self.budget_ratio = budget_ratio
        self.total_original_tokens = 0
        self.total_kept_tokens = 0

    @property
    def chat(self) -> _AsyncChatWrapper:
        return _AsyncChatWrapper(self)

    @property
    def models(self) -> Any:
        return self._client.models

    def _compress_messages(self, messages: list[dict]) -> list[dict]:
        return _compress_messages_helper(messages, self.budget_ratio, self)

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


class _AsyncChatWrapper:
    def __init__(self, parent: AsyncSuperCompressOpenAI):
        self._parent = parent

    @property
    def completions(self) -> _AsyncCompletionWrapper:
        return _AsyncCompletionWrapper(self._parent)


class _AsyncCompletionWrapper:
    def __init__(self, parent: AsyncSuperCompressOpenAI):
        self._parent = parent

    async def create(self, **kwargs: Any) -> Union[ChatCompletion, Any]:
        if "messages" in kwargs:
            kwargs["messages"] = self._parent._compress_messages(kwargs["messages"])
        return await self._parent._client.chat.completions.create(**kwargs)


__all__ = ["SuperCompressOpenAI", "AsyncSuperCompressOpenAI"]
