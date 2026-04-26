"""
Shared pytest setup helper for tools that depend on tools_shared and a
PostgreSQL-backed MCP server.

Usage in each tool's conftest.py:

    from tools.shared._pytest_setup import setup_tool_pytest_env
    setup_tool_pytest_env(__file__)
"""
from __future__ import annotations

import importlib
import importlib.util
import os
import sys
from pathlib import Path


def setup_tool_pytest_env(conftest_file: str, extra_env: dict | None = None) -> None:
    """Configure sys.path and os.environ defaults for a tool's test suite.

    Parameters
    ----------
    conftest_file:
        Pass ``__file__`` from the calling conftest.py.  Used to derive
        the tool directory and the shared tools/ parent directory.
    extra_env:
        Optional extra environment-variable defaults to set in addition
        to the standard set.  Values are applied with os.environ.setdefault.
    """
    tool_dir = Path(conftest_file).resolve().parent
    tools_dir = tool_dir.parent

    # 1. Local src/ package is importable.
    if str(tool_dir) not in sys.path:
        sys.path.insert(0, str(tool_dir))

    # 2. tools/shared/ is importable as tools_shared (mirrors Docker COPY layout).
    if str(tools_dir) not in sys.path:
        sys.path.insert(0, str(tools_dir))

    if not (tools_dir / "tools_shared").exists():
        _shared = tools_dir / "shared"
        if _shared.exists() and "tools_shared" not in sys.modules:
            spec = importlib.util.spec_from_file_location(
                "tools_shared",
                _shared / "__init__.py",
                submodule_search_locations=[str(_shared)],
            )
            mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
            sys.modules["tools_shared"] = mod
            spec.loader.exec_module(mod)  # type: ignore[union-attr]

    # 3. Standard env-var defaults for database-backed MCP servers.
    _defaults: dict[str, str] = {
        "OPA_URL": "http://localhost:8181/v1/data/mcp/tools/allow",
        "INTERNAL_API_KEY": "test-key",
        "JWT_SECRET": "test-secret",
        "CONTEXT_HMAC_SECRET": "test-hmac-secret",
        "MCP_TRANSPORT": "sse",
        "DB_HOST": "localhost",
        "DB_USER": "test",
        "DB_PASS": "test",
        "DB_NAME": "test",
    }
    if extra_env:
        _defaults.update(extra_env)
    for k, v in _defaults.items():
        os.environ.setdefault(k, v)
