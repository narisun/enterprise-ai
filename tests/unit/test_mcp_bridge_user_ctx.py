"""MCPToolBridge accepts user_ctx parameter and threads it into the invoke closure."""
from __future__ import annotations

from dataclasses import dataclass
from unittest.mock import AsyncMock, MagicMock

import pytest

pytestmark = pytest.mark.unit


@dataclass
class _FakeUserContext:
    """Test double that structurally satisfies platform_sdk.user_context.UserContext."""
    auth_token: str


def test_user_context_protocol_accepts_minimal_dataclass():
    from platform_sdk.user_context import UserContext

    ctx = _FakeUserContext(auth_token="hmac-test-token")
    assert isinstance(ctx, UserContext)


async def test_get_langchain_tools_accepts_user_ctx_keyword():
    """Signature accepts user_ctx; bridge with no session returns []."""
    from platform_sdk.mcp_bridge import MCPToolBridge

    bridge = MCPToolBridge(sse_url="http://127.0.0.1:0")
    ctx = _FakeUserContext(auth_token="t1")

    tools = await bridge.get_langchain_tools(user_ctx=ctx)
    assert isinstance(tools, list)


async def test_invoke_closure_uses_user_ctx_auth_token():
    """When user_ctx is passed to get_langchain_tools, the resulting tool's
    invocation must stamp kwargs['auth_context'] with user_ctx.auth_token.
    """
    from platform_sdk.mcp_bridge import MCPToolBridge

    # Build a bridge with a mocked active MCP session that returns one tool
    # and records call_tool kwargs so we can inspect what auth_context was used.
    bridge = MCPToolBridge(sse_url="http://127.0.0.1:0")

    fake_tool_meta = MagicMock()
    fake_tool_meta.name = "echo"
    fake_tool_meta.description = "echo back"
    fake_tool_meta.inputSchema = {
        "type": "object",
        "properties": {"session_id": {"type": "string"}},
        "required": [],
    }

    fake_list_tools = MagicMock()
    fake_list_tools.tools = [fake_tool_meta]

    fake_call_result = MagicMock()
    fake_call_result.content = [MagicMock(text="ok")]

    fake_session = MagicMock()
    fake_session.list_tools = AsyncMock(return_value=fake_list_tools)
    fake_session.call_tool = AsyncMock(return_value=fake_call_result)

    bridge._session = fake_session
    bridge._session_id = "sess-1"

    ctx = _FakeUserContext(auth_token="USER_CTX_TOKEN_WINS")
    tools = await bridge.get_langchain_tools(user_ctx=ctx)
    assert len(tools) == 1

    await tools[0].coroutine()  # invoke the tool

    # Inspect what call_tool received
    assert fake_session.call_tool.await_count == 1
    _, call_kwargs = fake_session.call_tool.await_args
    stamped = call_kwargs["arguments"].get("auth_context")
    assert stamped == "USER_CTX_TOKEN_WINS", (
        f"Expected user_ctx.auth_token, got {stamped!r} — "
        "the closure must stamp auth_context with the explicit user_ctx."
    )


async def test_invoke_closure_no_auth_context_when_user_ctx_is_none():
    """When user_ctx is not passed, no auth_context header is stamped.
    The MCP server's OPA policy will fail-closed on missing auth.
    """
    from platform_sdk.mcp_bridge import MCPToolBridge

    bridge = MCPToolBridge(sse_url="http://127.0.0.1:0")

    fake_tool_meta = MagicMock()
    fake_tool_meta.name = "echo"
    fake_tool_meta.description = "echo back"
    fake_tool_meta.inputSchema = {
        "type": "object", "properties": {"session_id": {"type": "string"}}, "required": [],
    }
    fake_list_tools = MagicMock(); fake_list_tools.tools = [fake_tool_meta]
    fake_call_result = MagicMock(); fake_call_result.content = [MagicMock(text="ok")]

    fake_session = MagicMock()
    fake_session.list_tools = AsyncMock(return_value=fake_list_tools)
    fake_session.call_tool = AsyncMock(return_value=fake_call_result)

    bridge._session = fake_session
    bridge._session_id = "sess-1"

    # Note: NO user_ctx kwarg — auth_context should NOT be stamped.
    tools = await bridge.get_langchain_tools()
    assert len(tools) == 1
    await tools[0].coroutine()

    _, call_kwargs = fake_session.call_tool.await_args
    stamped = call_kwargs["arguments"].get("auth_context")
    assert stamped is None, (
        f"Expected no auth_context when user_ctx is None, got {stamped!r}"
    )
