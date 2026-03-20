"""
MCP Server Authorization Helpers — thin adapter over platform_sdk.AgentContext.
================================================================================
All authorization logic now lives in platform_sdk.AgentContext.  This module
provides only the ASGI middleware and ContextVar binding that MCP servers need
to extract the AgentContext from the X-Agent-Context request header.

Usage in an MCP server tool handler:
    from tools_shared.mcp_auth import AgentContextMiddleware, get_agent_context

    # FastMCP (1.x) creates the Starlette app lazily via sse_app().
    # Patch sse_app() at module level to inject the middleware:
    if TRANSPORT == "sse":
        _orig_sse_app = mcp.sse_app
        def _patched_sse_app(mount_path=None):
            starlette_app = _orig_sse_app(mount_path)
            starlette_app.add_middleware(AgentContextMiddleware)
            return starlette_app
        mcp.sse_app = _patched_sse_app

    @mcp.tool()
    async def get_salesforce_summary(client_name: str) -> str:
        ctx = get_agent_context()   # AgentContext | None
        if ctx and not ctx.can_access_account(resolved_account_id):
            return json.dumps({"error": "Access denied"})
        ...

Authorization helpers (row filters, column masks) are methods on AgentContext:
    ctx.build_row_filters_crm()
    ctx.build_row_filters_payments(party_names)
    ctx.build_col_mask()
    ctx.can_access_account(account_id)
    ctx.has_clearance(level)
"""
from __future__ import annotations

from contextvars import ContextVar
from typing import Any, Optional

from platform_sdk import AgentContext, get_logger

log = get_logger(__name__)

# Each asyncio task serving an MCP request gets its own copy via ContextVar.
# The middleware populates it; tool handlers read it.
_agent_context_var: ContextVar[Optional[AgentContext]] = ContextVar(
    "agent_context", default=None
)


def get_agent_context() -> Optional[AgentContext]:
    """Return the AgentContext for the current request, or None if unauthenticated."""
    return _agent_context_var.get()


class AgentContextMiddleware:
    """
    Starlette ASGI middleware that decodes the X-Agent-Context header on every
    request and stores the resulting AgentContext in a ContextVar.

    Decoding is delegated entirely to AgentContext.from_header() (platform SDK),
    which owns all base64-JSON parsing and field validation logic.

    Register by patching mcp.sse_app() — see module docstring for pattern.
    """

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] in ("http", "websocket"):
            headers = dict(scope.get("headers", []))
            raw = headers.get(b"x-agent-context", b"").decode()
            if raw:
                try:
                    ctx = AgentContext.from_header(raw)
                    token = _agent_context_var.set(ctx)
                    try:
                        await self.app(scope, receive, send)
                    finally:
                        _agent_context_var.reset(token)
                    return
                except Exception as exc:
                    log.warning("invalid_agent_context_header", error=str(exc))
        await self.app(scope, receive, send)
