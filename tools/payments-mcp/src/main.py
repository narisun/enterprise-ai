"""Main entry point for the payments-mcp server.

Sets up FastMCP with the PaymentsMcpService and registers tools.
"""
import os

from mcp.server.fastmcp import FastMCP

from platform_sdk import configure_logging, get_logger

from .payments_mcp_service import PaymentsMcpService

configure_logging()
log = get_logger(__name__)

# Module-level: required for FastMCP construction before lifespan runs.
# These must be readable at module import time.
TRANSPORT = os.environ.get("MCP_TRANSPORT", "sse")
PORT = int(os.environ.get("PORT", 8082))


# Create the service
service = PaymentsMcpService()

# Create the MCP server with the service's lifespan
mcp = FastMCP(
    "payments-mcp",
    lifespan=service.lifespan,
    host="0.0.0.0",
    port=PORT,
)

# Register the AgentContext middleware so X-Agent-Context is decoded on every
# request and stored in a ContextVar for tool handlers to read.
#
# FastMCP (1.x) has no _app attribute at module load time — the Starlette app
# is created lazily by sse_app() when the server starts.  We patch sse_app()
# so our middleware is added to the Starlette app before uvicorn receives it.
from tools_shared.mcp_auth import AgentContextMiddleware  # noqa: E402

if TRANSPORT == "sse":
    _orig_sse_app = mcp.sse_app

    def _patched_sse_app(mount_path=None):
        starlette_app = _orig_sse_app(mount_path)
        starlette_app.add_middleware(AgentContextMiddleware)
        return starlette_app

    mcp.sse_app = _patched_sse_app

# Register tools
service.register_tools(mcp)


if __name__ == "__main__":
    log.info("mcp_server_starting", transport=TRANSPORT)
    mcp.run(transport=TRANSPORT)
