import os
import sys
from pathlib import Path

_tool_dir = Path(__file__).resolve().parent
_tools_dir = _tool_dir.parent

# 1. Local src/ package is importable
sys.path.insert(0, str(_tool_dir))

# 2. tools/shared/ is importable as tools_shared (mirrors Docker COPY layout)
sys.path.insert(0, str(_tools_dir))
if not (_tools_dir / "tools_shared").exists():
    # The directory is called "shared" on disk but imported as "tools_shared"
    _shared = _tools_dir / "shared"
    if _shared.exists() and str(_shared) not in sys.path:
        sys.path.insert(0, str(_shared.parent))
        import importlib
        import types
        # Create a virtual "tools_shared" package pointing at tools/shared/
        spec = importlib.util.spec_from_file_location(
            "tools_shared",
            _shared / "__init__.py",
            submodule_search_locations=[str(_shared)],
        )
        mod = importlib.util.module_from_spec(spec)
        sys.modules["tools_shared"] = mod
        spec.loader.exec_module(mod)

# 3. Set env-var defaults BEFORE src.server is imported (module-level MCPConfig.from_env())
_defaults = {
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
for k, v in _defaults.items():
    os.environ.setdefault(k, v)

# 4. Pre-import so patch("src.server._opa") can resolve the module
import src.server  # noqa: E402, F401
