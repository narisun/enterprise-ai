"""Backward-compatible entry point for salesforce-mcp server."""
from .main import TRANSPORT, mcp

if __name__ == "__main__":
    mcp.run(transport=TRANSPORT)
