"""
agents/conftest.py — path bootstrap for agent unit tests.

When pytest collects agents/tests/ from the monorepo root (i.e. via
the testpaths entry in pyproject.toml), it needs `agents/` on sys.path
so that `from src.graph import ...` resolves to agents/src/graph.py.

This conftest is discovered automatically by pytest before any test in
agents/tests/ is imported; it mirrors the pattern used by each tool's
own conftest.py.
"""
import os
import sys
from pathlib import Path

# Add the agents/ directory to sys.path so `import src.*` works.
_agents_dir = Path(__file__).resolve().parent
if str(_agents_dir) not in sys.path:
    sys.path.insert(0, str(_agents_dir))

# Provide env-var defaults so the module-level code in src/graph.py
# doesn't raise on import when credentials are absent.
_defaults = {
    "LITELLM_BASE_URL": "http://localhost:4000/v1",
    "INTERNAL_API_KEY": "test-key-for-unit-tests",
    "AGENT_MODEL_ROUTE": "complex-routing",
}
for _k, _v in _defaults.items():
    os.environ.setdefault(_k, _v)
