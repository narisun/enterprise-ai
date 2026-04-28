# Dead-Code Cleanup — Design

**Date:** 2026-04-27
**Owner:** sundar.narisetti@gmail.com
**Status:** Proposed (awaiting plan)

## Goal

Identify and remove unused code across the entire `enterprise-ai` monorepo — Python, TypeScript, Rego, SQL, Docker/compose, Makefile, scripts, env vars, and commented-out code blocks — without breaking the running stack or the test suites.

## Scope

All languages and asset types in the repo:

- Python: `agents/`, `services/`, `tools/`, `platform-sdk/`, `tests/`
- TypeScript / React: `frontends/analytics-dashboard/`
- Rego: `tools/policies/opa/`
- SQL: `platform/db/`, `testdata/`
- Infra/wiring: `docker-compose.yml`, `Makefile`, `scripts/`, `.env.example`

Out of scope: `infra/azure/` Terraform (revisited separately per `README.md`), `docker-compose.cloud.yml` (legacy, marked pending).

## Non-goals

- Refactoring (no boundary changes, no renames, no abstractions added or removed)
- Performance work
- Dependency upgrades
- Test coverage expansion beyond what's needed to verify removals are safe
- Cleanup of `infra/azure/` Terraform or `docker-compose.cloud.yml`

## Approach

Three sequential passes, one PR per pass, executed with the **tiered auto-fix** workflow: high-confidence findings auto-applied, medium-confidence reviewed item-by-item, low-confidence held.

### Tooling

| Layer | Tool | Catches | Confidence |
|---|---|---|---|
| Python imports/locals | `ruff check --select F401,F841,F811 --fix` | unused imports, locals, redefined names | high (auto) |
| Python funcs/classes | `vulture --min-confidence 80` | unreferenced defs, classes, attrs | medium (review) |
| Python orphan files | custom AST import graph from entry points | files no entry point reaches | medium (review) |
| Python deps | `deptry` | declared in `pyproject.toml`, never imported (`DEP002`) | high (review for indirect deps) |
| TS/JS unused exports + deps | `knip` | unused exports, files, deps, types | medium-high |
| Rego dead rules | `opa check` + grep call graph | rules nothing imports/calls | medium |
| SQL orphans | grep schema names against codebase | tables/cols with no readers | low (manual) |
| Docker/compose | `yq` parse + grep service refs | services no other service depends on | medium |
| Make targets | grep targets vs CI + README + Makefile | unreached targets | medium |
| Scripts | grep `scripts/*` vs Makefile/CI/docs | unreferenced scripts | medium |
| Env vars | grep `.env.example` keys vs `os.getenv` / `process.env` | declared, never read | medium |
| Commented-out code | `ruff check --select ERA001` (eradicate rules) | commented code blocks | low |

New dev-only deps (`vulture`, `deptry`, `knip`) installed into `.venv` and `frontends/analytics-dashboard/node_modules`. Not added to runtime dependencies.

### Allowlist (anti-false-positive)

Baked into `cleanup.toml` at repo root, consumed by `vulture` / `knip` / `deptry`:

- FastAPI: `@router.get/post/put/delete/...` decorated handlers
- LangGraph: classes used as graph nodes (callable classes registered in `build_analytics_graph`)
- Pydantic: subclasses of `BaseModel` (fields read by validation, not directly)
- pytest: `test_*` functions, `conftest.py` fixtures, all `tests/` directories
- Jinja: prompt template files loaded by string in `PromptLoader`
- MCP: `@server.call_tool()` and `@server.list_tools()` decorated handlers
- Next.js: `page.tsx`, `layout.tsx`, `route.ts`, `loading.tsx`, `error.tsx`, server actions, middleware

### Pass plan

**Pass 1 — Python + TS code-level cleanup** (branch: `cleanup/pass-1-code`)

- `ruff --fix` for imports/locals across the monorepo (auto)
- `vulture` over Python source dirs (review)
- `deptry` against root + `platform-sdk/` (review)
- `knip` in `frontends/analytics-dashboard/` (mixed)
- AST orphan-file graph seeded from these entry points:
  - `agents/analytics-agent/src/app.py`
  - `agents/src/server.py` and `agents/src/enterprise_agent_service.py`
  - For each MCP (`data-mcp`, `salesforce-mcp`, `payments-mcp`, `news-search-mcp`): both `tools/<mcp>/src/main.py` and `tools/<mcp>/src/server.py`
  - Every `tests/` root and every `conftest.py`
  - Dashboard `frontends/analytics-dashboard/app/` and any `pages/` (Next.js convention files: `page.tsx`, `layout.tsx`, `route.ts`, `loading.tsx`, `error.tsx`, `middleware.ts`)

**Pass 2 — Wiring / infra cleanup** (branch: `cleanup/pass-2-wiring`)

- Diff `docker-compose.yml` services against actual `depends_on` graph + container references in code → flag unused services
- `Makefile` targets vs CI workflows (`.github/workflows/*.yml`), `README.md`, `docs/`, other targets → flag unreached
- `scripts/` files vs Makefile, CI, docs, `pyproject.toml` → flag unreferenced
- `.env.example` keys vs `os.getenv` / `process.env` references → flag unused env vars

**Pass 3 — Policy / data / commented code** (branch: `cleanup/pass-3-policy`, optional)

- Rego call graph across `tools/policies/opa/` → flag unreachable rules
- SQL: list `bankdw.*` and `salesforce.*` tables/columns from init scripts; grep references in `tools/data-mcp/`, `tools/payments-mcp/`, `tools/salesforce-mcp/`, `testdata/` → flag orphans
- `ruff --select ERA001` for commented-out code

Pass 3 is gated on appetite after Passes 1 and 2 ship.

### Per-pass process loop

1. **Scan** — run all tools for the pass, dump raw output.
2. **Normalize** — consolidate into `docs/superpowers/cleanup/passN-findings.md` with columns: `file:line | kind | tool | confidence | suggested-action`.
3. **Tier** each finding: `auto`, `review`, or `hold`.
4. **Auto** — apply `auto`-tier fixes in one commit (`chore(cleanup): auto-fix unused imports/locals`).
5. **Review** — walk `review`-tier together; decide keep / delete / annotate. Group decisions into focused commits (`chore(cleanup): remove orphan files in services/X`, `chore(cleanup): drop unused dep tavily-python from data-mcp`).
6. **Gate** — run the test gate (below). On failure: stop, fix or revert most recent commit, re-run.
7. **Commit report** — final commit is the findings report itself with each finding marked `removed` / `kept` / `hold`.
8. **PR** — open one PR per pass; merge on green gate + user approval.

### Test gate (per pass)

```bash
# Lint
ruff check .
ruff format --check .

# Python tests (no Docker)
.venv/bin/pytest tests/unit/ -q
.venv/bin/pytest agents/analytics-agent/tests/unit/ -q
.venv/bin/pytest agents/analytics-agent/tests/component/ -q
.venv/bin/pytest agents/analytics-agent/tests/application/ -q
.venv/bin/pytest tools/data-mcp/tests/ -q
.venv/bin/pytest tools/payments-mcp/tests/ -q
.venv/bin/pytest tools/salesforce-mcp/tests/ -q
.venv/bin/pytest tools/news-search-mcp/tests/ -q

# Frontend
(cd frontends/analytics-dashboard && npx tsc --noEmit && npm run lint && npm run build)

# OPA
(cd tools/policies/opa && opa test .)

# Stack smoke (end of pass only)
make setup
sleep 30
curl -fsS http://localhost:8086/health
curl -fsS http://localhost:8000/health
curl -fsS http://localhost:13133/
docker ps --format '{{.Names}}\t{{.Status}}' | grep -v 'Up' && exit 1 || echo OK
make stop

# Integration tests (Pass 1 only)
.venv/bin/pytest tests/integration/test_payments_sql.py -m integration
.venv/bin/pytest tests/integration/test_opa_policies.py -m integration
```

**Stop conditions:**

- Any test that was passing on `main` before the pass now fails.
- `make setup` does not reach "Stack ready".
- `next build` fails.
- Any health endpoint returns non-200.

## Architecture / data flow

```
[scan] -> raw tool output
   |
   v
[normalize] -> findings.md (file | kind | tool | confidence | action)
   |
   v
[tier] auto / review / hold
   |
   +--> auto-bucket --> ruff --fix / mechanical edits --> commit
   |
   +--> review-bucket --> human walk-through --> grouped commits
   |
   +--> hold-bucket --> annotated, no action
   |
   v
[gate] lint + tests + frontend build + OPA + stack smoke
   |
   v (green)
[PR] one per pass
```

## Failure modes and mitigations

| Risk | Mitigation |
|---|---|
| Dynamic dispatch missed (LangGraph node by string, Jinja template by name, OPA policy ref) | Allowlist + every review-tier deletion eyeballed; uncertain → hold. |
| Tests pass but stack boot breaks | `make setup` smoke at end of each pass. |
| Removed dep something needs at runtime | Only act on `deptry` `DEP002`; verify with `make setup` boot. |
| `knip` flags Next.js convention files | `knip.json` allowlist for `page.tsx`, `route.ts`, `layout.tsx`, etc. |
| Removed Make target / script that CI uses | Grep `.github/workflows/*.yml` before flagging. |
| Breakage after PR merges | One PR per pass + `git revert` as escape hatch; findings report has exact removal commands. |
| Cleanup races user's in-progress work | `git status` clean precondition; one branch per pass. |

## Definition of done (per pass)

1. Findings report committed and complete (every finding marked `removed` / `kept` / `hold`).
2. Test gate green, output captured.
3. PR opened with summary linking to the report.
4. User approves merge.

## Definition of done (overall)

- Pass 1 PR merged.
- Pass 2 PR merged.
- Pass 3 PR merged or explicitly deferred by user.
- Three findings reports archived under `docs/superpowers/cleanup/`.
- No regressions in test gate vs `main` baseline at start of work.

## Open questions

None at design time. Tier decisions on individual findings will be made during each pass's review step.
