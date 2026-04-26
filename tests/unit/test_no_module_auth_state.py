"""Guardrail: platform_sdk.mcp_bridge must not expose module-level auth state.

The user_auth ContextVar and its set/reset helpers were removed in
Phase 9 of the SoC/DI refactor. User identity now flows via the
explicit ``user_ctx: UserContext`` parameter on
``MCPToolBridge.get_langchain_tools`` (added in Phase 3.2).

The session_id ContextVar (`_session_id_ctx`, `set_session_id`,
`reset_session_id`) is intentionally retained — it is still consumed
by ``agents/src/enterprise_agent_service.py`` (the generic agent).
"""
import platform_sdk.mcp_bridge as mb

import pytest

pytestmark = pytest.mark.unit


def test_no_user_auth_ctx_at_module_level():
    assert not hasattr(mb, "_user_auth_ctx"), (
        "_user_auth_ctx was removed — user context now flows via the "
        "explicit user_ctx parameter on MCPToolBridge.get_langchain_tools. "
        "If you need it back, you probably want to pass UserContext instead."
    )


def test_no_set_user_auth_token_at_module_level():
    assert not hasattr(mb, "set_user_auth_token"), (
        "set_user_auth_token was removed — pass UserContext to the call site "
        "instead of mutating a module-level ContextVar."
    )


def test_no_reset_user_auth_token_at_module_level():
    assert not hasattr(mb, "reset_user_auth_token"), (
        "reset_user_auth_token was removed — see set_user_auth_token."
    )


def test_session_id_helpers_still_present():
    """session_id ContextVar stays — it's a separate concern from user_auth and
    the generic agent (agents/src/enterprise_agent_service.py) still uses it."""
    assert hasattr(mb, "set_session_id")
    assert hasattr(mb, "reset_session_id")
