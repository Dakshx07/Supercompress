"""
SuperCompress LangChain Callback Handler

A LangChain callback handler that automatically compresses prompts
before they reach the LLM. Works with any LangChain chat model.

Installation:
    pip install supercompress langchain langchain-openai

Usage:
    from langchain_callback import SuperCompressCallback
    from langchain_openai import ChatOpenAI
    from langchain_core.callbacks import CallbackManager

    callback = SuperCompressCallback(budget_ratio=0.35)
    manager = CallbackManager([callback])

    llm = ChatOpenAI(
        model="gpt-4o",
        temperature=0,
        callback_manager=manager,
    )

    # When you call llm.invoke(), the callback automatically
    # compresses the message history before sending to the API
    response = llm.invoke(messages)

Or use as a standalone helper:
    from langchain_callback import compress_messages_for_llm
    compressed = compress_messages_for_llm(messages, budget_ratio=0.35)
    response = llm.invoke(compressed)
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
)

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


class SuperCompressCallback(BaseCallbackHandler):
    """
    LangChain callback handler that compresses prompts before LLM calls.

    Automatically intercepts chat model calls and compresses the
    message history, keeping only the most relevant lines.
    """

    def __init__(self, budget_ratio: float = 0.35):
        self.budget_ratio = budget_ratio
        self.total_original_tokens = 0
        self.total_kept_tokens = 0

    def on_chat_model_start(
        self,
        serialized: dict[str, Any],
        messages: list[list[BaseMessage]],
        **kwargs: Any,
    ) -> None:
        """Called when a chat model starts. Compresses prompts in-place."""
        for i, msg_list in enumerate(messages):
            compressed = self._compress_message_list(msg_list)
            messages[i] = compressed

    def _compress_message_list(
        self, messages: list[BaseMessage]
    ) -> list[BaseMessage]:
        """Compress a list of LangChain messages."""
        if len(messages) <= 2:
            return messages

        # Separate system messages
        system_msgs = [m for m in messages if isinstance(m, SystemMessage)]
        non_system = [m for m in messages if not isinstance(m, SystemMessage)]

        if len(non_system) < 2:
            return messages

        # Last message must be from user
        last_msg = non_system[-1]
        if not isinstance(last_msg, HumanMessage):
            return messages

        history = non_system[:-1]
        query = _extract_text_content(last_msg.content)

        # Format history
        context_parts = []
        for msg in history:
            role = "user" if isinstance(msg, HumanMessage) else "assistant"
            content = _extract_text_content(msg.content)
            context_parts.append(f"[{role}] {content}")

        context = "\n".join(context_parts)

        # Compress
        result = compress_for_turn(context, query, budget_ratio=self.budget_ratio)

        self.total_original_tokens += result.original_tokens
        self.total_kept_tokens += result.kept_tokens

        logger.info(
            f"SuperCompress [LangChain]: {result.original_tokens}→{result.kept_tokens} tok "
            f"({result.tokens_saved_pct:.1f}% saved)"
        )

        # Rebuild messages
        compressed_content = (
            f"[SuperCompress: {result.original_tokens}→{result.kept_tokens} tok, "
            f"{result.tokens_saved_pct:.1f}% saved]\n\n"
            f"{result.compressed_text}\n\n---\n\n{query}"
        )

        return system_msgs + [HumanMessage(content=compressed_content)]

    def get_stats(self) -> dict[str, Any]:
        """Return cumulative compression statistics."""
        return {
            "total_original_tokens": self.total_original_tokens,
            "total_kept_tokens": self.total_kept_tokens,
            "total_savings_pct": (
                (1 - self.total_kept_tokens / max(self.total_original_tokens, 1)) * 100
                if self.total_original_tokens > 0 else 0
            ),
        }


# ── Standalone helper function ─────────────────────────────────────

def compress_messages_for_llm(
    messages: list[BaseMessage],
    budget_ratio: float = 0.35,
) -> list[BaseMessage]:
    """
    Compress a list of LangChain messages without using callbacks.

    Useful for manual control over when compression happens.
    """
    handler = SuperCompressCallback(budget_ratio=budget_ratio)
    return handler._compress_message_list(messages)


__all__ = [
    "SuperCompressCallback",
    "compress_messages_for_llm",
]
