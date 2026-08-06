"""LangChain-style hook — compress message history before invoke (no LangChain dep)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from supercompress import compress_for_turn


@dataclass
class Message:
    role: str
    content: str


def compress_history(
    messages: Sequence[Message],
    budget_ratio: float = 0.35,
) -> tuple[list[Message], dict]:
    """Keep system + latest user; compress everything in between."""
    if len(messages) <= 2:
        return list(messages), {}

    system = [m for m in messages if m.role == "system"]
    non_system = [m for m in messages if m.role != "system"]
    if not non_system:
        return list(messages), {}

    last = non_system[-1]
    middle = non_system[:-1]
    blocks = [f"[{m.role}] {m.content}" for m in middle]
    compressed, stats = compress_for_turn(blocks, last.content, budget_ratio=budget_ratio)

    out = system + [Message(role="assistant", content=f"[compressed context]\n{compressed}"), last]
    meta = {
        "original_tokens": stats.original_tokens,
        "kept_tokens": stats.kept_tokens,
        "tokens_saved_pct": stats.tokens_saved_pct,
    }
    return out, meta


if __name__ == "__main__":
    msgs = [
        Message("system", "You are helpful."),
        Message("user", "log:\n" + "\n".join(f"entry {i}" for i in range(150))),
        Message("assistant", "Noted."),
        Message("user", "Summarize entry 75"),
    ]
    compressed_msgs, meta = compress_history(msgs)
    print(meta)
    print(compressed_msgs[-2].content[:400])
