"""Main entry point for the salesforce-mcp server.

Sets up FastMCP with the SalesforceMcpService and registers tools.
"""
import os

from mcp.server.fastmcp import FastMCP

from platform_sdk import configure_logging, get_logger

from .salesforce_mcp_service import SalesforceMcpService

configure_logging()
log = get_logger(__name__)

# Module-level: required for FastMCP construction before lifespan runs.
# These must be readable at module import time.
TRANSPORT = os.environ.get("MCP_TRANSPORT", "sse")
PORT = int(os.environ.get("PORT", 8081))


# Create the service
service = SalesforceMcpService()

# Create the MCP server with the service's lifespan
mcp = FastMCP(
    "salesforce-mcp",
    lifespan=service.lifespan,
    host="0.0.0.0",
    port=PORT,
)

# Register AgentContext middleware for SSE transport
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
