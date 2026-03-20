"""
MCPToolBridge — re-export from platform_sdk.

The canonical implementation now lives in platform_sdk.mcp_bridge.
This shim exists so existing imports (agents/src/server.py, Dockerfiles that
COPY this file) continue to resolve without changes.
"""
from platform_sdk.mcp_bridge import (  # noqa: F401
    MCPToolBridge,
    reset_session_id,
    set_session_id,
)
