"""Guardrail: platform_sdk.services.chat_llm_factory has no module-level state.

Constructor injection (config + per-call kwargs) is the only configuration
path. If anyone adds a module-level cache/registry/pool dict here in the
future, this test fails — pushing the cache into the class instance.
"""
from __future__ import annotations

import importlib

import pytest

pytestmark = pytest.mark.unit


FACTORY_MODULE = "platform_sdk.services.chat_llm_factory"


def test_module_imports_without_side_effects():
    mod = importlib.import_module(FACTORY_MODULE)
    assert mod is not None


def test_no_module_level_cache_dict():
    mod = importlib.import_module(FACTORY_MODULE)
    for attr in dir(mod):
        if attr.startswith("_"):
            continue
        val = getattr(mod, attr)
        if isinstance(val, dict) and any(
            attr.lower().endswith(suffix)
            for suffix in ("cache", "registry", "pool", "instances")
        ):
            raise AssertionError(
                f"Module-level {type(val).__name__} found: {attr!r}. "
                f"Move it into ChatLLMFactory.__init__ as instance state."
            )


def test_factory_class_exists_and_takes_config():
    from platform_sdk.config import AgentConfig
    from platform_sdk.services.chat_llm_factory import ChatLLMFactory

    # Smoke: class exists, takes a config, holds it as instance state.
    import os
    os.environ.setdefault("INTERNAL_API_KEY", "test")
    cfg = AgentConfig.from_env()
    factory = ChatLLMFactory(cfg)
    assert factory is not None
    # Internal config attribute should be the one we passed.
    assert factory._config is cfg


def test_two_factory_instances_do_not_share_state():
    from platform_sdk.config import AgentConfig
    from platform_sdk.services.chat_llm_factory import ChatLLMFactory

    import os
    os.environ.setdefault("INTERNAL_API_KEY", "test")
    cfg1 = AgentConfig.from_env()
    cfg2 = AgentConfig.from_env()

    f1 = ChatLLMFactory(cfg1)
    f2 = ChatLLMFactory(cfg2)
    # Each holds its own config — no module-level singleton.
    assert f1._config is cfg1
    assert f2._config is cfg2
    assert f1 is not f2
