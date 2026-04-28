# Dead-Code Cleanup — Pass 1 (Python + TS code-level) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Identify and remove unused imports, locals, functions, classes, files, and dependencies across Python (`agents/`, `services/`, `tools/`, `platform-sdk/`) and the Next.js dashboard (`frontends/analytics-dashboard/`), shipping the work as a single PR with no regressions.

**Architecture:** Tiered auto-fix workflow on a dedicated branch `cleanup/pass-1-code`. Tools (ruff, vulture, deptry, knip, custom orphan-graph) produce findings into a single normalized markdown report. High-confidence findings are auto-applied as one commit; medium-confidence findings are reviewed item-by-item with the user, applied in focused commits per category. A test gate (lint + pytest + frontend build + OPA + stack smoke + integration) runs at end of pass before PR.

**Tech Stack:** ruff (existing), vulture, deptry, knip, Python AST stdlib, pytest, Next.js, Make, Docker.

**Scope (this plan):** Pass 1 only. Passes 2 and 3 from the spec get separate plans after Pass 1 merges.

---

## Phase A — Setup

### Task A1: Create the working branch

**Files:**
- Modify: working tree (no file changes)

- [ ] **Step 1: Verify clean working tree**

Run:
```bash
cd /Users/admin-h26/enterprise-ai
git status --short
```

Expected: empty output. If non-empty, stop and surface to user before proceeding.

- [ ] **Step 2: Create and switch to branch**

Run:
```bash
git checkout main
git pull --ff-only
git checkout -b cleanup/pass-1-code
```

Expected: `Switched to a new branch 'cleanup/pass-1-code'`

- [ ] **Step 3: Verify branch**

Run: `git branch --show-current`
Expected: `cleanup/pass-1-code`

---

### Task A2: Install dev tooling into venv

**Files:**
- Create: `requirements-dev.txt` (repo root)

- [ ] **Step 1: Write `requirements-dev.txt`**

Create `/Users/admin-h26/enterprise-ai/requirements-dev.txt`:

```
# Dead-code cleanup tools (dev only — not runtime)
vulture==2.13
deptry==0.20.0
```

- [ ] **Step 2: Install into existing venv**

Run:
```bash
cd /Users/admin-h26/enterprise-ai
.venv/bin/pip install -r requirements-dev.txt
```

Expected: `Successfully installed vulture-2.13 deptry-0.20.0`

- [ ] **Step 3: Verify both tools work**

Run:
```bash
.venv/bin/vulture --version
.venv/bin/deptry --version
```

Expected: version numbers print, exit 0.

- [ ] **Step 4: Install knip in dashboard**

Run:
```bash
cd /Users/admin-h26/enterprise-ai/frontends/analytics-dashboard
npm install --save-dev knip@5
```

Expected: knip appears in `package.json` `devDependencies`.

- [ ] **Step 5: Verify knip works**

Run: `npx knip --version`
Expected: `5.x.x` prints, exit 0.

- [ ] **Step 6: Commit tooling setup**

Run:
```bash
cd /Users/admin-h26/enterprise-ai
git add requirements-dev.txt frontends/analytics-dashboard/package.json frontends/analytics-dashboard/package-lock.json
git commit -m "chore(cleanup): add vulture, deptry, knip as dev tooling for pass 1"
```

---

### Task A3: Write the allowlist config

**Files:**
- Create: `cleanup/vulture-allowlist.py`
- Create: `frontends/analytics-dashboard/knip.json`
- Create: `cleanup/README.md`

- [ ] **Step 1: Create the cleanup directory**

Run:
```bash
mkdir -p /Users/admin-h26/enterprise-ai/cleanup
```

- [ ] **Step 2: Write vulture allowlist**

Create `/Users/admin-h26/enterprise-ai/cleanup/vulture-allowlist.py`:

```python
# Vulture allowlist — names that look unused but ARE reached at runtime.
# Run: vulture <paths> cleanup/vulture-allowlist.py --min-confidence 80
#
# Format: each line is a `_.<name>` reference. Vulture treats this file
# as code that uses the listed names, suppressing false positives.

# FastAPI route handlers (decorators register them; vulture can't see calls)
_.startup
_.shutdown
_.lifespan
_.health
_.root

# LangGraph node __call__ handlers — invoked by the StateGraph runtime
_.__call__

# Pydantic v2 model_config / model_validator hooks
_.model_config
_.model_post_init
_.model_validate
_.model_dump

# pytest fixtures and conftest hooks
_.pytest_collection_modifyitems
_.pytest_configure
_.pytest_sessionstart
_.pytest_sessionfinish

# MCP server handler decorators
_.list_tools
_.call_tool
_.list_resources
_.read_resource

# OpenTelemetry / structlog setup hooks called by string
_.configure_logging
_.configure_tracing
```

- [ ] **Step 3: Write knip config**

Create `/Users/admin-h26/enterprise-ai/frontends/analytics-dashboard/knip.json`:

```json
{
  "$schema": "https://unpkg.com/knip@5/schema.json",
  "entry": [
    "app/**/page.{ts,tsx}",
    "app/**/layout.{ts,tsx}",
    "app/**/route.{ts,tsx}",
    "app/**/loading.{ts,tsx}",
    "app/**/error.{ts,tsx}",
    "app/**/not-found.{ts,tsx}",
    "middleware.ts",
    "next.config.{js,ts,mjs}",
    "tailwind.config.{js,ts}",
    "postcss.config.{js,mjs}"
  ],
  "project": ["**/*.{ts,tsx}"],
  "ignore": ["**/.next/**", "**/node_modules/**"],
  "ignoreDependencies": [
    "@types/*",
    "eslint-*",
    "@tailwindcss/*"
  ]
}
```

- [ ] **Step 4: Write the cleanup README**

Create `/Users/admin-h26/enterprise-ai/cleanup/README.md`:

```markdown
# Cleanup — supporting files for the dead-code cleanup workstream

This directory holds files that support the cleanup passes described in
`docs/superpowers/specs/2026-04-27-dead-code-cleanup-design.md`.

- `vulture-allowlist.py` — names vulture sees as unused but are reached
  via decorators, dynamic dispatch, or framework conventions. Pass this
  file as an extra positional arg to vulture so it stays in the import
  graph.
- `pass1-findings.md` — generated during Pass 1 scan (see plan).

Pass 2 and Pass 3 will add their own findings files.
```

- [ ] **Step 5: Commit allowlist and config**

Run:
```bash
cd /Users/admin-h26/enterprise-ai
git add cleanup/vulture-allowlist.py cleanup/README.md frontends/analytics-dashboard/knip.json
git commit -m "chore(cleanup): allowlist + knip config for pass 1 scans"
```

---

## Phase B — Scan

### Task B1: Run ruff with the unused-imports/locals selectors (no fix)

**Files:**
- Create: `/tmp/cleanup-pass1/ruff.txt` (raw output, scratch)

- [ ] **Step 1: Make the scratch directory**

Run: `mkdir -p /tmp/cleanup-pass1`

- [ ] **Step 2: Dry-run ruff to see all findings**

Run:
```bash
cd /Users/admin-h26/enterprise-ai
.venv/bin/ruff check --select F401,F841,F811 --no-fix --output-format=concise . > /tmp/cleanup-pass1/ruff.txt 2>&1 || true
wc -l /tmp/cleanup-pass1/ruff.txt
head -40 /tmp/cleanup-pass1/ruff.txt
```

Expected: a list of `path:line:col: F401|F841|F811 ...` findings. Save count.

---

### Task B2: Run vulture against Python source

**Files:**
- Create: `/tmp/cleanup-pass1/vulture.txt` (scratch)

- [ ] **Step 1: Run vulture with allowlist, min-confidence 80**

Run:
```bash
cd /Users/admin-h26/enterprise-ai
.venv/bin/vulture \
  agents/ services/ tools/ platform-sdk/ \
  cleanup/vulture-allowlist.py \
  --min-confidence 80 \
  --exclude '*/tests/*,*/.venv/*,*/__pycache__/*,*/testdata/*' \
  > /tmp/cleanup-pass1/vulture.txt 2>&1 || true
wc -l /tmp/cleanup-pass1/vulture.txt
head -40 /tmp/cleanup-pass1/vulture.txt
```

Expected: lines like `path/to/file.py:42: unused function 'foo' (90% confidence)`.

---

### Task B3: Run deptry

**Files:**
- Create: `/tmp/cleanup-pass1/deptry.txt` (scratch)

- [ ] **Step 1: Identify the dependency manifests to scan**

Run:
```bash
cd /Users/admin-h26/enterprise-ai
find . -maxdepth 4 -name "pyproject.toml" -not -path "*/.venv/*" -not -path "*/node_modules/*"
find . -maxdepth 4 -name "requirements*.txt" -not -path "*/.venv/*" -not -path "*/node_modules/*"
```

Expected: list of pyproject.toml and requirements files. Note them.

- [ ] **Step 2: Run deptry on each Python package**

For the root and each package with its own `pyproject.toml` or `requirements.txt`, run deptry. Start with the most likely targets:

```bash
cd /Users/admin-h26/enterprise-ai
.venv/bin/deptry platform-sdk/ \
  --json-output /tmp/cleanup-pass1/deptry-platform-sdk.json 2>&1 \
  | tee -a /tmp/cleanup-pass1/deptry.txt || true

.venv/bin/deptry agents/ \
  --json-output /tmp/cleanup-pass1/deptry-agents.json 2>&1 \
  | tee -a /tmp/cleanup-pass1/deptry.txt || true

for tool in data-mcp salesforce-mcp payments-mcp news-search-mcp; do
  .venv/bin/deptry tools/$tool/ \
    --json-output /tmp/cleanup-pass1/deptry-$tool.json 2>&1 \
    | tee -a /tmp/cleanup-pass1/deptry.txt || true
done

cat /tmp/cleanup-pass1/deptry.txt
```

Expected: JSON files written, summary of `DEP001` (missing) and `DEP002` (unused) per package. We act only on `DEP002` in Pass 1.

---

### Task B4: Run knip on the dashboard

**Files:**
- Create: `/tmp/cleanup-pass1/knip.json` (scratch)

- [ ] **Step 1: Run knip with the existing config**

Run:
```bash
cd /Users/admin-h26/enterprise-ai/frontends/analytics-dashboard
npx knip --reporter json > /tmp/cleanup-pass1/knip.json 2>/tmp/cleanup-pass1/knip.err || true
echo "--- stderr ---"
cat /tmp/cleanup-pass1/knip.err
echo "--- summary ---"
jq '{files: (.files|length), exports: (.exports|length), types: (.types|length), dependencies: (.dependencies|length)}' /tmp/cleanup-pass1/knip.json
```

Expected: JSON with arrays for `files`, `exports`, `types`, `dependencies`, `unlisted` (etc.). Summary line with counts.

---

### Task B5: Build the AST orphan-file graph for Python

**Files:**
- Create: `cleanup/orphan_files.py` (one-shot script — kept in repo as audit trail)
- Create: `/tmp/cleanup-pass1/orphans.txt` (scratch)

- [ ] **Step 1: Write the orphan finder script**

Create `/Users/admin-h26/enterprise-ai/cleanup/orphan_files.py`:

```python
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
        # Match suffix: e.g. `platform_sdk.auth.context` matches any file
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
```

- [ ] **Step 2: Run the orphan finder**

Run:
```bash
cd /Users/admin-h26/enterprise-ai
.venv/bin/python cleanup/orphan_files.py > /tmp/cleanup-pass1/orphans.txt 2>/tmp/cleanup-pass1/orphans.stderr.txt
cat /tmp/cleanup-pass1/orphans.stderr.txt
echo "--- candidates ---"
head -40 /tmp/cleanup-pass1/orphans.txt
wc -l /tmp/cleanup-pass1/orphans.txt
```

Expected: a list of `.py` files that no entry point reaches. Stderr has a count summary.

- [ ] **Step 3: Sanity-check the script's own coverage**

Run: `grep -c "platform_sdk" /tmp/cleanup-pass1/orphans.txt || echo "0 matches — good"`

Expected: zero or very few matches. If many `platform_sdk` files appear orphan, the entry-point list is incomplete or the module-resolver has a bug — stop and surface to user.

- [ ] **Step 4: Commit the script**

The script is small enough to keep in the repo as the audit trail for which files were considered:

```bash
cd /Users/admin-h26/enterprise-ai
git add cleanup/orphan_files.py
git commit -m "chore(cleanup): AST orphan-file finder for pass 1"
```

---

## Phase C — Normalize

### Task C1: Build the findings report

**Files:**
- Create: `cleanup/pass1-findings.md`

- [ ] **Step 1: Write the findings report skeleton**

Create `/Users/admin-h26/enterprise-ai/cleanup/pass1-findings.md`:

````markdown
# Pass 1 — Findings (Python + TS code-level cleanup)

**Branch:** `cleanup/pass-1-code`
**Date:** 2026-04-27
**Tools:** ruff F401/F841/F811, vulture, deptry, knip, custom orphan finder
**Spec:** `docs/superpowers/specs/2026-04-27-dead-code-cleanup-design.md`

## Legend

- `auto` — high-confidence, safe to fix mechanically (`ruff --fix`)
- `review` — needs human eyes; default action is delete unless flagged below
- `hold` — suspicious; leave for later
- Status: `[ ] pending` → `[x] removed` / `[~] kept` / `[?] hold`

## Summary

| Tool       | Findings | Auto | Review | Hold |
|------------|---------:|-----:|-------:|-----:|
| ruff F401  |        ? |    ? |      ? |    ? |
| ruff F841  |        ? |    ? |      ? |    ? |
| ruff F811  |        ? |    ? |      ? |    ? |
| vulture    |        ? |    ? |      ? |    ? |
| deptry     |        ? |    ? |      ? |    ? |
| knip       |        ? |    ? |      ? |    ? |
| orphan py  |        ? |    ? |      ? |    ? |

## Section 1 — ruff F401/F841/F811 (auto-fix candidates)

<!-- Populated from /tmp/cleanup-pass1/ruff.txt; default tier: auto -->

## Section 2 — vulture (review)

<!-- Populated from /tmp/cleanup-pass1/vulture.txt; default tier: review -->

## Section 3 — deptry DEP002 unused deps (review)

<!-- Populated from /tmp/cleanup-pass1/deptry-*.json; default tier: review -->

## Section 4 — knip unused exports / files / types / deps (review)

<!-- Populated from /tmp/cleanup-pass1/knip.json; default tier: review -->

## Section 5 — Orphan Python files (review)

<!-- Populated from /tmp/cleanup-pass1/orphans.txt; default tier: review -->

## Decision log

<!-- Append "what we kept and why" notes here as we go through review. -->
````

- [ ] **Step 2: Populate Sections 1–5 from the scratch files**

For each scratch file in `/tmp/cleanup-pass1/`, paste relevant content into the corresponding section as a markdown table or a checkbox list, with these columns:

```
- [ ] `path/to/file.py:LINE` — `<kind>` — tier: `auto|review|hold` — note: `<why>`
```

Default tiers per section:
- Section 1 (ruff): all `auto`
- Sections 2–5: all `review`

Update the Summary table counts.

This step is mechanical — paste output, format as bullets, set tier per default.

- [ ] **Step 3: Commit the report (pre-review state)**

```bash
cd /Users/admin-h26/enterprise-ai
git add cleanup/pass1-findings.md
git commit -m "chore(cleanup): pass 1 findings report (pre-review)"
```

---

## Phase D — Auto-fix

### Task D1: Apply ruff `--fix` to the auto-tier findings

**Files:**
- Modify: every Python file with F401/F841/F811 findings
- Modify: `cleanup/pass1-findings.md`

- [ ] **Step 1: Capture ruff output once more, with `--fix`**

Run:
```bash
cd /Users/admin-h26/enterprise-ai
.venv/bin/ruff check --select F401,F841,F811 --fix --output-format=concise . \
  > /tmp/cleanup-pass1/ruff-fix.txt 2>&1 || true
cat /tmp/cleanup-pass1/ruff-fix.txt
```

Expected: each finding shows `[*]` indicating an auto-fix was applied; tail line says e.g. `Found N errors (N fixed, 0 remaining).`

- [ ] **Step 2: Verify the changes look reasonable**

Run:
```bash
git diff --stat
git diff | head -120
```

Expected: stat shows files touched; sample diff shows removed `import` lines, removed unused local assignments. **No** semantic logic changes.

- [ ] **Step 3: Run the fast Python test suite**

Run:
```bash
cd /Users/admin-h26/enterprise-ai
.venv/bin/pytest tests/unit/ agents/analytics-agent/tests/unit/ \
  agents/analytics-agent/tests/component/ \
  agents/analytics-agent/tests/application/ \
  tools/data-mcp/tests/ tools/payments-mcp/tests/ \
  tools/salesforce-mcp/tests/ tools/news-search-mcp/tests/ \
  -q 2>&1 | tail -30
```

Expected: all tests pass. If any fail, identify the file ruff broke (likely an import that *was* used via `__all__` or string lookup), revert that file's changes with `git checkout -- <file>`, mark the finding `hold` in the report, and re-run tests.

- [ ] **Step 4: Run ruff format check**

Run: `.venv/bin/ruff format --check .`
Expected: `N files already formatted` (no changes needed). If any file needs reformatting, run `.venv/bin/ruff format <file>` and re-stage.

- [ ] **Step 5: Update findings report**

Mark every Section 1 item as `[x] removed` (or `[~] kept` if reverted in step 3). Update Summary table.

- [ ] **Step 6: Commit the auto-fix**

```bash
cd /Users/admin-h26/enterprise-ai
git add -A
git commit -m "chore(cleanup): auto-fix unused imports/locals/redefinitions (ruff F401/F841/F811)"
```

---

## Phase E — Review-tier walkthrough

### Task E1: Walk vulture findings with the user

**Files:**
- Modify: any Python file where a finding is approved for removal
- Modify: `cleanup/pass1-findings.md`

- [ ] **Step 1: Pause for user review**

Surface to the user: present each Section 2 (vulture) finding one-by-one or in small batches. For each, the user picks: `delete`, `keep` (add to allowlist or annotate), or `hold`.

DO NOT skip this checkpoint. Vulture flags symbols that look unused statically but may be reached by:
  - Decorator-based dispatch (FastAPI, MCP)
  - Plugin / entry-point discovery
  - Reflection (`getattr`, `importlib`)
  - Public API of `platform-sdk` consumed by services not in the import graph

- [ ] **Step 2: Apply the approved deletions**

For each approved finding, edit the file to remove the symbol. Keep edits surgical — remove only the flagged def/class/attr and any of its now-orphaned local helpers (verify by running vulture again after each batch).

- [ ] **Step 3: Run the fast test suite after each batch of ~5 deletions**

Run:
```bash
cd /Users/admin-h26/enterprise-ai
.venv/bin/pytest tests/unit/ agents/analytics-agent/tests/unit/ \
  agents/analytics-agent/tests/component/ \
  agents/analytics-agent/tests/application/ \
  tools/data-mcp/tests/ tools/payments-mcp/tests/ \
  tools/salesforce-mcp/tests/ tools/news-search-mcp/tests/ \
  -q 2>&1 | tail -10
```

Expected: green. If red, the deleted symbol was actually reached by a test — restore via `git checkout -- <file>`, mark `kept`, and add an allowlist entry if appropriate.

- [ ] **Step 4: Update findings report (Section 2 + Decision log)**

Mark each finding `[x] removed` / `[~] kept` / `[?] hold`. For non-obvious decisions, add a short entry to the Decision log explaining why.

- [ ] **Step 5: Commit by logical group**

Group by package or file area (e.g. all platform-sdk removals in one commit, all data-mcp removals in another):

```bash
cd /Users/admin-h26/enterprise-ai
git add platform-sdk/
git commit -m "chore(cleanup): remove unreferenced helpers in platform-sdk (vulture)"
# repeat for each logical group
```

---

### Task E2: Walk deptry DEP002 findings with the user

**Files:**
- Modify: `pyproject.toml` (root, `platform-sdk/`) or `requirements.txt` files
- Modify: `cleanup/pass1-findings.md`

- [ ] **Step 1: Pause for user review**

Present each `DEP002` finding (per-package). For each, user decides `remove` or `keep` (e.g. indirect runtime use, kept for transitive policy reasons).

- [ ] **Step 2: Edit the manifest(s) to remove approved deps**

For each approved removal:
- If it's in `pyproject.toml`, edit the `[project] dependencies` array.
- If it's in `requirements*.txt`, edit the file.
- Re-pin / re-lock if a lockfile is present.

- [ ] **Step 3: Reinstall the venv to drop removed packages**

Run:
```bash
cd /Users/admin-h26/enterprise-ai
.venv/bin/pip install -e platform-sdk/ --quiet
.venv/bin/pip install -r requirements-dev.txt --quiet
```

Expected: pip resolves successfully. If a removed dep is actually transitively required, pip will surface the conflict — restore that dep, mark `kept`.

- [ ] **Step 4: Boot the stack to verify runtime imports**

Run:
```bash
cd /Users/admin-h26/enterprise-ai
make setup
sleep 30
docker ps --format '{{.Names}}\t{{.Status}}'
curl -fsS http://localhost:8086/health
curl -fsS http://localhost:8000/health
make stop
```

Expected: all containers `Up`, both health endpoints return 200. If any container crashes with `ModuleNotFoundError`, restore the removed dep, mark `kept`.

- [ ] **Step 5: Update findings report**

Mark each Section 3 finding `[x] removed` / `[~] kept`. Update Summary table.

- [ ] **Step 6: Commit**

```bash
cd /Users/admin-h26/enterprise-ai
git add -A
git commit -m "chore(cleanup): drop unused Python deps flagged by deptry"
```

---

### Task E3: Walk knip findings with the user

**Files:**
- Modify: TS/TSX files with unused exports
- Modify: `frontends/analytics-dashboard/package.json` (unused deps)
- Modify: `cleanup/pass1-findings.md`

- [ ] **Step 1: Pause for user review**

Present each Section 4 finding grouped by knip category:
- **Unused exports** — usually safe to remove if no other module imports them
- **Unused files** — same as orphan files, needs eyeballing
- **Unused types** — safe to remove
- **Unused dependencies** — safe to remove from `package.json`

User picks `delete` / `keep` / `hold` per finding.

- [ ] **Step 2: Apply the approved deletions**

For each approved item:
- Unused export: edit file to remove the export and (if the symbol is now unreferenced internally) the symbol itself.
- Unused file: `git rm <file>`.
- Unused type: edit to remove.
- Unused dep: `npm uninstall <pkg>`.

- [ ] **Step 3: Run the dashboard build after each batch of ~5 deletions**

Run:
```bash
cd /Users/admin-h26/enterprise-ai/frontends/analytics-dashboard
npx tsc --noEmit
npm run lint
```

Expected: type-check and lint pass. If red, restore via `git checkout -- <files>` and mark `kept`.

- [ ] **Step 4: Run the production build at the end of all dashboard edits**

Run: `npm run build`
Expected: build succeeds, no missing-module errors.

- [ ] **Step 5: Update findings report**

Mark each Section 4 finding. Update Summary table.

- [ ] **Step 6: Commit**

```bash
cd /Users/admin-h26/enterprise-ai
git add -A
git commit -m "chore(cleanup): remove unused exports, files, types, deps in dashboard (knip)"
```

---

### Task E4: Walk orphan-file candidates with the user

**Files:**
- Delete: any approved orphan `.py` file
- Modify: `cleanup/pass1-findings.md`

- [ ] **Step 1: Pause for user review**

Present each Section 5 candidate. For each, user picks `delete` / `keep` / `hold`. Default to `hold` unless the user is confident — orphan-graph false positives are common with dynamic loaders.

- [ ] **Step 2: Delete approved orphans**

```bash
cd /Users/admin-h26/enterprise-ai
git rm <path/to/orphan.py>
# repeat per approved file
```

- [ ] **Step 3: Run the fast test suite**

Run:
```bash
.venv/bin/pytest tests/unit/ agents/analytics-agent/tests/unit/ \
  agents/analytics-agent/tests/component/ \
  agents/analytics-agent/tests/application/ \
  tools/data-mcp/tests/ tools/payments-mcp/tests/ \
  tools/salesforce-mcp/tests/ tools/news-search-mcp/tests/ \
  -q 2>&1 | tail -10
```

Expected: green. If red, restore: `git restore --staged <file> && git checkout -- <file>` and mark `kept`.

- [ ] **Step 4: Boot the stack**

Run:
```bash
make setup && sleep 30
docker ps --format '{{.Names}}\t{{.Status}}'
curl -fsS http://localhost:8086/health
curl -fsS http://localhost:8000/health
make stop
```

Expected: green. If a container crashes on import, restore the file and mark `kept`.

- [ ] **Step 5: Update findings report**

Mark each Section 5 finding. Update Summary table.

- [ ] **Step 6: Commit**

```bash
cd /Users/admin-h26/enterprise-ai
git add -A
git commit -m "chore(cleanup): remove orphan Python files unreached from any entry point"
```

---

## Phase F — Test gate

### Task F1: Run the full Pass 1 gate

**Files:**
- Read-only: capture outputs to `/tmp/cleanup-pass1/gate.log`

- [ ] **Step 1: Capture a starting baseline diff**

Run:
```bash
cd /Users/admin-h26/enterprise-ai
git log main..HEAD --oneline
git diff --stat main..HEAD | tail -5
```

Expected: list of cleanup commits and total lines added/removed.

- [ ] **Step 2: Lint**

Run:
```bash
.venv/bin/ruff check . | tee /tmp/cleanup-pass1/gate.log
.venv/bin/ruff format --check . | tee -a /tmp/cleanup-pass1/gate.log
```

Expected: both clean.

- [ ] **Step 3: Python tests (no Docker)**

Run:
```bash
.venv/bin/pytest tests/unit/ agents/analytics-agent/tests/unit/ \
  agents/analytics-agent/tests/component/ agents/analytics-agent/tests/application/ \
  tools/data-mcp/tests/ tools/payments-mcp/tests/ \
  tools/salesforce-mcp/tests/ tools/news-search-mcp/tests/ \
  -q 2>&1 | tee -a /tmp/cleanup-pass1/gate.log
```

Expected: all green.

- [ ] **Step 4: Frontend type-check, lint, and build**

Run:
```bash
cd /Users/admin-h26/enterprise-ai/frontends/analytics-dashboard
npx tsc --noEmit 2>&1 | tee -a /tmp/cleanup-pass1/gate.log
npm run lint 2>&1 | tee -a /tmp/cleanup-pass1/gate.log
npm run build 2>&1 | tee -a /tmp/cleanup-pass1/gate.log
cd -
```

Expected: all three green.

- [ ] **Step 5: OPA tests**

Run:
```bash
cd /Users/admin-h26/enterprise-ai/tools/policies/opa
opa test . 2>&1 | tee -a /tmp/cleanup-pass1/gate.log
cd -
```

Expected: all OPA tests pass.

- [ ] **Step 6: Stack smoke**

Run:
```bash
cd /Users/admin-h26/enterprise-ai
make setup 2>&1 | tee -a /tmp/cleanup-pass1/gate.log
sleep 30
docker ps --format '{{.Names}}\t{{.Status}}' | tee -a /tmp/cleanup-pass1/gate.log
curl -fsS http://localhost:8086/health | tee -a /tmp/cleanup-pass1/gate.log
echo "" | tee -a /tmp/cleanup-pass1/gate.log
curl -fsS http://localhost:8000/health | tee -a /tmp/cleanup-pass1/gate.log
echo "" | tee -a /tmp/cleanup-pass1/gate.log
curl -fsS http://localhost:13133/ | tee -a /tmp/cleanup-pass1/gate.log
not_up=$(docker ps --format '{{.Names}} {{.Status}}' | grep -v 'Up' | wc -l | tr -d ' ')
echo "non-Up containers: $not_up" | tee -a /tmp/cleanup-pass1/gate.log
test "$not_up" = "0"
```

Expected: every container `Up`; all three health curls return 200; `not_up == 0`.

- [ ] **Step 7: Integration tests against the running stack**

Run:
```bash
.venv/bin/pytest tests/integration/test_payments_sql.py -m integration 2>&1 | tee -a /tmp/cleanup-pass1/gate.log
.venv/bin/pytest tests/integration/test_opa_policies.py -m integration 2>&1 | tee -a /tmp/cleanup-pass1/gate.log
```

Expected: green.

- [ ] **Step 8: Stop the stack**

Run: `make stop`
Expected: containers stop, volumes preserved.

- [ ] **Step 9: If anything in steps 2–7 was red**

Stop and surface to user with the failing output. Either:
- Revert the most recent suspect cleanup commit (`git revert HEAD`) and re-run gate.
- Restore a specific file and update findings report (`[~] kept`).

DO NOT proceed to Phase G until the gate is fully green.

---

## Phase G — Finalize and PR

### Task G1: Final report and PR

**Files:**
- Modify: `cleanup/pass1-findings.md` (mark complete + final stats)

- [ ] **Step 1: Update findings report — final state**

Update Summary table with final counts. Append a "Closing notes" section listing:
- Total commits in Pass 1
- Total lines removed (`git diff --stat main..HEAD | tail -1`)
- Test gate result: PASSED on `<date>`
- Items in `[?] hold` with reasons (these become candidates for Pass 2/3 or future cleanup)

- [ ] **Step 2: Commit the final report**

```bash
cd /Users/admin-h26/enterprise-ai
git add cleanup/pass1-findings.md
git commit -m "chore(cleanup): pass 1 findings report (final, gate green)"
```

- [ ] **Step 3: Push the branch**

Run:
```bash
git push -u origin cleanup/pass-1-code
```

Expected: branch pushed, remote URL printed.

- [ ] **Step 4: Open the PR**

Run (from repo root):
```bash
gh pr create --title "chore(cleanup): pass 1 — Python + TS code-level dead code" --body "$(cat <<'EOF'
## Summary

- Pass 1 of the dead-code cleanup workstream defined in `docs/superpowers/specs/2026-04-27-dead-code-cleanup-design.md`.
- Auto-fixed unused imports / locals / redefinitions across the Python monorepo (ruff F401/F841/F811).
- Removed unreferenced functions / classes / files / Python deps after manual review (vulture, deptry, custom orphan finder).
- Removed unused exports / files / types / npm deps in the dashboard after manual review (knip).
- Findings tracked in `cleanup/pass1-findings.md` with per-item disposition.

## Test plan

- [ ] `ruff check .` — green
- [ ] `ruff format --check .` — green
- [ ] All Python unit/component/application tests — green
- [ ] Dashboard `tsc --noEmit`, `npm run lint`, `npm run build` — green
- [ ] `opa test tools/policies/opa/` — green
- [ ] `make setup` boots the full 12-container stack; all health endpoints 200
- [ ] Integration tests: `test_payments_sql.py` + `test_opa_policies.py` — green

Gate output captured in `/tmp/cleanup-pass1/gate.log` during execution.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 5: Surface the PR URL to the user**

Report to user: "Pass 1 PR opened at <URL>. Gate green. Ready for review and merge. Pass 2 plan will be written after this merges."

---

## Self-review checklist (run before handing off plan)

- [ ] Every spec section (Tooling, Allowlist, Pass 1 plan, Per-pass loop, Test gate, Failure modes) maps to at least one task here.
- [ ] No "TBD" / "implement later" / "fill in" / "handle edge cases" placeholders.
- [ ] Every test gate command in the spec appears in Phase F.
- [ ] Every removal flow (auto, review, orphan) ends with a test-suite or stack-smoke verification before commit.
- [ ] Tool versions pinned (`vulture==2.13`, `deptry==0.20.0`, `knip@5`).
- [ ] Branch name and PR title use spec terminology (`cleanup/pass-1-code`, "pass 1 — Python + TS code-level").
