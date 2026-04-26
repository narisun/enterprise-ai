"""Shared exception boundary for MCP tool handlers.

Wraps an MCP tool's async handler so vendor exceptions never leak into
the SSE stream. The decorator catches the broadest exception, logs it
with structured fields, and returns a sanitised error response that
matches the platform-sdk's make_tool_error() shape.
"""
from __future__ import annotations

import functools
from typing import Any, Awaitable, Callable

from platform_sdk import get_logger, make_tool_error

log = get_logger(__name__)


def tool_error_boundary(tool_name: str):
    """Decorator factory: wrap an async tool handler with a logging
    exception boundary that returns a safe error string instead of
    re-raising.

    Usage:
        @tool_error_boundary("get_payment_summary")
        async def my_tool(...) -> dict:
            ...
    """

    def decorator(fn: Callable[..., Awaitable[Any]]) -> Callable[..., Awaitable[Any]]:
        @functools.wraps(fn)
        async def wrapper(*args, **kwargs):
            try:
                return await fn(*args, **kwargs)
            except Exception as exc:
                log.error(
                    "tool_handler_error",
                    tool=tool_name,
                    error=str(exc),
                    error_type=type(exc).__name__,
                    exc_info=True,
                )
                return make_tool_error(
                    "internal_error",
                    f"Tool '{tool_name}' failed: {type(exc).__name__}",
                )

        return wrapper

    return decorator
