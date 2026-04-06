"""Main entry point for the data-mcp server.

Sets up FastMCP with the DataMcpService and registers tools.
"""
import os

from mcp.server.fastmcp import FastMCP

from platform_sdk import configure_logging, get_logger

from .DataMcpService import DataMcpService

configure_logging()
log = get_logger(__name__)

# Module-level: required for FastMCP construction before lifespan runs.
# These must be readable at module import time.
TRANSPORT = os.environ.get("MCP_TRANSPORT", "stdio")

# Create the service
service = DataMcpService()

# Create the MCP server with the service's lifespan
if TRANSPORT == "sse":
    mcp = FastMCP(
        "Enterprise Data MCP",
        lifespan=service.lifespan,
        host="0.0.0.0",
        port=8080,
    )
else:
    mcp = FastMCP("Enterprise Data MCP", lifespan=service.lifespan)

# Register tools
service.register_tools(mcp)


if __name__ == "__main__":
    log.info("mcp_server_starting", transport=TRANSPORT)
    mcp.run(transport=TRANSPORT)
