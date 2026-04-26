"""Main entry point for the news-search-mcp server.

Sets up FastMCP with the NewsSearchMcpService and registers tools.
"""
import os

from mcp.server.fastmcp import FastMCP

from platform_sdk import configure_logging, get_logger

from .news_search_mcp_service import NewsSearchMcpService

configure_logging()
log = get_logger(__name__)

# Module-level: required for FastMCP construction before lifespan runs.
# These must be readable at module import time.
TRANSPORT = os.environ.get("MCP_TRANSPORT", "sse")
PORT = int(os.environ.get("PORT", 8083))


# Create the service
service = NewsSearchMcpService()

# Create the MCP server with the service's lifespan
mcp = FastMCP(
    "news-search-mcp",
    lifespan=service.lifespan,
    host="0.0.0.0",
    port=PORT,
)

# Register tools
service.register_tools(mcp)


if __name__ == "__main__":
    log.info("mcp_server_starting", transport=TRANSPORT)
    mcp.run(transport=TRANSPORT)
