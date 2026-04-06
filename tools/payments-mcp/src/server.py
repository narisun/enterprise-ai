"""Backward-compatible entry point for payments-mcp server.

This module maintains compatibility with existing imports and entry points.
The actual implementation has been refactored to follow the enterprise OOP pattern
and is now split across PaymentsService, PaymentsMcpService, and main.
"""
from .main import TRANSPORT, mcp

if __name__ == "__main__":
    mcp.run(transport=TRANSPORT)
