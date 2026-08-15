"""Unit tests for integration middleware (OpenAI, Anthropic, LangChain) multimodal and lifecycle handling."""

import sys
import os
import pytest

# Add repo root to path so integrations can be imported
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


class MockTracker:
    def __init__(self):
        self.total_original_tokens = 0
        self.total_kept_tokens = 0


def test_openai_middleware_multimodal_preservation():
    pytest.importorskip("openai")
    from integrations.openai_middleware import _compress_messages_helper

    tracker = MockTracker()
    messages = [
        {"role": "system", "content": "You are an assistant."},
        {"role": "user", "content": "Here is history context line 1.\nLine 2.\nLine 3.\nLine 4."},
        {"role": "assistant", "content": "Understood."},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "What is in this diagram?"},
                {"type": "image_url", "image_url": {"url": "https://example.com/diagram.png"}},
            ],
        },
    ]

    compressed = _compress_messages_helper(messages, budget_ratio=0.5, tracker=tracker)
    assert len(compressed) == 2
    assert compressed[0]["role"] == "system"
    user_msg = compressed[1]
    assert user_msg["role"] == "user"
    assert isinstance(user_msg["content"], list)

    # Must preserve the image block
    types = [part.get("type") for part in user_msg["content"]]
    assert "text" in types
    assert "image_url" in types
    img_part = next(part for part in user_msg["content"] if part["type"] == "image_url")
    assert img_part["image_url"]["url"] == "https://example.com/diagram.png"


def test_anthropic_middleware_multimodal_preservation():
    pytest.importorskip("anthropic")
    from integrations.anthropic_middleware import _compress_anthropic_messages

    tracker = MockTracker()
    messages = [
        {"role": "user", "content": "Old context paragraph 1.\nParagraph 2.\nParagraph 3.\nParagraph 4."},
        {"role": "assistant", "content": "Acknowledged."},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Analyze this screenshot"},
                {"type": "image", "source": {"type": "base64", "data": "abc12345"}},
            ],
        },
    ]

    compressed = _compress_anthropic_messages(messages, budget_ratio=0.5, tracker=tracker)
    assert len(compressed) == 1
    user_msg = compressed[0]
    assert user_msg["role"] == "user"
    assert isinstance(user_msg["content"], list)

    # Must preserve the image block
    types = [part.get("type") for part in user_msg["content"]]
    assert "text" in types
    assert "image" in types
    img_part = next(part for part in user_msg["content"] if part["type"] == "image")
    assert img_part["source"]["data"] == "abc12345"


def test_langchain_callback_multimodal_preservation():
    pytest.importorskip("langchain_core")
    from integrations.langchain_callback import SuperCompressCallback
    from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

    callback = SuperCompressCallback(budget_ratio=0.5)
    messages = [
        SystemMessage(content="You are a helper."),
        HumanMessage(content="Previous line 1.\nLine 2.\nLine 3.\nLine 4."),
        AIMessage(content="Got it."),
        HumanMessage(
            content=[
                {"type": "text", "text": "Query about image"},
                {"type": "image_url", "image_url": "https://example.com/img.jpg"},
            ]
        ),
    ]

    compressed = callback._compress_message_list(messages)
    assert len(compressed) == 2
    assert isinstance(compressed[0], SystemMessage)
    last_human = compressed[1]
    assert isinstance(last_human, HumanMessage)
    assert isinstance(last_human.content, list)
    types = [part.get("type") for part in last_human.content]
    assert "text" in types
    assert "image_url" in types
