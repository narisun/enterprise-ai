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

| Tool          | Findings | Auto | Review | Hold |
|---------------|---------:|-----:|-------:|-----:|
| ruff F401     |       42 |   42 |      0 |    0 |
| ruff F841     |        4 |    4 |      0 |    0 |
| ruff F811     |        0 |    0 |      0 |    0 |
| vulture       |        7 |    0 |      7 |    0 |
| deptry DEP002 |       32 |    0 |     32 |    0 |
| knip          |       27 |    0 |     25 |    2 |
| orphan py     |       33 |    0 |     10 |   23 |

---

## Section 1 — ruff F401/F841/F811 (auto-fix candidates)

### F401 — imported but unused (42 findings)

- [x] `agents/analytics-agent/src/app.py:28:20` — `typing.Any` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/src/graph.py:19:85` — `platform_sdk.setup_checkpointer` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/src/graph.py:23:34` — `.nodes.intent_router.make_intent_router_node` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/src/graph.py:24:36` — `.nodes.mcp_tool_caller.make_mcp_tool_caller_node` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/src/graph.py:25:30` — `.nodes.synthesis.make_synthesis_node` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/src/graph.py:26:34` — `.nodes.error_handler.make_error_handler_node` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/src/middleware/rate_limiter.py:12:21` — `fastapi.Depends` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/src/nodes/synthesis.py:13:22` — `datetime.datetime` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/src/nodes/synthesis.py:13:32` — `datetime.timezone` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/src/nodes/synthesis.py:19:56` — `..schemas.ui_components.UIComponent` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/src/persistence/memory_store.py:9:20` — `typing.Optional` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/src/routes/stream.py:15:8` — `uuid` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/src/routes/stream.py:16:20` — `typing.Optional` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/tests/application/test_chat_endpoint.py:5:24` — `contextlib.contextmanager` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/tests/application/test_chat_endpoint.py:8:8` — `pytest` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/tests/application/test_conversations_endpoint.py:7:8` — `pytest` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/tests/application/test_error_contracts.py:10:24` — `contextlib.contextmanager` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/tests/application/test_thread_id_endpoint.py:11:24` — `contextlib.contextmanager` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/tests/application/test_thread_id_endpoint.py:23:30` — `src.domain.types.ChatRequest` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/tests/component/test_data_stream_encoder.py:8:8` — `pytest` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/tests/component/test_graph_wiring.py:2:8` — `pytest` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/tests/component/test_partial_mcp_connectivity.py:18:8` — `pytest` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/tests/conftest.py:11:20` — `typing.Any` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/tests/integration/test_e2e_streaming.py:23:38` — `unittest.mock.MagicMock` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/tests/integration/test_e2e_streaming.py:24:20` — `typing.AsyncIterator` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/tests/integration/test_e2e_streaming.py:26:37` — `langchain_core.messages.HumanMessage` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/tests/integration/test_e2e_streaming.py:26:51` — `langchain_core.messages.AIMessage` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/tests/unit/test_domain_models.py:8:5` — `src.domain.types.Conversation` imported but unused — tier: `auto` — removed
- [x] `agents/analytics-agent/tests/unit/test_ui_schemas.py:7:5` — `src.schemas.ui_components.KPIDataPoint` imported but unused — tier: `auto` — removed
- [x] `agents/tests/test_graph.py:9:8` — `os` imported but unused — tier: `auto` — removed
- [x] `platform-sdk/platform_sdk/base/application.py:5:40` — `typing.Optional` imported but unused — tier: `auto` — removed
- [x] `services/continuous_embedding_pipeline/src/training/trainer.py:96:43` — `sentence_transformers.InputExample` imported but unused — tier: `auto` — removed
- [x] `services/continuous_embedding_pipeline/tests/test_trainer.py:22:31` — `src.domain.models.DomainCategory` imported but unused — tier: `auto` — removed
- [x] `tests/evals/conftest.py:15:8` — `httpx` imported but unused — tier: `auto` — removed
- [x] `tests/evals/conftest.py:17:8` — `pytest_asyncio` imported but unused — tier: `auto` — removed
- [x] `tests/integration/test_opa_policies.py:11:8` — `pytest_asyncio` imported but unused — tier: `auto` — removed
- [x] `tests/integration/test_payments_sql.py:14:8` — `pytest_asyncio` imported but unused — tier: `auto` — removed
- [x] `tools/data-mcp/src/data_mcp_service.py:9:8` — `json` imported but unused — tier: `auto` — removed
- [x] `tools/data-mcp/src/data_mcp_service.py:16:80` — `platform_sdk.setup_telemetry` imported but unused — tier: `auto` — removed
- [x] `tools/data-mcp/src/data_query_service.py:13:20` — `typing.Optional` imported but unused — tier: `auto` — removed
- [x] `tools/data-mcp/tests/test_server.py:11:8` — `json` imported but unused — tier: `auto` — removed
- [x] `tools/news-search-mcp/src/news_search_service.py:10:25` — `typing.Optional` imported but unused — tier: `auto` — removed

### F841 — local variable assigned but never used (4 findings)

- [x] `agents/analytics-agent/src/routes/stream.py:61:9` — local variable `active_tool_calls` assigned but never used — tier: `auto` — removed
- [x] `agents/analytics-agent/tests/unit/test_fakes_misc.py:37:35` — local variable `span` assigned but never used — tier: `auto` — removed
- [x] `tests/unit/test_setup_checkpointer.py:63:9` — local variable `result` assigned but never used — tier: `auto` — removed
- [x] `tools/payments-mcp/src/payments_service.py:138:17` — local variable `executed_sql` assigned but never used — tier: `auto` — removed

### F811 — redefinition of unused name (0 findings)

_No findings._

---

## Section 2 — vulture (review)

- [~] `agents/analytics-agent/src/ports.py:30` — unused variable `convo_id` (100% confidence) — tier: `review` — kept (Protocol method parameter, part of `ConversationStore.load` contract)
- [~] `agents/analytics-agent/src/ports.py:35` — unused variable `convo_id` (100% confidence) — tier: `review` — kept (Protocol method parameter, part of `ConversationStore.delete` contract)
- [~] `platform-sdk/platform_sdk/security.py:92` — unused variable `exc_tb` (100% confidence) — tier: `review` — kept (`__aexit__` signature fixed by Python context-manager protocol)
- [~] `platform-sdk/platform_sdk/security.py:92` — unused variable `exc_val` (100% confidence) — tier: `review` — kept (`__aexit__` signature fixed by Python context-manager protocol)
- [~] `services/continuous_embedding_pipeline/src/training/trainer.py:40` — unused variable `train_objectives` (100% confidence) — tier: `review` — kept (`SentenceTransformerProtocol.fit` parameter, mirrors external API)
- [~] `services/continuous_embedding_pipeline/src/training/trainer.py:41` — unused variable `epochs` (100% confidence) — tier: `review` — kept (`SentenceTransformerProtocol.fit` parameter, mirrors external API)
- [~] `services/continuous_embedding_pipeline/src/training/trainer.py:48` — unused variable `sentences` (100% confidence) — tier: `review` — kept (`SentenceTransformerProtocol.encode` parameter, mirrors external API)

---

## Section 3 — deptry DEP002 unused deps (review)

### package: `platform-sdk` (pyproject.toml)

- [~] `platform-sdk` — unused declared dep `opentelemetry-sdk` (file: pyproject.toml) — tier: `review` — kept (auto-instrumentation via env vars / opentelemetry-instrument; no static import expected)
- [~] `platform-sdk` — unused declared dep `opentelemetry-exporter-otlp` (file: pyproject.toml) — tier: `review` — kept (auto-instrumentation via env vars / opentelemetry-instrument; no static import expected)
- [~] `platform-sdk` — unused declared dep `opentelemetry-instrumentation-openai` (file: pyproject.toml) — tier: `review` — kept (auto-instrumentation via env vars / opentelemetry-instrument; no static import expected)
- [~] `platform-sdk` — unused declared dep `opentelemetry-instrumentation-langchain` (file: pyproject.toml) — tier: `review` — kept (auto-instrumentation via env vars / opentelemetry-instrument; no static import expected)
- [x] `platform-sdk` — unused declared dep `langchain` (file: pyproject.toml) — tier: `review` — removed
- [~] `platform-sdk` — unused declared dep `pyyaml` (file: pyproject.toml) — tier: `review` — kept (imported in platform_sdk/schema_introspection.py:29)
- [~] `platform-sdk` — unused declared dep `langgraph-checkpoint-postgres` (file: pyproject.toml) — tier: `review` — kept (loaded indirectly by langgraph checkpointer setup)

### package: `agents` (requirements.txt)

- [x] `agents` — unused declared dep `langchain` (file: requirements.txt) — tier: `review` — removed
- [x] `agents` — unused declared dep `langchain-openai` (file: requirements.txt) — tier: `review` — removed
- [x] `agents` — unused declared dep `mcp` (file: requirements.txt) — tier: `review` — removed
- [~] `agents` — unused declared dep `uvicorn` (file: requirements.txt) — tier: `review` — kept (Dockerfile CMD entry point in agents/Dockerfile and agents/analytics-agent/Dockerfile)
- [~] `agents` — unused declared dep `opentelemetry-sdk` (file: requirements.txt) — tier: `review` — kept (auto-instrumentation via env vars / opentelemetry-instrument; no static import expected)
- [~] `agents` — unused declared dep `opentelemetry-exporter-otlp` (file: requirements.txt) — tier: `review` — kept (auto-instrumentation via env vars / opentelemetry-instrument; no static import expected)
- [~] `agents` — unused declared dep `opentelemetry-instrumentation-fastapi` (file: requirements.txt) — tier: `review` — kept (auto-instrumentation via env vars / opentelemetry-instrument; no static import expected)
- [~] `agents` — unused declared dep `langfuse` (file: requirements.txt) — tier: `review` — kept (OTel exporter / runtime use; not statically imported)

### package: `data-mcp` (requirements.txt)

- [x] `data-mcp` — unused declared dep `httpx` (file: requirements.txt) — tier: `review` — removed
- [~] `data-mcp` — unused declared dep `opentelemetry-sdk` (file: requirements.txt) — tier: `review` — kept (auto-instrumentation via env vars / opentelemetry-instrument; no static import expected)
- [~] `data-mcp` — unused declared dep `opentelemetry-exporter-otlp` (file: requirements.txt) — tier: `review` — kept (auto-instrumentation via env vars / opentelemetry-instrument; no static import expected)
- [~] `data-mcp` — unused declared dep `langfuse` (file: requirements.txt) — tier: `review` — kept (OTel exporter / runtime use; not statically imported)

### package: `salesforce-mcp` (requirements.txt)

- [x] `salesforce-mcp` — unused declared dep `httpx` (file: requirements.txt) — tier: `review` — removed
- [~] `salesforce-mcp` — unused declared dep `opentelemetry-sdk` (file: requirements.txt) — tier: `review` — kept (auto-instrumentation via env vars / opentelemetry-instrument; no static import expected)
- [~] `salesforce-mcp` — unused declared dep `opentelemetry-exporter-otlp` (file: requirements.txt) — tier: `review` — kept (auto-instrumentation via env vars / opentelemetry-instrument; no static import expected)
- [~] `salesforce-mcp` — unused declared dep `langfuse` (file: requirements.txt) — tier: `review` — kept (OTel exporter / runtime use; not statically imported)

### package: `payments-mcp` (requirements.txt)

- [x] `payments-mcp` — unused declared dep `httpx` (file: requirements.txt) — tier: `review` — removed
- [~] `payments-mcp` — unused declared dep `opentelemetry-sdk` (file: requirements.txt) — tier: `review` — kept (auto-instrumentation via env vars / opentelemetry-instrument; no static import expected)
- [~] `payments-mcp` — unused declared dep `opentelemetry-exporter-otlp` (file: requirements.txt) — tier: `review` — kept (auto-instrumentation via env vars / opentelemetry-instrument; no static import expected)
- [~] `payments-mcp` — unused declared dep `langfuse` (file: requirements.txt) — tier: `review` — kept (OTel exporter / runtime use; not statically imported)

### package: `news-search-mcp` (requirements.txt)

- [x] `news-search-mcp` — unused declared dep `httpx` (file: requirements.txt) — tier: `review` — removed
- [~] `news-search-mcp` — unused declared dep `tavily-python` (file: requirements.txt) — tier: `review` — kept (used in production with API key; falls back to mocks in dev)
- [~] `news-search-mcp` — unused declared dep `opentelemetry-sdk` (file: requirements.txt) — tier: `review` — kept (auto-instrumentation via env vars / opentelemetry-instrument; no static import expected)
- [~] `news-search-mcp` — unused declared dep `opentelemetry-exporter-otlp` (file: requirements.txt) — tier: `review` — kept (auto-instrumentation via env vars / opentelemetry-instrument; no static import expected)
- [~] `news-search-mcp` — unused declared dep `langfuse` (file: requirements.txt) — tier: `review` — kept (OTel exporter / runtime use; not statically imported)

> **DEP001 findings (missing imports) deliberately skipped** — known noise from editable `platform_sdk` install and `tools/shared/` paths not listed in per-service requirements.txt.

---

## Section 4 — knip unused exports / files / types / deps (review)

### Unused files (9)

- [x] `components/settings/SettingsPanel.tsx` — tier: `review` — removed
- [x] `components/sidebar/NewChatButton.tsx` — tier: `review` — removed
- [x] `components/ui/badge.tsx` — tier: `review` — removed
- [x] `components/ui/button.tsx` — tier: `review` — removed
- [x] `components/ui/card.tsx` — tier: `review` — removed
- [x] `components/ui/collapsible.tsx` — tier: `review` — removed
- [x] `components/ui/input.tsx` — tier: `review` — removed
- [x] `components/ui/sheet.tsx` — tier: `review` — removed
- [x] `components/ui/tooltip.tsx` — tier: `review` — removed

### Unused exports (5)

- [x] `components/charts/chartUtils.ts:formatDateTimeValue` — tier: `review` — removed (export dropped; symbol kept private — used internally by `formatValue`)
- [x] `components/charts/chartUtils.ts:AXIS_LABEL_MAX_LEN` — tier: `review` — removed (export dropped; symbol kept private — used internally by `truncateLabel` / `buildShortNameMap`)
- [x] `components/charts/chartUtils.ts:truncateLabel` — tier: `review` — removed (export dropped; symbol kept private — used internally by `buildShortNameMap`)
- [x] `components/charts/chartUtils.ts:buildShortNameMap` — tier: `review` — removed (export dropped; symbol kept private — no external callers)
- [x] `components/ui/scroll-area.tsx:ScrollBar` — tier: `review` — removed (export dropped; symbol kept private — used internally by `ScrollArea`)

### Unused types (2)

- [x] `lib/types.ts:StreamUIComponent` — tier: `review` — removed (no internal or external references)
- [x] `lib/types.ts:FollowUpSuggestionsData` — tier: `review` — removed (no internal or external references)

### Unused dependencies (7)

- [x] `@radix-ui/react-collapsible` (dependencies, package.json) — tier: `review` — removed (confirmed orphan after file deletes; uninstalled with 51 transitive packages)
- [x] `@radix-ui/react-dialog` (dependencies, package.json) — tier: `review` — removed (confirmed orphan after file deletes; uninstalled with 51 transitive packages)
- [x] `@radix-ui/react-slot` (dependencies, package.json) — tier: `review` — removed (confirmed orphan after file deletes; uninstalled with 51 transitive packages)
- [x] `@radix-ui/react-tooltip` (dependencies, package.json) — tier: `review` — removed (confirmed orphan after file deletes; uninstalled with 51 transitive packages)
- [~] `ai` (dependencies, package.json) — tier: `review` — kept (Vercel AI SDK; `useChat` resolves dynamically; deleting breaks streaming chat)
- [x] `class-variance-authority` (dependencies, package.json) — tier: `review` — removed (orphaned after `button.tsx` delete; no remaining importers; uninstalled)
- [~] `tailwindcss` (devDependencies, package.json) — tier: `review` — kept (used by Tailwind 4 build pipeline via @tailwindcss/postcss; not statically imported)

### Duplicates / unlisted / unresolved (tier: `hold`)

2 unlisted packages found in `postcss.config.mjs`: `postcss`, `postcss-load-config`. These are build infrastructure, not deletion candidates — tier: `hold`.

---

## Section 5 — Orphan Python files (review)

### Review (10)

- [x] `agents/analytics-agent/src/middleware/rate_limiter.py` — tier: `review` — removed (genuinely orphan; never wired into `app.py`, no tests)
- [~] `agents/analytics-agent/src/services/conversation_service.py` — tier: `review` — kept (imported by `routes/conversations.py` and `tests/component/test_conversation_service.py`; finder excludes test roots)
- [~] `platform-sdk/platform_sdk/testing.py` — tier: `review` — kept (imported by `tests/conftest.py` and `tests/integration/conftest.py`; finder excludes test roots)
- [~] `services/continuous_embedding_pipeline/src/container.py` — tier: `review` — kept (DI root for ragas_gate / hard_negatives / trainer; embedding pipeline service is real code)
- [~] `services/continuous_embedding_pipeline/src/evaluation/ragas_gate.py` — tier: `review` — kept (imported by `src/container.py`)
- [~] `services/continuous_embedding_pipeline/src/mining/hard_negatives.py` — tier: `review` — kept (imported by `src/container.py` and `tests/test_mining.py`)
- [~] `services/continuous_embedding_pipeline/src/training/trainer.py` — tier: `review` — kept (imported by `src/container.py` and `tests/test_trainer.py`)
- [~] `tools/shared/_pytest_setup.py` — tier: `review` — kept (loaded via `from shared._pytest_setup import setup_tool_pytest_env` in salesforce-mcp + payments-mcp conftests)
- [~] `tools/shared/mcp_auth.py` — tier: `review` — kept (imported as `tools_shared.mcp_auth` in 6 MCP service files via Dockerfile path alias)
- [x] `tools/shared/tool_error_boundary.py` — tier: `review` — removed (no consumers; README mentions in prose but no code uses it)

### Hold — framework convention, finder can't model (23)

- [?] `agents/analytics-agent/src/__init__.py` — tier: `hold` — framework convention, finder can't model
- [?] `agents/analytics-agent/src/domain/__init__.py` — tier: `hold` — framework convention, finder can't model
- [?] `agents/analytics-agent/src/middleware/__init__.py` — tier: `hold` — framework convention, finder can't model
- [?] `agents/analytics-agent/src/nodes/__init__.py` — tier: `hold` — framework convention, finder can't model
- [?] `agents/analytics-agent/src/routes/__init__.py` — tier: `hold` — framework convention, finder can't model
- [?] `agents/analytics-agent/src/schemas/__init__.py` — tier: `hold` — framework convention, finder can't model
- [?] `agents/analytics-agent/src/streaming/__init__.py` — tier: `hold` — framework convention, finder can't model
- [?] `agents/conftest.py` — tier: `hold` — framework convention, finder can't model
- [?] `agents/src/__init__.py` — tier: `hold` — framework convention, finder can't model
- [?] `services/continuous_embedding_pipeline/src/__init__.py` — tier: `hold` — framework convention, finder can't model
- [?] `services/continuous_embedding_pipeline/src/domain/__init__.py` — tier: `hold` — framework convention, finder can't model
- [?] `services/continuous_embedding_pipeline/src/evaluation/__init__.py` — tier: `hold` — framework convention, finder can't model
- [?] `services/continuous_embedding_pipeline/src/mining/__init__.py` — tier: `hold` — framework convention, finder can't model
- [?] `services/continuous_embedding_pipeline/src/training/__init__.py` — tier: `hold` — framework convention, finder can't model
- [?] `tools/data-mcp/conftest.py` — tier: `hold` — framework convention, finder can't model
- [?] `tools/data-mcp/src/__init__.py` — tier: `hold` — framework convention, finder can't model
- [?] `tools/news-search-mcp/conftest.py` — tier: `hold` — framework convention, finder can't model
- [?] `tools/news-search-mcp/src/__init__.py` — tier: `hold` — framework convention, finder can't model
- [?] `tools/payments-mcp/conftest.py` — tier: `hold` — framework convention, finder can't model
- [?] `tools/payments-mcp/src/__init__.py` — tier: `hold` — framework convention, finder can't model
- [?] `tools/salesforce-mcp/conftest.py` — tier: `hold` — framework convention, finder can't model
- [?] `tools/salesforce-mcp/src/__init__.py` — tier: `hold` — framework convention, finder can't model
- [?] `tools/shared/__init__.py` — tier: `hold` — framework convention, finder can't model

---

## Decision log

- 2026-04-27 — Vulture Section 2: all 7 findings kept. Each is a Protocol method parameter or `__aexit__` standard parameter — names are part of the contract or external API shape, vulture can't see consumers structurally. No source change; no allowlist change (rejected as unnecessary churn for a one-time scan).
- 2026-04-27 — Deptry Section 3: 8 of 32 declared deps removed (4× httpx in MCPs, mcp in agents, langchain in agents and platform-sdk, langchain-openai in agents). 24 kept — runtime auto-instrumentation (OTel + langfuse), Dockerfile entry point (uvicorn), production runtime (tavily-python, langgraph-checkpoint-postgres), or actually imported (pyyaml). Stack smoke deferred to Phase F gate.
- 2026-04-27 — Knip Section 4 (E3): 9 files deleted (`git rm`); 4 exports de-exported in `chartUtils.ts` (symbols retained as private — all had internal callers); `ScrollBar` export dropped from `scroll-area.tsx` (retained privately, used by `ScrollArea`); 2 types (`StreamUIComponent`, `FollowUpSuggestionsData`) fully deleted from `lib/types.ts`; 4 Radix npm deps uninstalled (`react-collapsible`, `react-dialog`, `react-slot`, `react-tooltip`) — all confirmed orphan post file-delete, 51 total packages removed; `class-variance-authority` also confirmed orphan (sole consumer `button.tsx` deleted) — uninstalled; `ai` kept (Vercel AI SDK dynamic use); `tailwindcss` kept (build pipeline). No restorations required. `tsc --noEmit` clean; production build green.
- 2026-04-27 — Orphan files Section 5 (E4): 2 of 10 review-tier candidates removed — `agents/analytics-agent/src/middleware/rate_limiter.py` (genuinely never wired) and `tools/shared/tool_error_boundary.py` (no consumers). 8 kept — verified false positives where the AST finder couldn't see consumers (test-root exclusions, `from foo import submodule` pattern, Dockerfile path aliases). 23 `__init__.py`/`conftest.py` candidates left in hold tier as framework conventions. Per-suite test counts match baseline (no regressions).

---

## Closing notes

_(Empty — populated at end of pass.)_
