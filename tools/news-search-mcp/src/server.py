"""
Backward-compatible entry point for news-search-mcp server.

This module maintains the original server.py interface while delegating
to the refactored OOP architecture. It can be imported or executed directly.
"""
from .main import TRANSPORT, mcp

if __name__ == "__main__":
    mcp.run(transport=TRANSPORT)
