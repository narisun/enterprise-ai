"""Backward-compatible entry point for data-mcp server.

DEPRECATED: This module is maintained for backward compatibility.
New code should import from main.py directly.

This shim delegates to main.py which contains the refactored implementation
following the enterprise OOP pattern (DataQueryService + DataMcpService + main.py).
"""
from .main import TRANSPORT, mcp

if __name__ == "__main__":
    mcp.run(transport=TRANSPORT)
