"""Find Python files reachable from no entry point.

Walks `import` and `from ... import` statements (AST, not exec) starting
from each entry point, builds the transitive closure of imported modules,
maps modules back to file paths, and prints any .py file in the source
tree that is NOT in the closure.

False positives are likely for:
  - Modules loaded by string (importlib, pkg_resources, plugins)
  - Modules registered via setup.py entry_points
  - Modules touched only by tests we excluded from sources
The output is a *candidate* list — every entry needs a human eye before
deletion.
"""
from __future__ import annotations

import ast
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

ENTRY_POINTS = [
    "agents/analytics-agent/src/app.py",
    "agents/src/server.py",
    "agents/src/enterprise_agent_service.py",
    "tools/data-mcp/src/main.py",
    "tools/data-mcp/src/server.py",
    "tools/salesforce-mcp/src/main.py",
    "tools/salesforce-mcp/src/server.py",
    "tools/payments-mcp/src/main.py",
    "tools/payments-mcp/src/server.py",
    "tools/news-search-mcp/src/main.py",
    "tools/news-search-mcp/src/server.py",
]

SOURCE_ROOTS = [
    "agents",
    "services",
    "tools",
    "platform-sdk/platform_sdk",
]

EXCLUDE_PARTS = {".venv", "__pycache__", "tests", "testdata", "node_modules"}


def all_python_files() -> set[Path]:
    files: set[Path] = set()
    for root in SOURCE_ROOTS:
        root_path = REPO / root
        if not root_path.exists():
            continue
        for p in root_path.rglob("*.py"):
            if any(part in EXCLUDE_PARTS for part in p.parts):
                continue
            files.add(p.resolve())
    return files


def collect_imports(path: Path) -> list[str]:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except (SyntaxError, UnicodeDecodeError):
        return []
    out: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                out.append(alias.name)
        elif isinstance(node, ast.ImportFrom):
            if node.module is None:  # relative `from . import x`
                continue
            out.append(node.module)
    return out


def module_to_paths(module: str, all_files: set[Path]) -> list[Path]:
    """Map a dotted module name to candidate files in our tree."""
    candidates: list[Path] = []
    parts = module.split(".")
    for f in all_files:
        try:
            rel = f.relative_to(REPO)
        except ValueError:
            continue
        rel_parts = rel.with_suffix("").parts
        # Treat a package's __init__.py as the package itself: drop the
        # trailing "__init__" segment so `foo/bar/__init__.py` represents
        # the dotted module `foo.bar`.
        if rel_parts and rel_parts[-1] == "__init__":
            rel_parts = rel_parts[:-1]
        if not rel_parts:
            continue
        # Match suffix: `platform_sdk.auth.context` matches any file
        # ending in those segments.
        if len(rel_parts) >= len(parts) and rel_parts[-len(parts):] == tuple(parts):
            candidates.append(f)
    return candidates


def main() -> int:
    all_files = all_python_files()
    visited: set[Path] = set()
    queue: list[Path] = []

    for ep in ENTRY_POINTS:
        p = (REPO / ep).resolve()
        if p.exists():
            queue.append(p)
        else:
            print(f"WARN: entry point missing: {ep}", file=sys.stderr)

    while queue:
        f = queue.pop()
        if f in visited:
            continue
        visited.add(f)
        for module in collect_imports(f):
            for target in module_to_paths(module, all_files):
                if target not in visited:
                    queue.append(target)

    orphans = sorted(all_files - visited)
    for o in orphans:
        try:
            print(o.relative_to(REPO))
        except ValueError:
            print(o)
    print(f"\n# {len(orphans)} candidate orphan(s) of {len(all_files)} file(s)",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
