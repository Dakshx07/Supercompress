"""OpenAI-style chat messages — compress history before API call."""

from __future__ import annotations

from typing import Any

from supercompress import compress_for_turn


def compress_messages(
    messages: list[dict[str, Any]],
    budget_ratio: float = 0.35,
) -> list[dict[str, Any]]:
    """
    Compress all but the last user message into a single context block.

    System messages are preserved verbatim at the front.
    """
    if len(messages) <= 1:
        return messages

    system: list[dict[str, Any]] = []
    rest: list[dict[str, Any]] = []
    for m in messages:
        if m.get("role") == "system" and not rest:
            system.append(m)
        else:
            rest.append(m)

    if not rest:
        return messages

    last = rest[-1]
    if last.get("role") != "user":
        return messages

    blocks = [f"[{m.get('role', '?')}] {m.get('content', '')}" for m in rest[:-1]]
    query = str(last.get("content", ""))
    compressed, stats = compress_for_turn(blocks, query, budget_ratio=budget_ratio)

    compressed_msg = {
        "role": "user",
        "content": f"[SuperCompress: {stats.original_tokens}→{stats.kept_tokens} tok]\n\n{compressed}\n\n---\n\n{query}",
    }
    return system + [compressed_msg]


if __name__ == "__main__":
    sample = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Here is a long log:\n" + "\n".join(f"line {i}" for i in range(200))},
        {"role": "assistant", "content": "Got it."},
        {"role": "user", "content": "What was line 150 about?"},
    ]
    out = compress_messages(sample, budget_ratio=0.35)
    print(out[-1]["content"][:500])
