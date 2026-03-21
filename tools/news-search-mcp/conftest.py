import os
import sys
from pathlib import Path

# 1. Local src/ package is importable
sys.path.insert(0, str(Path(__file__).resolve().parent))

# 2. Set env-var defaults BEFORE src.server is imported (module-level MCPConfig.from_env())
_defaults = {
    "OPA_URL": "http://localhost:8181/v1/data/mcp/tools/allow",
    "INTERNAL_API_KEY": "test-key",
    "MCP_TRANSPORT": "sse",
}
for k, v in _defaults.items():
    os.environ.setdefault(k, v)

# 3. Pre-import so patch("src.server._opa") can resolve the module
import src.server  # noqa: E402, F401
