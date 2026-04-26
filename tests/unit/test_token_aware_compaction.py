"""Unit tests for TokenAwareCompactionModifier.

Verifies tiktoken is NOT loaded at import time and the class is
constructor-configurable. The class wraps the existing module-level
compaction logic so existing behavior (min-message guard, lazy
tiktoken init) is preserved.
"""
import importlib
import sys

import pytest
from langchain_core.messages import HumanMessage, SystemMessage

pytestmark = pytest.mark.unit


def test_compaction_module_does_not_load_tiktoken_at_import():
    # Fresh import; module-level tiktoken should not appear in loaded modules.
    for mod in list(sys.modules):
        if mod.startswith("tiktoken") or mod.startswith("platform_sdk.compaction"):
            del sys.modules[mod]
    importlib.import_module("platform_sdk.compaction")
    assert "tiktoken" not in sys.modules, (
        "tiktoken was imported at module load — it should be lazy inside "
        "the token-counter helper."
    )


def test_class_instantiable_with_token_limit():
    from platform_sdk.compaction import TokenAwareCompactionModifier

    c = TokenAwareCompactionModifier(token_limit=1000)
    assert c is not None


def test_apply_returns_messages_under_limit_unchanged():
    from platform_sdk.compaction import TokenAwareCompactionModifier

    c = TokenAwareCompactionModifier(token_limit=10_000)
    msgs = [SystemMessage(content="system"), HumanMessage(content="hi")]
    assert c.apply(msgs) == msgs


def test_apply_trims_when_over_limit():
    from platform_sdk.compaction import TokenAwareCompactionModifier

    c = TokenAwareCompactionModifier(token_limit=10)  # very small
    long_msg = "x " * 1000
    msgs = [SystemMessage(content="sys"), HumanMessage(content=long_msg)]
    out = c.apply(msgs)
    # At minimum, the system message is preserved, and history is truncated
    # OR the min-message guard returns [system + last user] (length 2).
    assert len(out) <= len(msgs)
    # The first message should still be the system message.
    assert isinstance(out[0], SystemMessage)


def test_apply_handles_empty_message_list():
    from platform_sdk.compaction import TokenAwareCompactionModifier

    c = TokenAwareCompactionModifier(token_limit=1000)
    assert c.apply([]) == []
