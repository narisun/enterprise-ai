# PEP 8 Module Rename Sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename 18 PascalCase Python module files to PEP 8-compliant `lowercase_with_underscores` across `platform-sdk/`, `agents/src/`, and `tools/*/src/`, with **zero behavior change**.

**Architecture:** Mechanical rename in 8 logical groups (one per package directory). Each group: `git mv` → update sibling imports → update package `__init__.py` re-exports → update consumer imports across the repo → verify with grep → run tests + ruff → commit. Public API stays stable because every renamed module is re-exported by its package `__init__.py` under the same symbol name.

**Tech Stack:** Python 3.11+, ruff, pytest, `git mv` (preserves blame/history).

**Why this is Phase 0a (prerequisite to every other refactor):** every later refactor patch would otherwise pay an extra rebase/merge tax for files renamed mid-flight. Doing this first makes every later diff smaller and reviewable.

**Key invariants enforced at every commit:**

- `make test-unit` passes (or shows the same passing count as the pre-refactor baseline).
- `ruff check platform-sdk agents tools services` passes (or no new errors vs. baseline).
- `python -c "from platform_sdk import Application, Agent, McpService, AgentBuilder, ChatLLMFactory, CheckpointerFactory, ApiKeyVerifier, AgentConfig, MCPConfig"` succeeds.

**macOS case-insensitivity caveat:** On default APFS the filesystem is case-insensitive but case-preserving. For two case-only renames (`Application.py` → `application.py`, `Agent.py` → `agent.py`), use a two-step `git mv` through a temporary name; otherwise git treats source and destination as the same file and silently no-ops.

---

## Pre-flight

### Task 0: Establish baseline

**Files:** none (read-only)

- [ ] **Step 1: Confirm working directory and clean state**

```bash
pwd
git status --short
```
Expected: `/Users/admin-h26/enterprise-ai`. Pre-existing modified files in `frontends/analytics-dashboard/` are unrelated to this work and may remain unstaged. No backend file should be modified at this point.

- [ ] **Step 2: Capture baseline test result**

```bash
make test-unit 2>&1 | tee /tmp/baseline-tests.log | tail -20
```
Expected: green summary. Record the passed/failed counts; this is the regression baseline for every commit below.

- [ ] **Step 3: Capture baseline ruff result**

```bash
ruff check platform-sdk agents tools services 2>&1 | tee /tmp/baseline-ruff.log | tail -20
```
Expected: zero errors, or note the count of pre-existing issues to ignore.

- [ ] **Step 4: Confirm pre-rename public API import works**

```bash
python -c "from platform_sdk import Application, Agent, McpService, AgentBuilder, ChatLLMFactory, CheckpointerFactory, ApiKeyVerifier, AgentConfig, MCPConfig; print('ok')"
```
Expected: `ok`. This same command runs after every group below to prove the public surface is unchanged.

---

## Task 1: Rename `platform_sdk.base.*`

**Files:**
- Rename: `platform-sdk/platform_sdk/base/Application.py` → `application.py` (case-only — two-step)
- Rename: `platform-sdk/platform_sdk/base/Agent.py` → `agent.py` (case-only — two-step)
- Rename: `platform-sdk/platform_sdk/base/McpService.py` → `mcp_service.py`
- Modify: `platform-sdk/platform_sdk/base/__init__.py:2-4`
- Modify: `platform-sdk/platform_sdk/base/agent.py:6` (sibling import after rename)
- Modify: `platform-sdk/platform_sdk/base/mcp_service.py:7` (sibling import after rename)

- [ ] **Step 1: Rename files (preserve git history; case-only via temp name)**

```bash
git mv platform-sdk/platform_sdk/base/Application.py platform-sdk/platform_sdk/base/_application_tmp.py
git mv platform-sdk/platform_sdk/base/_application_tmp.py platform-sdk/platform_sdk/base/application.py

git mv platform-sdk/platform_sdk/base/Agent.py platform-sdk/platform_sdk/base/_agent_tmp.py
git mv platform-sdk/platform_sdk/base/_agent_tmp.py platform-sdk/platform_sdk/base/agent.py

git mv platform-sdk/platform_sdk/base/McpService.py platform-sdk/platform_sdk/base/mcp_service.py
```

- [ ] **Step 2: Update sibling imports inside renamed files**

In `platform-sdk/platform_sdk/base/agent.py`, line 6:
```python
# Before
from .Application import Application
# After
from .application import Application
```

In `platform-sdk/platform_sdk/base/mcp_service.py`, line 7:
```python
# Before
from .Application import Application
# After
from .application import Application
```

- [ ] **Step 3: Replace `__init__.py` re-exports**

Overwrite `platform-sdk/platform_sdk/base/__init__.py` with:
```python
"""Enterprise AI Platform — Application base class hierarchy."""
from .application import Application
from .agent import Agent
from .mcp_service import McpService

__all__ = ["Application", "Agent", "McpService"]
```

- [ ] **Step 4: Verify no stale imports remain**

```bash
grep -rn "from platform_sdk\.base\.\(Application\|Agent\|McpService\)\|from \.\(Application\|McpService\)\b\|from \.Agent import" --include="*.py" platform-sdk agents tools services tests
```
Expected: zero matches. (Note: `from .agent import` lowercase in `platform-sdk/platform_sdk/__init__.py:54` is a *different* module, `platform_sdk/agent.py` — that one stays.)

- [ ] **Step 5: Run targeted tests + ruff**

```bash
make test-unit && ruff check platform-sdk
python -c "from platform_sdk import Application, Agent, McpService; print('ok')"
```
Expected: tests green, ruff clean, `ok` printed.

- [ ] **Step 6: Commit**

```bash
git add platform-sdk/platform_sdk/base/
git commit -m "refactor(platform-sdk): rename base/ modules to PEP 8 snake_case

- base/Application.py → base/application.py
- base/Agent.py       → base/agent.py
- base/McpService.py  → base/mcp_service.py

Public API unchanged: Application, Agent, McpService remain re-exported
from platform_sdk.base. Pure mechanical rename — zero behavior change.
History preserved via git mv (case-only renames via temp name)."
```

---

## Task 2: Rename `platform_sdk.services.*`

**Files:**
- Rename: `platform-sdk/platform_sdk/services/AgentBuilder.py` → `agent_builder.py`
- Rename: `platform-sdk/platform_sdk/services/ApiKeyVerifier.py` → `api_key_verifier.py`
- Rename: `platform-sdk/platform_sdk/services/ChatLLMFactory.py` → `chat_llm_factory.py`
- Rename: `platform-sdk/platform_sdk/services/CheckpointerFactory.py` → `checkpointer_factory.py`
- Modify: `platform-sdk/platform_sdk/services/__init__.py:2-5`
- Modify: `platform-sdk/platform_sdk/services/agent_builder.py:14` (sibling import)

- [ ] **Step 1: Rename files**

```bash
git mv platform-sdk/platform_sdk/services/AgentBuilder.py      platform-sdk/platform_sdk/services/agent_builder.py
git mv platform-sdk/platform_sdk/services/ApiKeyVerifier.py    platform-sdk/platform_sdk/services/api_key_verifier.py
git mv platform-sdk/platform_sdk/services/ChatLLMFactory.py    platform-sdk/platform_sdk/services/chat_llm_factory.py
git mv platform-sdk/platform_sdk/services/CheckpointerFactory.py platform-sdk/platform_sdk/services/checkpointer_factory.py
```

- [ ] **Step 2: Update sibling import**

In `platform-sdk/platform_sdk/services/agent_builder.py`, line 14:
```python
# Before
from .ChatLLMFactory import ChatLLMFactory
# After
from .chat_llm_factory import ChatLLMFactory
```

- [ ] **Step 3: Replace `__init__.py` re-exports**

Overwrite `platform-sdk/platform_sdk/services/__init__.py` with:
```python
"""Enterprise AI Platform — Service classes (one class per file)."""
from .agent_builder import AgentBuilder
from .chat_llm_factory import ChatLLMFactory
from .checkpointer_factory import CheckpointerFactory
from .api_key_verifier import ApiKeyVerifier

__all__ = ["AgentBuilder", "ChatLLMFactory", "CheckpointerFactory", "ApiKeyVerifier"]
```

- [ ] **Step 4: Verify no stale imports remain**

```bash
grep -rn "from platform_sdk\.services\.\(AgentBuilder\|ApiKeyVerifier\|ChatLLMFactory\|CheckpointerFactory\)\|from \.\(AgentBuilder\|ApiKeyVerifier\|ChatLLMFactory\|CheckpointerFactory\)" --include="*.py" platform-sdk agents tools services tests
```
Expected: zero matches.

- [ ] **Step 5: Run tests + ruff**

```bash
make test-unit && ruff check platform-sdk
python -c "from platform_sdk import AgentBuilder, ChatLLMFactory, CheckpointerFactory, ApiKeyVerifier; print('ok')"
```
Expected: green + `ok`.

- [ ] **Step 6: Commit**

```bash
git add platform-sdk/platform_sdk/services/
git commit -m "refactor(platform-sdk): rename services/ modules to PEP 8 snake_case

- services/AgentBuilder.py        → services/agent_builder.py
- services/ApiKeyVerifier.py      → services/api_key_verifier.py
- services/ChatLLMFactory.py      → services/chat_llm_factory.py
- services/CheckpointerFactory.py → services/checkpointer_factory.py

Public API unchanged; re-exports updated."
```

---

## Task 3: Rename `platform_sdk.config.*`

**Files:**
- Rename: `platform-sdk/platform_sdk/config/AgentConfig.py` → `agent_config.py`
- Rename: `platform-sdk/platform_sdk/config/MCPConfig.py` → `mcp_config.py`
- Modify: `platform-sdk/platform_sdk/config/__init__.py:13-14`

- [ ] **Step 1: Rename files**

```bash
git mv platform-sdk/platform_sdk/config/AgentConfig.py platform-sdk/platform_sdk/config/agent_config.py
git mv platform-sdk/platform_sdk/config/MCPConfig.py   platform-sdk/platform_sdk/config/mcp_config.py
```

- [ ] **Step 2: Update `__init__.py` re-exports**

In `platform-sdk/platform_sdk/config/__init__.py`, lines 13-14:
```python
# Before
from .AgentConfig import AgentConfig
from .MCPConfig import MCPConfig
# After
from .agent_config import AgentConfig
from .mcp_config import MCPConfig
```

- [ ] **Step 3: Verify no stale imports remain**

```bash
grep -rn "from platform_sdk\.config\.\(AgentConfig\|MCPConfig\)\|from \.\(AgentConfig\|MCPConfig\)" --include="*.py" platform-sdk agents tools services tests
```
Expected: zero matches.

- [ ] **Step 4: Run tests + ruff**

```bash
make test-unit && ruff check platform-sdk
python -c "from platform_sdk import AgentConfig, MCPConfig; print('ok')"
```
Expected: green + `ok`.

- [ ] **Step 5: Commit**

```bash
git add platform-sdk/platform_sdk/config/
git commit -m "refactor(platform-sdk): rename config/ modules to PEP 8 snake_case

- config/AgentConfig.py → config/agent_config.py
- config/MCPConfig.py   → config/mcp_config.py

Public API unchanged; re-exports updated."
```

---

## Task 4: Rename `agents/src/EnterpriseAgentService.py`

**Files:**
- Rename: `agents/src/EnterpriseAgentService.py` → `enterprise_agent_service.py`
- Modify: `agents/src/server.py:17`

- [ ] **Step 1: Rename file**

```bash
git mv agents/src/EnterpriseAgentService.py agents/src/enterprise_agent_service.py
```

- [ ] **Step 2: Update consumer import**

In `agents/src/server.py`, line 17:
```python
# Before
from .EnterpriseAgentService import EnterpriseAgentService
# After
from .enterprise_agent_service import EnterpriseAgentService
```

- [ ] **Step 3: Verify no stale imports remain**

```bash
grep -rn "EnterpriseAgentService\.py\|from.*EnterpriseAgentService import\|from \.EnterpriseAgentService" --include="*.py" agents
```
Expected: only matches inside `agents/src/server.py` (post-edit) referencing the new path; zero matches of the PascalCase path.

- [ ] **Step 4: Run targeted agent tests + ruff**

```bash
pytest agents/tests/ -q
ruff check agents/src
```
Expected: green; matches baseline.

- [ ] **Step 5: Commit**

```bash
git add agents/src/
git commit -m "refactor(agents): rename EnterpriseAgentService.py to enterprise_agent_service.py

PEP 8 module naming; sole import in agents/src/server.py updated."
```

---

## Task 5: Rename `tools/data-mcp/src/*Service.py`

**Files:**
- Rename: `tools/data-mcp/src/DataMcpService.py` → `data_mcp_service.py`
- Rename: `tools/data-mcp/src/DataQueryService.py` → `data_query_service.py`
- Modify: `tools/data-mcp/src/main.py:11` (consumer)
- Modify: `tools/data-mcp/src/data_mcp_service.py:21` (sibling import)

- [ ] **Step 1: Rename files**

```bash
git mv tools/data-mcp/src/DataMcpService.py   tools/data-mcp/src/data_mcp_service.py
git mv tools/data-mcp/src/DataQueryService.py tools/data-mcp/src/data_query_service.py
```

- [ ] **Step 2: Update sibling import in renamed file**

In `tools/data-mcp/src/data_mcp_service.py`, line 21:
```python
# Before
from .DataQueryService import DataQueryService
# After
from .data_query_service import DataQueryService
```

- [ ] **Step 3: Update consumer import**

In `tools/data-mcp/src/main.py`, line 11:
```python
# Before
from .DataMcpService import DataMcpService
# After
from .data_mcp_service import DataMcpService
```

- [ ] **Step 4: Verify no stale imports remain**

```bash
grep -rn "DataMcpService\.py\|DataQueryService\.py\|from \.DataMcpService\|from \.DataQueryService" --include="*.py" tools/data-mcp
```
Expected: zero matches.

- [ ] **Step 5: Run targeted tests + ruff**

```bash
pytest tools/data-mcp/tests/ -q
ruff check tools/data-mcp
```
Expected: green; matches baseline.

- [ ] **Step 6: Commit**

```bash
git add tools/data-mcp/src/
git commit -m "refactor(tools/data-mcp): rename service modules to PEP 8 snake_case

- src/DataMcpService.py   → src/data_mcp_service.py
- src/DataQueryService.py → src/data_query_service.py"
```

---

## Task 6: Rename `tools/payments-mcp/src/*Service.py`

**Files:**
- Rename: `tools/payments-mcp/src/PaymentsMcpService.py` → `payments_mcp_service.py`
- Rename: `tools/payments-mcp/src/PaymentsService.py` → `payments_service.py`
- Modify: `tools/payments-mcp/src/main.py:11` (consumer)
- Modify: `tools/payments-mcp/src/payments_mcp_service.py:19` (sibling import)

- [ ] **Step 1: Rename files**

```bash
git mv tools/payments-mcp/src/PaymentsMcpService.py tools/payments-mcp/src/payments_mcp_service.py
git mv tools/payments-mcp/src/PaymentsService.py    tools/payments-mcp/src/payments_service.py
```

- [ ] **Step 2: Update sibling import in renamed file**

In `tools/payments-mcp/src/payments_mcp_service.py`, line 19:
```python
# Before
from .PaymentsService import PaymentsService
# After
from .payments_service import PaymentsService
```

- [ ] **Step 3: Update consumer import**

In `tools/payments-mcp/src/main.py`, line 11:
```python
# Before
from .PaymentsMcpService import PaymentsMcpService
# After
from .payments_mcp_service import PaymentsMcpService
```

- [ ] **Step 4: Verify no stale imports remain**

```bash
grep -rn "PaymentsMcpService\.py\|PaymentsService\.py\|from \.PaymentsMcpService\|from \.PaymentsService" --include="*.py" tools/payments-mcp
```
Expected: zero matches.

- [ ] **Step 5: Run targeted tests + ruff**

```bash
pytest tools/payments-mcp/tests/ -q
ruff check tools/payments-mcp
```
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add tools/payments-mcp/src/
git commit -m "refactor(tools/payments-mcp): rename service modules to PEP 8 snake_case

- src/PaymentsMcpService.py → src/payments_mcp_service.py
- src/PaymentsService.py    → src/payments_service.py"
```

---

## Task 7: Rename `tools/news-search-mcp/src/*Service.py`

**Files:**
- Rename: `tools/news-search-mcp/src/NewsSearchMcpService.py` → `news_search_mcp_service.py`
- Rename: `tools/news-search-mcp/src/NewsSearchService.py` → `news_search_service.py`
- Modify: `tools/news-search-mcp/src/main.py:11` (consumer)
- Modify: `tools/news-search-mcp/src/news_search_mcp_service.py:21` (sibling import)

- [ ] **Step 1: Rename files**

```bash
git mv tools/news-search-mcp/src/NewsSearchMcpService.py tools/news-search-mcp/src/news_search_mcp_service.py
git mv tools/news-search-mcp/src/NewsSearchService.py    tools/news-search-mcp/src/news_search_service.py
```

- [ ] **Step 2: Update sibling import in renamed file**

In `tools/news-search-mcp/src/news_search_mcp_service.py`, line 21:
```python
# Before
from .NewsSearchService import NewsSearchService
# After
from .news_search_service import NewsSearchService
```

- [ ] **Step 3: Update consumer import**

In `tools/news-search-mcp/src/main.py`, line 11:
```python
# Before
from .NewsSearchMcpService import NewsSearchMcpService
# After
from .news_search_mcp_service import NewsSearchMcpService
```

- [ ] **Step 4: Verify no stale imports remain**

```bash
grep -rn "NewsSearchMcpService\.py\|NewsSearchService\.py\|from \.NewsSearchMcpService\|from \.NewsSearchService" --include="*.py" tools/news-search-mcp
```
Expected: zero matches.

- [ ] **Step 5: Run targeted tests + ruff**

```bash
pytest tools/news-search-mcp/tests/ -q
ruff check tools/news-search-mcp
```
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add tools/news-search-mcp/src/
git commit -m "refactor(tools/news-search-mcp): rename service modules to PEP 8 snake_case

- src/NewsSearchMcpService.py → src/news_search_mcp_service.py
- src/NewsSearchService.py    → src/news_search_service.py"
```

---

## Task 8: Rename `tools/salesforce-mcp/src/*Service.py`

**Files:**
- Rename: `tools/salesforce-mcp/src/SalesforceMcpService.py` → `salesforce_mcp_service.py`
- Rename: `tools/salesforce-mcp/src/SalesforceService.py` → `salesforce_service.py`
- Modify: `tools/salesforce-mcp/src/main.py:11` (consumer)
- Modify: `tools/salesforce-mcp/src/salesforce_mcp_service.py:24` (sibling import)

- [ ] **Step 1: Rename files**

```bash
git mv tools/salesforce-mcp/src/SalesforceMcpService.py tools/salesforce-mcp/src/salesforce_mcp_service.py
git mv tools/salesforce-mcp/src/SalesforceService.py    tools/salesforce-mcp/src/salesforce_service.py
```

- [ ] **Step 2: Update sibling import in renamed file**

In `tools/salesforce-mcp/src/salesforce_mcp_service.py`, line 24:
```python
# Before
from .SalesforceService import SalesforceService
# After
from .salesforce_service import SalesforceService
```

- [ ] **Step 3: Update consumer import**

In `tools/salesforce-mcp/src/main.py`, line 11:
```python
# Before
from .SalesforceMcpService import SalesforceMcpService
# After
from .salesforce_mcp_service import SalesforceMcpService
```

- [ ] **Step 4: Verify no stale imports remain**

```bash
grep -rn "SalesforceMcpService\.py\|SalesforceService\.py\|from \.SalesforceMcpService\|from \.SalesforceService" --include="*.py" tools/salesforce-mcp
```
Expected: zero matches.

- [ ] **Step 5: Run targeted tests + ruff**

```bash
pytest tools/salesforce-mcp/tests/ -q
ruff check tools/salesforce-mcp
```
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add tools/salesforce-mcp/src/
git commit -m "refactor(tools/salesforce-mcp): rename service modules to PEP 8 snake_case

- src/SalesforceMcpService.py → src/salesforce_mcp_service.py
- src/SalesforceService.py    → src/salesforce_service.py"
```

---

## Final verification

### Task 9: Repo-wide proof

**Files:** none (read-only)

- [ ] **Step 1: Confirm zero PascalCase `.py` files remain in production paths**

```bash
find platform-sdk agents tools services -type f -name '[A-Z]*.py' -not -path '*/__pycache__/*' -not -path '*/.venv/*'
```
Expected: zero output. (Test files in `tests/` directories are out of scope; they already use snake_case.)

- [ ] **Step 2: Confirm zero stale imports across the entire repo**

```bash
grep -rEn "from \.(Application|Agent|McpService|AgentBuilder|ApiKeyVerifier|ChatLLMFactory|CheckpointerFactory|AgentConfig|MCPConfig|EnterpriseAgentService|DataMcpService|DataQueryService|PaymentsMcpService|PaymentsService|NewsSearchMcpService|NewsSearchService|SalesforceMcpService|SalesforceService) import" --include="*.py" platform-sdk agents tools services tests
grep -rEn "from platform_sdk\.(base|services|config)\.[A-Z]" --include="*.py" platform-sdk agents tools services tests
```
Expected: zero matches from both commands. Note: imports of `platform_sdk.agent` (lowercase, the top-level module) are **not** the same as `platform_sdk.base.Agent` and should remain unchanged.

- [ ] **Step 3: Confirm full public API still imports**

```bash
python -c "from platform_sdk import (Application, Agent, McpService, AgentBuilder, ChatLLMFactory, CheckpointerFactory, ApiKeyVerifier, AgentConfig, MCPConfig); print('public api ok')"
```
Expected: `public api ok`.

- [ ] **Step 4: Run full unit-test suite**

```bash
make test-all-unit 2>&1 | tail -25
```
Expected: matches Task 0 baseline pass count exactly.

- [ ] **Step 5: Run repo-wide ruff**

```bash
ruff check platform-sdk agents tools services
```
Expected: matches Task 0 baseline (zero new errors).

- [ ] **Step 6: Smoke-test imports of every renamed module by full path**

```bash
python -c "
from platform_sdk.base.application import Application
from platform_sdk.base.agent import Agent
from platform_sdk.base.mcp_service import McpService
from platform_sdk.services.agent_builder import AgentBuilder
from platform_sdk.services.chat_llm_factory import ChatLLMFactory
from platform_sdk.services.checkpointer_factory import CheckpointerFactory
from platform_sdk.services.api_key_verifier import ApiKeyVerifier
from platform_sdk.config.agent_config import AgentConfig
from platform_sdk.config.mcp_config import MCPConfig
print('all snake_case paths importable')
"
```
Expected: `all snake_case paths importable`.

- [ ] **Step 7: Final commit if any cleanup-only changes accumulated**

If steps 1–6 produced any stray modifications (formatting, etc.), stage and commit with:
```bash
git status --short
git add -p   # only stage clearly-related cleanup
git commit -m "chore: cleanup after PEP 8 module rename sweep"
```
Otherwise: no commit; the eight per-group commits already represent the work.

---

## Rollback plan

If any task fails its verification step (4 or 5), the engineer should:

1. `git status` — confirm only the current task's files are modified.
2. `git restore --staged --worktree platform-sdk agents tools` (or the relevant subset).
3. Re-read the failing grep / pytest output to identify the missed import or sibling reference.
4. Re-attempt the task; do not commit until verification passes.

If a commit was already made and a downstream task surfaces a missed import, fix forward with a follow-up commit referencing the prior one — do **not** rebase or amend across pushed history.

---

## Out of scope (deliberately deferred)

- Removing the `platform_sdk/base/` inheritance hierarchy (that is finding **A2** in the review; covered by a later plan).
- Refactoring the service factories (finding **A3**; later plan).
- Any behavioral fix to MCP servers (T1–T8; later plan).
- Touching `tests/` directory layouts (TS1–TS11; later plan).

This plan changes **filenames and import paths only**. No class rename, no signature change, no logic change.
