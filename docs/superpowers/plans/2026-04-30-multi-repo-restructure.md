# Multi-Repo Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carve the `enterprise-ai` monorepo into one shared SDK repo (`ai-platform-sdk`) plus one repo per agent / MCP / frontend, all consuming the SDK via a pinned git URL and a pre-baked base Docker image — so service developers extend `BaseAgent` / `McpService` and get cross-cutting concerns (logging, telemetry, auth, OPA, cache, MCP bridge, persistence) for free.

**Architecture:** Two-track distribution. (1) Production Docker images inherit from `ghcr.io/narisun/ai-python-base:3.11-sdk{X.Y.Z}` which has the SDK pre-installed — service Dockerfiles add only their own extras. (2) Local dev / CI installs the SDK via `pip install` against a git-tag pin (`enterprise-ai-platform-sdk @ git+ssh://git@github.com/narisun/ai-platform-sdk.git@vX.Y.Z`). All work happens inside the existing monorepo first (Phases 1–4) so each step is reversible and CI stays green; only the final phase splits the repos via `git filter-repo`.

**Tech Stack:** Python 3.11, FastAPI, LangGraph, LangChain, FastMCP, OpenTelemetry, structlog, asyncpg, Redis, OPA, GitHub Actions, GHCR, Docker, `git filter-repo`.

---

## Glossary

| Item | Value |
|---|---|
| GitHub org | `narisun` (https://github.com/narisun) |
| SDK package name | `enterprise-ai-platform-sdk` |
| SDK version (this milestone) | `0.4.0` (current is `0.3.0`) |
| Base Docker image | `ghcr.io/narisun/ai-python-base` |
| Base image tag (this milestone) | `3.11-sdk0.4.0` |
| Floating dev tag (never pin in prod) | `3.11-sdk-latest` |
| Per-repo branch model | `main` (trunk) + `release/0.4` + tags `v0.4.0`, `v0.4.1` |
| SDK pin form | `enterprise-ai-platform-sdk @ git+ssh://git@github.com/narisun/ai-platform-sdk.git@v0.4.0` |

## Final Repo Layout

```
github.com/narisun/
├── ai-platform-sdk        (the "common" repo — owns SDK + base image)
├── ai-agent-analytics
├── ai-mcp-data
├── ai-mcp-salesforce
├── ai-mcp-payments
├── ai-mcp-news-search
├── ai-frontend-analytics
└── ai-dev-stack           (docker-compose, Makefile, OPA policies, integration tests)
```

(`infra/azure/` Helm/Terraform stays out of scope; it will become `ai-deploy-azure` later.)

---

## Phase 1 — SDK Consolidation (in monorepo)

These PRs land in the existing monorepo against `main`. CI must stay green after each.

### Task 1: Promote `tools/shared/mcp_auth.py` into the SDK

**Files:**
- Create: `platform-sdk/platform_sdk/mcp_auth.py`
- Create: `platform-sdk/tests/unit/test_mcp_auth.py`
- Modify: `platform-sdk/platform_sdk/__init__.py` (add export)
- Modify: `tools/shared/mcp_auth.py` (replace body with re-export shim)
- Modify: `tools/data-mcp/src/data_mcp_service.py:21` (import path)
- Modify: `tools/salesforce-mcp/src/*.py` (import path)
- Modify: `tools/payments-mcp/src/*.py` (import path)
- Modify: `tools/news-search-mcp/src/*.py` (import path)

- [ ] **Step 1.1: Write failing test for `platform_sdk.mcp_auth`**

Create `platform-sdk/tests/unit/test_mcp_auth.py`:

```python
"""Unit tests for platform_sdk.mcp_auth."""
import pytest


def test_module_exports_middleware_and_helpers():
    from platform_sdk.mcp_auth import (
        AgentContextMiddleware,
        get_agent_context,
        verify_auth_context,
    )
    assert AgentContextMiddleware is not None
    assert callable(get_agent_context)
    assert callable(verify_auth_context)


def test_get_agent_context_returns_none_outside_request():
    from platform_sdk.mcp_auth import get_agent_context
    assert get_agent_context() is None


def test_verify_auth_context_falls_back_anonymous_on_empty():
    from platform_sdk.mcp_auth import verify_auth_context
    ctx = verify_auth_context("")
    assert ctx is not None
    assert ctx.is_anonymous is True


def test_top_level_sdk_reexports_mcp_auth():
    """The SDK's __init__ should re-export mcp_auth symbols for one-line imports."""
    from platform_sdk import AgentContextMiddleware, get_agent_context, verify_auth_context
    assert AgentContextMiddleware is not None
    assert callable(get_agent_context)
    assert callable(verify_auth_context)
```

- [ ] **Step 1.2: Run the test to confirm it fails**

Run:
```bash
cd /Users/admin-h26/enterprise-ai && pytest platform-sdk/tests/unit/test_mcp_auth.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'platform_sdk.mcp_auth'`.

- [ ] **Step 1.3: Create `platform_sdk/mcp_auth.py` by moving the file body**

Read `/Users/admin-h26/enterprise-ai/tools/shared/mcp_auth.py` and copy lines 35–129 (the actual code, after the docstring) into `platform-sdk/platform_sdk/mcp_auth.py`. Keep imports as `from .auth import AgentContext` instead of `from platform_sdk import AgentContext` since this module is now inside the SDK:

```python
"""MCP server authorization middleware — ASGI middleware + ContextVar binding.

Decodes the X-Agent-Context request header and binds the resulting AgentContext
to a ContextVar so MCP tool handlers can read the per-request caller identity.
"""
from __future__ import annotations

from contextvars import ContextVar
from typing import Any, Optional

from .auth import AgentContext
from .logging import get_logger

log = get_logger(__name__)

_agent_context_var: ContextVar[Optional[AgentContext]] = ContextVar(
    "agent_context", default=None
)


def get_agent_context() -> Optional[AgentContext]:
    """Return the AgentContext for the current request, or None if unauthenticated."""
    return _agent_context_var.get()


class AgentContextMiddleware:
    """Starlette ASGI middleware that decodes X-Agent-Context and binds the
    resulting AgentContext into a ContextVar for the duration of the request."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] in ("http", "websocket"):
            headers = dict(scope.get("headers", []))
            raw = headers.get(b"x-agent-context", b"").decode()
            if raw:
                try:
                    ctx = AgentContext.from_header(raw)
                except Exception as exc:
                    log.warning("invalid_agent_context_header", error=str(exc))
                else:
                    token = _agent_context_var.set(ctx)
                    try:
                        await self.app(scope, receive, send)
                    finally:
                        _agent_context_var.reset(token)
                    return
        if scope["type"] == "http":
            log.warning(
                "auth_context_fallback_anonymous",
                reason="missing_or_invalid_x_agent_context_header",
                path=scope.get("path", "unknown"),
            )
        await self.app(scope, receive, send)


def verify_auth_context(raw_token: str) -> AgentContext:
    """Verify an HMAC-signed `auth_context` token; fall back to anonymous on failure."""
    if not raw_token or not raw_token.strip():
        log.warning("verify_auth_context_empty", fallback="anonymous")
        return AgentContext.anonymous()
    try:
        return AgentContext.from_header(raw_token)
    except Exception as exc:
        log.warning("verify_auth_context_failed", error=str(exc), fallback="anonymous")
        return AgentContext.anonymous()
```

- [ ] **Step 1.4: Add the re-exports to `platform_sdk/__init__.py`**

Edit `platform-sdk/platform_sdk/__init__.py`. After the existing `from .auth import ...` line (line 55), add:

```python
from .mcp_auth import AgentContextMiddleware, get_agent_context, verify_auth_context
```

And in the `__all__` list (after line 132, in the Security section), add:

```python
    "AgentContextMiddleware",
    "get_agent_context",
    "verify_auth_context",
```

- [ ] **Step 1.5: Run the test to confirm it passes**

Run:
```bash
cd /Users/admin-h26/enterprise-ai && pytest platform-sdk/tests/unit/test_mcp_auth.py -v
```

Expected: 4 passed.

- [ ] **Step 1.6: Replace `tools/shared/mcp_auth.py` with a re-export shim (deprecation bridge)**

Overwrite `/Users/admin-h26/enterprise-ai/tools/shared/mcp_auth.py` with:

```python
"""DEPRECATED — use `platform_sdk.mcp_auth` instead.

This module re-exports the SDK symbols so existing imports keep working
during the migration. It will be deleted when all repos are split.
"""
import warnings

warnings.warn(
    "tools_shared.mcp_auth is deprecated; import from platform_sdk.mcp_auth instead.",
    DeprecationWarning,
    stacklevel=2,
)

from platform_sdk.mcp_auth import (  # noqa: F401, E402
    AgentContextMiddleware,
    get_agent_context,
    verify_auth_context,
)
```

- [ ] **Step 1.7: Update each MCP service to import from `platform_sdk`**

For each MCP service file, change `from tools_shared.mcp_auth import ...` to `from platform_sdk.mcp_auth import ...`:

```bash
cd /Users/admin-h26/enterprise-ai
grep -rl "from tools_shared.mcp_auth" tools/
# Expected output (4 files): tools/data-mcp/src/data_mcp_service.py and the equivalents
# in tools/salesforce-mcp/src/, tools/payments-mcp/src/, tools/news-search-mcp/src/
```

For each file in the list, replace the import line. For example in `tools/data-mcp/src/data_mcp_service.py:21`, change:

```python
from tools_shared.mcp_auth import verify_auth_context
```

to:

```python
from platform_sdk.mcp_auth import verify_auth_context
```

- [ ] **Step 1.8: Run the full unit test suite to confirm nothing regressed**

Run:
```bash
cd /Users/admin-h26/enterprise-ai && pytest tests/unit platform-sdk/tests/unit -v -m unit
```

Expected: all green. The deprecation warning shim is fine — pytest will not fail on `DeprecationWarning` unless `-W error` is set.

- [ ] **Step 1.9: Run integration smoke (Docker-based) — confirm MCPs still boot**

Run:
```bash
cd /Users/admin-h26/enterprise-ai && make stop && make start
docker compose ps | grep -E "data-mcp|salesforce-mcp|payments-mcp|news-search-mcp"
```

Expected: all 4 MCP containers `Up (healthy)`.

- [ ] **Step 1.10: Commit**

```bash
cd /Users/admin-h26/enterprise-ai
git add platform-sdk/platform_sdk/mcp_auth.py \
        platform-sdk/platform_sdk/__init__.py \
        platform-sdk/tests/unit/test_mcp_auth.py \
        tools/shared/mcp_auth.py \
        tools/data-mcp/src/data_mcp_service.py \
        tools/salesforce-mcp/src/ \
        tools/payments-mcp/src/ \
        tools/news-search-mcp/src/
git commit -m "feat(platform-sdk): promote mcp_auth into SDK; deprecate tools/shared shim

MCPs now import AgentContextMiddleware/verify_auth_context from
platform_sdk.mcp_auth. The tools/shared/mcp_auth.py file is kept as a
deprecation re-export so the monorepo CI stays green during the
multi-repo carve-out. The shim will be deleted alongside the carve-out.

Refs: docs/superpowers/plans/2026-04-30-multi-repo-restructure.md (Task 1)"
```

---

### Task 2: Add `BaseAgentApp` (FastAPI lifespan symmetric to `McpService.lifespan`)

**Files:**
- Create: `platform-sdk/platform_sdk/fastapi_app/__init__.py`
- Create: `platform-sdk/platform_sdk/fastapi_app/base.py`
- Create: `platform-sdk/tests/unit/test_fastapi_app_base.py`
- Modify: `platform-sdk/platform_sdk/__init__.py` (add export)
- Modify: `platform-sdk/pyproject.toml` (no change to deps — `fastapi` already an optional extra)

- [ ] **Step 2.1: Write failing tests for `BaseAgentApp`**

Create `platform-sdk/tests/unit/test_fastapi_app_base.py`:

```python
"""Unit tests for platform_sdk.fastapi_app.BaseAgentApp."""
from __future__ import annotations

import pytest


def test_subclass_must_implement_build_dependencies():
    from platform_sdk.fastapi_app import BaseAgentApp

    class Incomplete(BaseAgentApp):
        service_name = "incomplete"

    app = Incomplete()
    with pytest.raises(NotImplementedError):
        app.build_dependencies(bridges={}, checkpointer=None, store=None)


def test_create_app_returns_fastapi_instance_without_lifespan_io():
    """create_app() must be pure — no env reads, no I/O."""
    from fastapi import FastAPI
    from platform_sdk.fastapi_app import BaseAgentApp

    class Minimal(BaseAgentApp):
        service_name = "minimal"
        # No MCP, no checkpointer, no store — minimal config
        mcp_servers: dict[str, str] = {}
        requires_checkpointer = False
        requires_conversation_store = False

        def build_dependencies(self, *, bridges, checkpointer, store):
            return {"sentinel": "ok"}

        def routes(self):
            return []  # No routers

    app_obj = Minimal()
    fastapi_app = app_obj.create_app()
    assert isinstance(fastapi_app, FastAPI)
    assert fastapi_app.title == "minimal"


@pytest.mark.asyncio
async def test_lifespan_calls_build_dependencies_and_attaches_to_state():
    from platform_sdk.fastapi_app import BaseAgentApp

    class Probe(BaseAgentApp):
        service_name = "probe"
        mcp_servers: dict[str, str] = {}
        enable_telemetry = False
        requires_checkpointer = False
        requires_conversation_store = False

        def build_dependencies(self, *, bridges, checkpointer, store):
            return {"probe_deps": True}

        def routes(self):
            return []

    app_obj = Probe()
    fastapi_app = app_obj.create_app()
    async with fastapi_app.router.lifespan_context(fastapi_app):
        assert fastapi_app.state.deps == {"probe_deps": True}


@pytest.mark.asyncio
async def test_lifespan_skips_telemetry_when_disabled(monkeypatch):
    """enable_telemetry=False must not call setup_telemetry()."""
    from platform_sdk.fastapi_app import BaseAgentApp

    calls: list[str] = []
    monkeypatch.setattr(
        "platform_sdk.telemetry.setup_telemetry",
        lambda name: calls.append(name),
    )

    class NoTelemetry(BaseAgentApp):
        service_name = "no-telemetry"
        mcp_servers: dict[str, str] = {}
        enable_telemetry = False
        requires_checkpointer = False
        requires_conversation_store = False

        def build_dependencies(self, *, bridges, checkpointer, store):
            return {}

        def routes(self):
            return []

    fastapi_app = NoTelemetry().create_app()
    async with fastapi_app.router.lifespan_context(fastapi_app):
        pass
    assert calls == []
```

- [ ] **Step 2.2: Run the test to confirm it fails**

Run:
```bash
cd /Users/admin-h26/enterprise-ai && pytest platform-sdk/tests/unit/test_fastapi_app_base.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'platform_sdk.fastapi_app'`.

- [ ] **Step 2.3: Create the package skeleton**

Create `platform-sdk/platform_sdk/fastapi_app/__init__.py`:

```python
"""FastAPI app factory base — symmetric to platform_sdk.base.McpService.lifespan().

Provides BaseAgentApp: subclasses declare service_name, mcp_servers, and
implement build_dependencies() + routes(). The base class handles telemetry,
MCP bridge connection, checkpointer construction, and conversation-store
wiring during a FastAPI lifespan.
"""
from .base import BaseAgentApp

__all__ = ["BaseAgentApp"]
```

- [ ] **Step 2.4: Implement `BaseAgentApp`**

Create `platform-sdk/platform_sdk/fastapi_app/base.py`:

```python
"""Base FastAPI application class for Enterprise AI agents."""
from __future__ import annotations

import asyncio
import os
import uuid
from contextlib import asynccontextmanager
from typing import Any, Iterable, Mapping, Optional

try:
    from fastapi import FastAPI, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse
except ImportError as exc:
    raise ImportError(
        "platform_sdk.fastapi_app requires the 'fastapi' optional extra. "
        "Install with: pip install enterprise-ai-platform-sdk[fastapi]"
    ) from exc

from ..auth import AgentContext
from ..logging import configure_logging, get_logger
from ..telemetry import flush_langfuse, setup_telemetry


class BaseAgentApp:
    """Base class for Enterprise AI FastAPI agents.

    Subclasses declare class-level configuration:
        service_name: str                             — required
        mcp_servers: Mapping[str, str]                — name -> default SSE URL (env override applied)
        enable_telemetry: bool = True
        requires_checkpointer: bool = False
        requires_conversation_store: bool = False
        mcp_startup_timeout_attr: str = "mcp_startup_timeout"

    And override:
        build_dependencies(*, bridges, checkpointer, store) -> Any
            Return your AppDependencies. Always called inside the lifespan.
        routes() -> Iterable[APIRouter]
            Routers to mount. Called inside create_app().

    Optional overrides:
        on_shutdown(deps) -> None        — extra teardown
        service_agent_context() -> AgentContext  — for outbound MCP SSE
    """

    # ---- Subclass-configurable class attributes ----
    service_name: str = ""
    mcp_servers: Mapping[str, str] = {}  # logical name -> default SSE URL
    enable_telemetry: bool = True
    requires_checkpointer: bool = False
    requires_conversation_store: bool = False

    # ---- Hooks subclasses must implement ----
    def build_dependencies(self, *, bridges: Mapping[str, Any], checkpointer: Any, store: Any) -> Any:
        raise NotImplementedError(
            f"{type(self).__name__} must implement build_dependencies()"
        )

    def routes(self) -> Iterable[Any]:
        return []

    # ---- Hooks subclasses MAY implement ----
    async def on_shutdown(self, deps: Any) -> None:
        return None

    def service_agent_context(self) -> AgentContext:
        """Default service identity for outbound MCP calls.

        Override to customize role / clearance / team_id.
        """
        return AgentContext(
            rm_id=self.service_name,
            rm_name=self.service_name,
            role="manager",
            team_id="platform",
            assigned_account_ids=(),
            compliance_clearance=("standard",),
        )

    # ---- Internals ----
    def _resolve_mcp_url(self, name: str, default: str) -> str:
        env_var = name.upper().replace("-", "_") + "_URL"
        return os.getenv(env_var, default)

    async def _connect_bridges(self, agent_ctx: AgentContext, timeout: float) -> dict[str, Any]:
        if not self.mcp_servers:
            return {}
        # Local import — keeps fastapi_app importable even when MCP extras aren't present.
        from ..mcp_bridge import MCPToolBridge

        log = get_logger(self.service_name)
        bridges = {
            name: MCPToolBridge(self._resolve_mcp_url(name, default), agent_context=agent_ctx)
            for name, default in self.mcp_servers.items()
        }
        log.info("mcp_connecting_all", servers=list(bridges.keys()), timeout=timeout)
        await asyncio.gather(
            *[b.connect(startup_timeout=timeout) for b in bridges.values()],
            return_exceptions=True,
        )
        for name, bridge in bridges.items():
            log.info("mcp_startup_status", server=name, connected=bridge.is_connected)
        return bridges

    async def _make_checkpointer(self, config: Any) -> Any:
        if not self.requires_checkpointer:
            return None
        from ..agent import setup_checkpointer
        return await setup_checkpointer(config)

    async def _make_store(self) -> Any:
        if not self.requires_conversation_store:
            return None
        # Subclass may override — default returns None.
        return self.build_conversation_store()

    def build_conversation_store(self) -> Any:
        """Override when requires_conversation_store=True."""
        return None

    def load_config(self) -> Any:
        from ..config import AgentConfig
        return AgentConfig.from_env()

    @asynccontextmanager
    async def lifespan(self, app: "FastAPI"):
        log = get_logger(self.service_name)
        if self.enable_telemetry:
            setup_telemetry(self.service_name)

        config = self.load_config()
        agent_ctx = self.service_agent_context()
        timeout = getattr(config, "mcp_startup_timeout", 30.0)

        bridges = await self._connect_bridges(agent_ctx, timeout)
        checkpointer = await self._make_checkpointer(config)
        store = await self._make_store()
        if store is not None and hasattr(store, "connect"):
            await store.connect()

        deps = self.build_dependencies(bridges=bridges, checkpointer=checkpointer, store=store)
        app.state.deps = deps
        app.state.bridges = bridges  # legacy /stream readiness probe reads this
        app.state.config = config
        log.info(f"{self.service_name}_ready")

        try:
            yield
        finally:
            await self.on_shutdown(deps)
            flush_langfuse()
            if store is not None and hasattr(store, "disconnect"):
                await store.disconnect()
            for name, bridge in bridges.items():
                await bridge.disconnect()
                log.info("mcp_disconnected", server=name)

    def add_cors(self, app: "FastAPI") -> None:
        log = get_logger(self.service_name)
        raw_origins = os.getenv("ALLOWED_ORIGINS")
        if raw_origins and raw_origins != "*":
            origins = [o.strip() for o in raw_origins.split(",") if o.strip()]
            allow_credentials = True
        else:
            origins = ["*"]
            allow_credentials = False
            log.warning(
                "cors_wildcard_no_credentials",
                hint="set ALLOWED_ORIGINS=https://your.dashboard.example to enable credentials",
            )
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=allow_credentials,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    def add_default_error_handlers(self, app: "FastAPI") -> None:
        """No-op default; subclasses can override to register domain error handlers."""
        return None

    def create_app(self, deps: Optional[Any] = None) -> "FastAPI":
        """Create a FastAPI app. Pure: no env reads, no I/O.

        deps: when None, the app is wired only with placeholder state and the real
              deps are constructed by lifespan(). Tests pass a fake deps object.
        """
        configure_logging()
        app = FastAPI(
            title=self.service_name,
            version="1.0.0",
            lifespan=self.lifespan,
        )
        app.state.deps = deps  # may be None until lifespan runs
        self.add_cors(app)
        self.add_default_error_handlers(app)
        for router in self.routes():
            app.include_router(router)
        return app
```

- [ ] **Step 2.5: Add export to `platform_sdk/__init__.py`**

Edit `platform-sdk/platform_sdk/__init__.py`:

After the existing `from .base import Application, Agent, McpService` line (line 99), add:

```python
# FastAPI agent base — optional; requires fastapi extra at install time.
try:
    from .fastapi_app import BaseAgentApp
except ImportError:
    BaseAgentApp = None  # type: ignore[assignment,misc]
```

In `__all__` after `"McpService",` add:

```python
    "BaseAgentApp",
```

- [ ] **Step 2.6: Run the tests to confirm they pass**

Run:
```bash
cd /Users/admin-h26/enterprise-ai && pytest platform-sdk/tests/unit/test_fastapi_app_base.py -v
```

Expected: 4 passed.

- [ ] **Step 2.7: Run full SDK unit suite to confirm no regressions**

Run:
```bash
cd /Users/admin-h26/enterprise-ai && pytest platform-sdk/tests/unit -v
```

Expected: all green.

- [ ] **Step 2.8: Commit**

```bash
cd /Users/admin-h26/enterprise-ai
git add platform-sdk/platform_sdk/fastapi_app/ \
        platform-sdk/platform_sdk/__init__.py \
        platform-sdk/tests/unit/test_fastapi_app_base.py
git commit -m "feat(platform-sdk): add BaseAgentApp lifespan factory

Symmetric to McpService.lifespan: subclasses declare service_name,
mcp_servers, and implement build_dependencies()/routes(). The base wires
telemetry, MCP bridge connection, checkpointer, and conversation-store
during a FastAPI lifespan, collapsing ~150 lines of per-agent boilerplate.

Refs: docs/superpowers/plans/2026-04-30-multi-repo-restructure.md (Task 2)"
```

---

### Task 3: Migrate `analytics-agent` to `BaseAgentApp`

**Files:**
- Modify: `agents/analytics-agent/src/app.py` (collapse lifespan via subclass)
- Modify: `agents/analytics-agent/tests/application/test_app_factory.py` (if it asserts internal lifespan shape)

This task is the proof-out for `BaseAgentApp`. After this, `app.py` should drop ~100 lines.

- [ ] **Step 3.1: Run the analytics-agent test suite to capture baseline**

Run:
```bash
cd /Users/admin-h26/enterprise-ai && pytest agents/analytics-agent/tests -v -m "not integration"
```

Expected: all green. Record the count to compare after the refactor.

- [ ] **Step 3.2: Rewrite `app.py` to use `BaseAgentApp`**

Replace `/Users/admin-h26/enterprise-ai/agents/analytics-agent/src/app.py` with:

```python
"""Analytics Agent — FastAPI app, built on platform_sdk.BaseAgentApp.

Subclassing BaseAgentApp gives us telemetry, MCP bridge connection,
checkpointer, and conversation-store wiring for free. This file is
analytics-specific glue only.
"""
from __future__ import annotations

import os
import uuid
from contextlib import contextmanager
from typing import Any, Callable, Iterable, Mapping

from fastapi import Request
from fastapi.responses import JSONResponse

from platform_sdk import BaseAgentApp, get_logger
from platform_sdk.mcp_bridge import MCPToolBridge

from .app_dependencies import AppDependencies
from .domain.errors import AnalyticsError, AuthError, ConversationNotFound
from .domain.types import UserContext
from .graph import build_analytics_graph
from .persistence import MemoryConversationStore, PostgresConversationStore
from .routes.chat import chat_router
from .routes.conversations import conversations_router
from .routes.health import health_router
from .routes.stream import stream_router
from .services.chat_service import ChatService
from .streaming.data_stream_encoder import DataStreamEncoder

log = get_logger(__name__)


async def _fetch_schema_context(data_bridge: MCPToolBridge | None) -> str:
    """Call data-mcp's get_schema_context tool once at startup."""
    if data_bridge is None or not getattr(data_bridge, "is_connected", False):
        log.warning("schema_context_skipped", reason="data-mcp bridge not connected")
        return ""
    try:
        tools = await data_bridge.get_langchain_tools()
    except Exception as exc:
        log.warning("schema_context_tools_failed", error=str(exc))
        return ""
    schema_tool = next((t for t in tools if t.name == "get_schema_context"), None)
    if schema_tool is None:
        log.warning("schema_context_tool_missing")
        return ""
    try:
        result = await schema_tool.ainvoke({})
    except Exception as exc:
        log.warning("schema_context_call_failed", error=str(exc))
        return ""
    if not isinstance(result, str) or not result.strip():
        log.warning("schema_context_empty_result")
        return ""
    log.info("schema_context_loaded", chars=len(result))
    return result


class AnalyticsAgentApp(BaseAgentApp):
    service_name = "analytics-agent"
    mcp_servers = {
        "data-mcp": "http://data-mcp:8000/sse",
        "salesforce-mcp": "http://salesforce-mcp:8000/sse",
        "payments-mcp": "http://payments-mcp:8000/sse",
        "news-search-mcp": "http://news-search-mcp:8000/sse",
    }
    enable_telemetry = True
    requires_checkpointer = True
    requires_conversation_store = True

    def build_conversation_store(self):
        db_url = os.getenv("DATABASE_URL")
        if (
            db_url
            and os.getenv("ENVIRONMENT") not in ("local",)
            and PostgresConversationStore is not None
        ):
            return PostgresConversationStore(db_url)
        if db_url and PostgresConversationStore is None:
            log.warning("asyncpg_not_available", fallback="MemoryConversationStore")
        return MemoryConversationStore()

    def routes(self) -> Iterable[Any]:
        return [health_router, chat_router, conversations_router, stream_router]

    def add_default_error_handlers(self, app) -> None:
        @app.exception_handler(AuthError)
        async def _on_auth_error(request: Request, exc: AuthError):
            return JSONResponse(
                {"error_id": uuid.uuid4().hex, "type": "auth", "message": str(exc)},
                status_code=401,
            )

        @app.exception_handler(ConversationNotFound)
        async def _on_not_found(request: Request, exc: ConversationNotFound):
            return JSONResponse(
                {"error_id": uuid.uuid4().hex, "type": "not_found", "message": str(exc)},
                status_code=404,
            )

        @app.exception_handler(AnalyticsError)
        async def _on_analytics_error(request: Request, exc: AnalyticsError):
            return JSONResponse(
                {"error_id": uuid.uuid4().hex, "type": "internal"},
                status_code=500,
            )

    def build_dependencies(
        self, *, bridges: Mapping[str, Any], checkpointer: Any, store: Any
    ) -> AppDependencies:
        # _fetch_schema_context is async; resolve it here via a sync->async hop using
        # asyncio.run is wrong because we're already inside the running loop.
        # Instead the base lifespan calls this synchronously after bridges are connected,
        # so we kick off schema fetch via a task and block via the event loop.
        import asyncio
        loop = asyncio.get_event_loop()
        schema_context = loop.run_until_complete(
            _fetch_schema_context(bridges.get("data-mcp"))
        ) if not loop.is_running() else ""
        # NOTE: when called from inside lifespan(), loop.is_running() is True;
        # we read schema context separately in on_startup_async (see below).

        graph = build_analytics_graph(
            bridges=bridges,
            config=self._latest_config,  # set by load_config() override below
            checkpointer=checkpointer,
            schema_context=schema_context,
        )

        encoder_factory: Callable[[], DataStreamEncoder] = lambda: DataStreamEncoder()

        def chat_service_factory(user_ctx: UserContext) -> ChatService:
            class _NoopTelemetry:
                @contextmanager
                def start_span(self, name):
                    yield None

                def record_event(self, name, **attrs):
                    pass

            return ChatService(
                graph=graph,
                conversation_store=store,
                config=self._latest_config,
                user_ctx=user_ctx,
                encoder_factory=encoder_factory,
                telemetry=_NoopTelemetry(),
            )

        return AppDependencies(
            config=self._latest_config,
            graph=graph,
            conversation_store=store,
            mcp_tools_provider=None,
            llm_factory=None,
            telemetry=None,
            compaction=None,
            encoder_factory=encoder_factory,
            chat_service_factory=chat_service_factory,
        )

    def load_config(self):
        from platform_sdk import AgentConfig
        cfg = AgentConfig.from_env()
        self._latest_config = cfg
        return cfg


# --------------------------------------------------------------------
# Module-level entry point — uvicorn loads this `app` symbol
# --------------------------------------------------------------------

_agent = AnalyticsAgentApp()


def create_app(deps: AppDependencies | None = None):
    """Public test entry — `tests/application/test_app_factory.py` uses this."""
    return _agent.create_app(deps=deps)


_empty_deps = AppDependencies(
    config=None,
    graph=None,
    conversation_store=None,
    mcp_tools_provider=None,
    llm_factory=None,
    telemetry=None,
    compaction=None,
    encoder_factory=None,
    chat_service_factory=None,
)
app = _agent.create_app(deps=_empty_deps)
```

⚠ **Important — the schema-context async hop:** The original lifespan awaits `_fetch_schema_context(...)` directly inside lifespan. The new `build_dependencies()` is synchronous (`McpService.lifespan` is the model — sync hook). Move the schema fetch into a new async hook on `BaseAgentApp` named `on_started(deps)` that runs after `build_dependencies()` returns. Update `BaseAgentApp.lifespan` to call `await self.on_started(deps)` after `app.state.deps = deps`. Then implement `async def on_started(self, deps)` here that calls `_fetch_schema_context` and re-binds `deps.graph`'s schema. **Add this to Task 2** as a 2.4.5 step (insert into the lifespan after `app.state.deps = deps`):

```python
# In BaseAgentApp.lifespan, after the existing `app.state.deps = deps` line:
await self.on_started(deps)
```

And add the hook:

```python
async def on_started(self, deps: Any) -> None:
    """Async hook that runs after build_dependencies(). Override for async post-init."""
    return None
```

Re-run Task 2 tests; they should still pass since `on_started` defaults to a no-op.

For `analytics-agent` then, replace the `loop.run_until_complete` hack in `build_dependencies` with proper logic in `on_started`:

```python
async def on_started(self, deps: AppDependencies) -> None:
    bridges = self._latest_bridges  # see below
    schema_context = await _fetch_schema_context(bridges.get("data-mcp"))
    # Rebuild graph with the schema context.
    deps.graph = build_analytics_graph(
        bridges=bridges,
        config=deps.config,
        checkpointer=deps.graph.checkpointer if hasattr(deps.graph, "checkpointer") else None,
        schema_context=schema_context,
    )
```

For this to work, also update `BaseAgentApp.lifespan` to set `self._latest_bridges = bridges` after connecting bridges.

- [ ] **Step 3.3: Run analytics-agent unit + component + application tests**

Run:
```bash
cd /Users/admin-h26/enterprise-ai && pytest agents/analytics-agent/tests -v -m "not integration"
```

Expected: same passing count as Step 3.1.

- [ ] **Step 3.4: Run integration tests against the live stack**

Run:
```bash
cd /Users/admin-h26/enterprise-ai && make restart
sleep 15
pytest agents/analytics-agent/tests/integration -v
```

Expected: all green. The agent's `/health/ready` endpoint should report all 4 MCP bridges connected.

- [ ] **Step 3.5: Verify via the UI / curl that the chat path works**

Run:
```bash
curl -s http://localhost:8086/health/ready | jq
```

Expected: `{"ready": true, "bridges": {"data-mcp": true, ...}}`. Then exercise a chat turn through the dashboard at http://localhost:3003 to confirm streaming and SQL reveal still work end-to-end.

- [ ] **Step 3.6: Commit**

```bash
cd /Users/admin-h26/enterprise-ai
git add platform-sdk/platform_sdk/fastapi_app/base.py \
        agents/analytics-agent/src/app.py
git commit -m "refactor(analytics-agent): adopt platform_sdk.BaseAgentApp

Collapses ~120 lines of lifespan boilerplate into a subclass of
BaseAgentApp. Behavior is unchanged: telemetry, MCP bridge connection,
schema-context warmup, checkpointer, and conversation-store init all
happen in the same order. Adds on_started() async hook to BaseAgentApp
to support post-build async initialization (used here for schema fetch).

Refs: docs/superpowers/plans/2026-04-30-multi-repo-restructure.md (Task 3)"
```

---

### Task 4: Package shared test fixtures as a pytest plugin

**Files:**
- Create: `platform-sdk/platform_sdk/testing/__init__.py` (move existing testing.py contents here)
- Create: `platform-sdk/platform_sdk/testing/plugin.py` (new — pytest fixtures)
- Modify: `platform-sdk/platform_sdk/testing.py` → delete after moving (replace with package)
- Modify: `platform-sdk/pyproject.toml` (add `[project.entry-points.pytest11]`)
- Modify: `tests/conftest.py` (delegate to plugin)
- Modify: `tests/integration/conftest.py` (move db_pool/opa_client/make_jwt to plugin where reusable)

- [ ] **Step 4.1: Capture current `platform_sdk.testing` content**

Run:
```bash
cat /Users/admin-h26/enterprise-ai/platform-sdk/platform_sdk/testing.py | head -100
```

Confirm the file currently exposes `TEST_PERSONAS`. Note its size and exports.

- [ ] **Step 4.2: Convert `testing.py` to a package**

Move the file:
```bash
cd /Users/admin-h26/enterprise-ai/platform-sdk/platform_sdk
mkdir testing_pkg
git mv testing.py testing_pkg/__init__.py
mv testing_pkg testing
```

Result: `platform-sdk/platform_sdk/testing/__init__.py` contains the original `TEST_PERSONAS`.

- [ ] **Step 4.3: Add `plugin.py` with the JWT/persona fixtures**

Create `platform-sdk/platform_sdk/testing/plugin.py`:

```python
"""Pytest plugin — shared fixtures for SDK consumers.

Activated automatically via the [project.entry-points.pytest11] hook
declared in pyproject.toml: any pytest run in a process where
enterprise-ai-platform-sdk is installed gets these fixtures for free.
"""
from __future__ import annotations

import os
import time
from typing import Callable

import pytest

from . import TEST_PERSONAS


@pytest.fixture(scope="session")
def jwt_secret() -> str:
    return os.environ.get("JWT_SECRET", "test-secret-change-in-prod")


@pytest.fixture(scope="session")
def hmac_secret() -> str:
    return os.environ.get("CONTEXT_HMAC_SECRET", "test-context-secret-change-in-prod")


@pytest.fixture(scope="session")
def internal_api_key() -> str:
    return os.environ.get("INTERNAL_API_KEY", "test-key")


def _make_jwt(payload: dict, secret: str) -> str:
    import jwt as pyjwt
    now = int(time.time())
    return pyjwt.encode(
        {"iat": now, "exp": now + 3600, **payload},
        secret,
        algorithm="HS256",
    )


def _persona_to_jwt_payload(persona: dict) -> dict:
    return {
        "sub": persona["rm_id"],
        "name": persona["rm_name"],
        "role": persona["role"],
        "team_id": persona["team_id"],
        "assigned_account_ids": persona["assigned_account_ids"],
        "compliance_clearance": persona["compliance_clearance"],
    }


@pytest.fixture(scope="session")
def make_persona_jwt(jwt_secret: str) -> Callable[[dict], str]:
    def _make(persona: dict) -> str:
        return _make_jwt(persona, jwt_secret)
    return _make


@pytest.fixture(scope="session")
def persona_manager() -> dict:
    return _persona_to_jwt_payload(TEST_PERSONAS["manager"])


@pytest.fixture(scope="session")
def persona_senior_rm() -> dict:
    return _persona_to_jwt_payload(TEST_PERSONAS["senior_rm"])


@pytest.fixture(scope="session")
def persona_rm() -> dict:
    return _persona_to_jwt_payload(TEST_PERSONAS["rm"])


@pytest.fixture(scope="session")
def persona_readonly() -> dict:
    return _persona_to_jwt_payload(TEST_PERSONAS["readonly"])
```

- [ ] **Step 4.4: Register the pytest entry-point**

Edit `platform-sdk/pyproject.toml`. After the `[project.optional-dependencies]` block, add:

```toml
[project.entry-points.pytest11]
platform_sdk_fixtures = "platform_sdk.testing.plugin"
```

- [ ] **Step 4.5: Reinstall SDK so the entry-point is registered**

Run:
```bash
cd /Users/admin-h26/enterprise-ai && pip install -e platform-sdk/ --quiet
```

Verify the plugin is detected:
```bash
pytest --trace-config 2>&1 | grep platform_sdk_fixtures
```

Expected: a line referencing `platform_sdk.testing.plugin`.

- [ ] **Step 4.6: Slim `tests/conftest.py` to delegate to the plugin**

Overwrite `/Users/admin-h26/enterprise-ai/tests/conftest.py` with:

```python
"""Root conftest — most fixtures now ship in platform_sdk.testing.plugin.

The plugin is auto-registered via the [project.entry-points.pytest11] hook
in platform-sdk/pyproject.toml. This file keeps only the legacy
PERSONA_* module-level constants that some tests still import directly.
"""
from platform_sdk.testing import TEST_PERSONAS


def _persona_to_jwt_payload(persona: dict) -> dict:
    return {
        "sub": persona["rm_id"],
        "name": persona["rm_name"],
        "role": persona["role"],
        "team_id": persona["team_id"],
        "assigned_account_ids": persona["assigned_account_ids"],
        "compliance_clearance": persona["compliance_clearance"],
    }


PERSONA_MANAGER = _persona_to_jwt_payload(TEST_PERSONAS["manager"])
PERSONA_SENIOR_RM = _persona_to_jwt_payload(TEST_PERSONAS["senior_rm"])
PERSONA_RM = _persona_to_jwt_payload(TEST_PERSONAS["rm"])
PERSONA_READONLY = _persona_to_jwt_payload(TEST_PERSONAS["readonly"])
```

- [ ] **Step 4.7: Run unit tests to confirm fixtures still resolve**

Run:
```bash
cd /Users/admin-h26/enterprise-ai && pytest tests/unit -v -m unit
```

Expected: all green. Any test using `make_persona_jwt`, `jwt_secret`, etc. now resolves them via the plugin.

- [ ] **Step 4.8: Commit**

```bash
cd /Users/admin-h26/enterprise-ai
git add platform-sdk/platform_sdk/testing/ \
        platform-sdk/pyproject.toml \
        tests/conftest.py
git commit -m "feat(platform-sdk): ship shared pytest fixtures as a plugin

Moves jwt_secret, hmac_secret, make_persona_jwt, persona_* fixtures
into platform_sdk.testing.plugin and registers it via pytest11 entry
point. Per-repo conftests in the future (post-split) will inherit
these without copying code.

Refs: docs/superpowers/plans/2026-04-30-multi-repo-restructure.md (Task 4)"
```

---

### Task 5: Delete legacy `agents/src/` (generic ReAct agent)

**Files:**
- Delete: `agents/src/`
- Delete: `agents/Dockerfile`
- Delete: `agents/conftest.py`
- Delete: `agents/tests/`
- Delete: `agents/requirements.txt` (after inlining its deps)
- Delete: `agents/requirements-test.txt`
- Modify: `agents/analytics-agent/requirements.txt` (inline what was previously inherited)
- Modify: `docker-compose.yml` (remove `generic-agent` service)
- Modify: `.github/workflows/ci-unit.yml` (drop any `agents/tests` references)
- Modify: `.github/workflows/ci-integration.yml` (same)

- [ ] **Step 5.1: Inspect what `agents/requirements.txt` contains**

Run:
```bash
cat /Users/admin-h26/enterprise-ai/agents/requirements.txt
diff /Users/admin-h26/enterprise-ai/agents/requirements.txt \
     /Users/admin-h26/enterprise-ai/agents/analytics-agent/requirements.txt 2>&1 || true
```

Note any pins that are in `agents/requirements.txt` but missing from `analytics-agent/requirements.txt`.

- [ ] **Step 5.2: Inline the missing deps into `analytics-agent/requirements.txt`**

Edit `/Users/admin-h26/enterprise-ai/agents/analytics-agent/requirements.txt`. Add any pins from Step 5.1's diff that are not already present. Result should be a self-contained requirements file (no `-r ../requirements.txt` reference).

- [ ] **Step 5.3: Confirm no other code imports from `agents.src`**

Run:
```bash
cd /Users/admin-h26/enterprise-ai
grep -rn "from src\.graph\|from src\.enterprise_agent_service\|from agents\.src" \
    --include='*.py' --exclude-dir=.venv
```

Expected: zero hits outside `agents/src/` itself and `agents/conftest.py`. If hits exist, they belong to dead code — flag and resolve before proceeding.

- [ ] **Step 5.4: Delete the legacy tree**

Run:
```bash
cd /Users/admin-h26/enterprise-ai
git rm -r agents/src agents/tests agents/conftest.py \
         agents/requirements.txt agents/requirements-test.txt \
         agents/Dockerfile
```

- [ ] **Step 5.5: Remove `generic-agent` service from `docker-compose.yml`**

Edit `/Users/admin-h26/enterprise-ai/docker-compose.yml`. Find the `generic-agent:` service block (the one with `container_name: ai-generic-agent`, port `8000`) and delete the entire service entry, including its `depends_on` references in OTHER services (search for `generic-agent` anywhere in the YAML).

- [ ] **Step 5.6: Remove `agents/tests` references from CI workflows**

Run:
```bash
cd /Users/admin-h26/enterprise-ai
grep -n "agents/tests\|agents/src" .github/workflows/*.yml
```

For each hit, edit the file to drop the path.

- [ ] **Step 5.7: Run unit + integration tests**

Run:
```bash
cd /Users/admin-h26/enterprise-ai && make restart && sleep 15
pytest tests/unit -v -m unit
pytest tests/integration -v
```

Expected: all green.

- [ ] **Step 5.8: Commit**

```bash
cd /Users/admin-h26/enterprise-ai
git add -A
git commit -m "chore: remove legacy generic-agent (agents/src/)

The generic ReAct agent has been superseded by analytics-agent. Its
shared agents/requirements.txt was the last coupling between the two
services and has been inlined into analytics-agent. Removed:

  - agents/src/ (source)
  - agents/tests/ (tests)
  - agents/conftest.py (sys.path bootstrap)
  - agents/Dockerfile, agents/requirements*.txt
  - generic-agent service in docker-compose.yml

Refs: docs/superpowers/plans/2026-04-30-multi-repo-restructure.md (Task 5)"
```

---

## Phase 2 — SDK Release Infrastructure

### Task 6: Bump SDK to v0.4.0; cut release branch; build base image; release workflow

This task happens against the still-monorepo `ai-platform-sdk` *subdirectory* (`platform-sdk/`). The release-branch + tag + image-build workflow takes effect once the repo is split (Phase 5). For now we (a) bump the version, (b) write the Dockerfile that will become the base image, (c) write the GitHub Actions workflow that will live in `ai-platform-sdk` after the split, and (d) verify the workflow logic in a dry-run.

**Files:**
- Modify: `platform-sdk/pyproject.toml` (bump `version = "0.4.0"`)
- Create: `platform-sdk/CHANGELOG.md`
- Create: `platform-sdk/docker/base/Dockerfile`
- Create: `platform-sdk/.github-pending/workflows/release.yml` (parked here; moved into `.github/` of the new repo at split time)

- [ ] **Step 6.1: Bump SDK version**

Edit `platform-sdk/pyproject.toml`:

```toml
version = "0.4.0"
```

- [ ] **Step 6.2: Create the CHANGELOG**

Create `platform-sdk/CHANGELOG.md`:

```markdown
# Changelog

## 0.4.0 — 2026-04-30

### Added
- `platform_sdk.mcp_auth` (promoted from `tools/shared/mcp_auth.py`):
  `AgentContextMiddleware`, `get_agent_context`, `verify_auth_context`.
- `platform_sdk.fastapi_app.BaseAgentApp` — FastAPI lifespan factory
  symmetric to `McpService.lifespan`. Subclasses declare `service_name`,
  `mcp_servers`, and implement `build_dependencies()` / `routes()`.
- `platform_sdk.testing.plugin` — pytest plugin (auto-registered) shipping
  `jwt_secret`, `make_persona_jwt`, `persona_*` session fixtures.

### Changed
- `tools_shared.mcp_auth` retained as a deprecation re-export (will be
  removed at 0.5.0).

### Migration notes
- Consumers should import middleware/auth helpers from `platform_sdk.mcp_auth`.
- New agents should subclass `BaseAgentApp` rather than hand-writing
  FastAPI lifespan + create_app boilerplate.

## 0.3.0 — earlier
(see git history)
```

- [ ] **Step 6.3: Create the base image Dockerfile**

Create `platform-sdk/docker/base/Dockerfile`:

```dockerfile
# ai-python-base — common base image for all agents and MCP servers.
# Ships Python 3.11-slim + pre-installed enterprise-ai-platform-sdk.
# Tag scheme: ${PYTHON_VERSION}-sdk${SDK_VERSION}, e.g. 3.11-sdk0.4.0.
FROM python:3.11-slim

# Build args for tagging consistency
ARG SDK_VERSION
LABEL org.opencontainers.image.source="https://github.com/narisun/ai-platform-sdk"
LABEL org.opencontainers.image.description="Enterprise AI Platform base image with SDK ${SDK_VERSION}"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy SDK source into the image and install with all extras consumers need.
COPY platform_sdk/ /opt/platform-sdk/platform_sdk/
COPY pyproject.toml README.md /opt/platform-sdk/
RUN pip install --no-cache-dir "/opt/platform-sdk[fastapi,postgres-checkpointer]"

# Pre-create the non-root user every service Dockerfile expects.
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
```

⚠ **Important**: this Dockerfile expects build context to be the `platform-sdk/` directory (so `COPY platform_sdk/` finds `./platform_sdk/`). After the repo split, the build is run from the root of `ai-platform-sdk`.

- [ ] **Step 6.4: Build and verify the base image locally**

Run:
```bash
cd /Users/admin-h26/enterprise-ai/platform-sdk
docker build -f docker/base/Dockerfile \
  --build-arg SDK_VERSION=0.4.0 \
  -t ghcr.io/narisun/ai-python-base:3.11-sdk0.4.0 \
  -t ghcr.io/narisun/ai-python-base:3.11-sdk-latest \
  .
```

Expected: build succeeds. Then:

```bash
docker run --rm ghcr.io/narisun/ai-python-base:3.11-sdk0.4.0 \
  python -c "import platform_sdk; print(platform_sdk.__name__)"
```

Expected: `platform_sdk` printed. Then verify the SDK version:

```bash
docker run --rm ghcr.io/narisun/ai-python-base:3.11-sdk0.4.0 \
  pip show enterprise-ai-platform-sdk | grep Version
```

Expected: `Version: 0.4.0`.

- [ ] **Step 6.5: Write the release GitHub Actions workflow**

Create `platform-sdk/.github-pending/workflows/release.yml` (parked here; moves to `.github/workflows/release.yml` of the new repo during Phase 5):

```yaml
name: Release SDK

on:
  push:
    tags:
      - 'v*.*.*'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install -e .[fastapi,postgres-checkpointer]
      - run: pip install pytest pytest-asyncio pyjwt
      - run: pytest tests/unit -v

  build-base-image:
    runs-on: ubuntu-latest
    needs: validate
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - name: Extract version
        id: ver
        run: echo "v=${GITHUB_REF_NAME#v}" >> "$GITHUB_OUTPUT"
      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Build & push base image
        uses: docker/build-push-action@v5
        with:
          context: .
          file: docker/base/Dockerfile
          build-args: |
            SDK_VERSION=${{ steps.ver.outputs.v }}
          push: true
          tags: |
            ghcr.io/narisun/ai-python-base:3.11-sdk${{ steps.ver.outputs.v }}
            ghcr.io/narisun/ai-python-base:3.11-sdk-latest
```

- [ ] **Step 6.6: Commit the version bump, CHANGELOG, Dockerfile, and parked workflow**

```bash
cd /Users/admin-h26/enterprise-ai
git add platform-sdk/pyproject.toml \
        platform-sdk/CHANGELOG.md \
        platform-sdk/docker/base/Dockerfile \
        platform-sdk/.github-pending/workflows/release.yml
git commit -m "chore(platform-sdk): bump to 0.4.0; add base image Dockerfile + release workflow

The 0.4.0 release ships BaseAgentApp, platform_sdk.mcp_auth, and the
testing pytest plugin. The base image (ghcr.io/narisun/ai-python-base)
will be built and pushed by the release workflow once the SDK lives in
its own repo (Phase 5 of the restructure plan). Workflow is parked in
.github-pending/ until then.

Refs: docs/superpowers/plans/2026-04-30-multi-repo-restructure.md (Task 6)"
```

---

## Phase 3 — Dockerfile Migration (still in monorepo)

### Task 7: Switch every service Dockerfile to the base image

This step is reversible inside the monorepo. We update Dockerfiles to inherit from `ghcr.io/narisun/ai-python-base:3.11-sdk0.4.0` (locally tagged in Task 6) and verify that `make restart` brings up the same stack with smaller, faster service builds.

**Files:**
- Modify: `agents/analytics-agent/Dockerfile`
- Modify: `tools/data-mcp/Dockerfile`
- Modify: `tools/salesforce-mcp/Dockerfile`
- Modify: `tools/payments-mcp/Dockerfile`
- Modify: `tools/news-search-mcp/Dockerfile`
- Modify: `agents/analytics-agent/requirements.txt` (drop SDK-supplied pins)
- Modify: each `tools/*/requirements.txt` (drop SDK-supplied pins)

- [ ] **Step 7.1: Rewrite `agents/analytics-agent/Dockerfile`**

Replace `/Users/admin-h26/enterprise-ai/agents/analytics-agent/Dockerfile` with:

```dockerfile
# Build context: monorepo root (docker build -f agents/analytics-agent/Dockerfile .)
ARG BASE_TAG=3.11-sdk0.4.0
FROM ghcr.io/narisun/ai-python-base:${BASE_TAG}

WORKDIR /app

COPY agents/analytics-agent/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY agents/analytics-agent/src/ /app/src/

USER appuser
EXPOSE 8000
CMD ["uvicorn", "src.app:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 7.2: Slim `agents/analytics-agent/requirements.txt`**

The base image already provides: `langgraph`, `langchain-core`, `langchain-openai`, `pydantic`, `httpx`, `asyncpg`, `opentelemetry-sdk`, `opentelemetry-exporter-otlp`, `langfuse`, `mcp[cli]`, `redis`, `tiktoken`, `structlog`, `fastapi` (via the `[fastapi]` extra), `langgraph-checkpoint-postgres` (via `[postgres-checkpointer]`).

Edit `/Users/admin-h26/enterprise-ai/agents/analytics-agent/requirements.txt`. Drop any of the above. Keep only what's NOT in the SDK or its extras:

```
uvicorn[standard]>=0.30.0,<1.0.0
jinja2>=3.1.0,<4.0.0
sse-starlette>=2.0.0,<3.0.0
opentelemetry-instrumentation-fastapi>=0.45b0,<1.0.0
langchain>=0.2.0,<1.0.0
```

- [ ] **Step 7.3: Rewrite each MCP Dockerfile (data-mcp shown; repeat for the other 3)**

Replace `/Users/admin-h26/enterprise-ai/tools/data-mcp/Dockerfile` with:

```dockerfile
# Build context: monorepo root (docker build -f tools/data-mcp/Dockerfile .)
ARG BASE_TAG=3.11-sdk0.4.0
FROM ghcr.io/narisun/ai-python-base:${BASE_TAG}

WORKDIR /app

COPY tools/data-mcp/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY tools/data-mcp/src/ /app/src/

USER appuser
EXPOSE 8080
CMD ["python", "-m", "src.main"]
```

⚠ Note: the original Dockerfile copied `tools/shared/` into the image. After Task 1, MCPs import from `platform_sdk.mcp_auth`, so the `COPY tools/shared/` line is no longer needed. The deprecation shim in `tools/shared/mcp_auth.py` will be deleted at the repo split (Phase 5).

Repeat the same Dockerfile pattern for `salesforce-mcp` (port 8081), `payments-mcp` (port 8082), and `news-search-mcp` (port 8083) — only the port and the path inside `tools/<name>/` change.

- [ ] **Step 7.4: Slim each `tools/*/requirements.txt`**

For each MCP server, edit the requirements.txt to drop any of: `mcp[cli]`, `asyncpg`, `opentelemetry-sdk`, `opentelemetry-exporter-otlp`, `langfuse`. Keep only service-specific deps. For most MCPs this leaves the file empty or near-empty:

For `tools/data-mcp/requirements.txt`:
```
# All deps already in ai-python-base. Add server-specific extras here as needed.
```

For `tools/news-search-mcp/requirements.txt`:
```
tavily-python>=0.5.0,<1.0.0
```

- [ ] **Step 7.5: Verify the base image is locally tagged**

Run:
```bash
docker images ghcr.io/narisun/ai-python-base
```

Expected: `3.11-sdk0.4.0` and `3.11-sdk-latest` rows. If missing, re-run Step 6.4.

- [ ] **Step 7.6: Rebuild and bring up the stack**

Run:
```bash
cd /Users/admin-h26/enterprise-ai
make stop
docker compose build --no-cache analytics-agent data-mcp salesforce-mcp payments-mcp news-search-mcp
make start
docker compose ps
```

Expected: all 5 services `Up (healthy)`. Build times should be noticeably faster than before because the base image layer is shared.

- [ ] **Step 7.7: Run integration smoke**

Run:
```bash
cd /Users/admin-h26/enterprise-ai && pytest tests/integration -v
```

Expected: all green.

- [ ] **Step 7.8: Compare image sizes**

Run:
```bash
docker images | grep -E "ai-analytics-agent|ai-data-mcp|ai-salesforce-mcp|ai-payments-mcp|ai-news-search-mcp|ai-python-base"
```

Expected: per-service images smaller than before (since SDK no longer duplicated per-image). Record numbers in the commit message.

- [ ] **Step 7.9: Commit**

```bash
cd /Users/admin-h26/enterprise-ai
git add agents/analytics-agent/Dockerfile \
        agents/analytics-agent/requirements.txt \
        tools/data-mcp/Dockerfile tools/data-mcp/requirements.txt \
        tools/salesforce-mcp/Dockerfile tools/salesforce-mcp/requirements.txt \
        tools/payments-mcp/Dockerfile tools/payments-mcp/requirements.txt \
        tools/news-search-mcp/Dockerfile tools/news-search-mcp/requirements.txt
git commit -m "build: switch all services to ghcr.io/narisun/ai-python-base

Each service Dockerfile now FROMs the pre-baked base image with
SDK 0.4.0 preinstalled. requirements.txt files are slimmed to
service-specific extras only. Stops copying tools/shared/ since
mcp_auth lives in platform_sdk.mcp_auth as of Task 1.

Refs: docs/superpowers/plans/2026-04-30-multi-repo-restructure.md (Task 7)"
```

---

## Phase 4 — Scaffolding CLI

### Task 8: Add `platform-sdk new agent` / `new mcp` CLI

A small Click-based CLI that scaffolds a new agent or MCP repo from a template. Saves engineers from copying Dockerfiles by hand and ensures every new service starts with the canonical layout.

**Files:**
- Create: `platform-sdk/platform_sdk/cli/__init__.py`
- Create: `platform-sdk/platform_sdk/cli/main.py`
- Create: `platform-sdk/platform_sdk/cli/templates/agent/` (directory of Jinja-style templates)
- Create: `platform-sdk/platform_sdk/cli/templates/mcp/`
- Create: `platform-sdk/tests/unit/test_cli_scaffold.py`
- Modify: `platform-sdk/pyproject.toml` (add `[project.scripts]` entry, add `click` to deps)

- [ ] **Step 8.1: Add `click` to SDK deps**

Edit `platform-sdk/pyproject.toml`. In the `dependencies = [...]` list, add:

```toml
    "click>=8.1.0,<9.0.0",
```

And below `[project.optional-dependencies]`, add the entry-point:

```toml
[project.scripts]
platform-sdk = "platform_sdk.cli.main:cli"
```

- [ ] **Step 8.2: Write a failing CLI smoke test**

Create `platform-sdk/tests/unit/test_cli_scaffold.py`:

```python
"""Smoke tests for the platform-sdk scaffolding CLI."""
import subprocess
import sys
from pathlib import Path


def test_cli_help_runs():
    res = subprocess.run(
        [sys.executable, "-m", "platform_sdk.cli.main", "--help"],
        capture_output=True, text=True, check=True,
    )
    assert "new agent" in res.stdout or "new" in res.stdout


def test_new_agent_scaffolds_expected_files(tmp_path: Path):
    target = tmp_path / "ai-agent-foo"
    res = subprocess.run(
        [sys.executable, "-m", "platform_sdk.cli.main", "new", "agent",
         "--name", "foo", "--target", str(target)],
        capture_output=True, text=True, check=True,
    )
    assert target.exists()
    assert (target / "Dockerfile").exists()
    assert (target / "pyproject.toml").exists()
    assert (target / "src" / "app.py").exists()
    assert (target / "tests" / "unit").exists()


def test_new_mcp_scaffolds_expected_files(tmp_path: Path):
    target = tmp_path / "ai-mcp-foo"
    res = subprocess.run(
        [sys.executable, "-m", "platform_sdk.cli.main", "new", "mcp",
         "--name", "foo", "--target", str(target)],
        capture_output=True, text=True, check=True,
    )
    assert target.exists()
    assert (target / "src" / "main.py").exists()
    assert (target / "src" / "foo_service.py").exists()
```

- [ ] **Step 8.3: Run the test to confirm it fails**

Run:
```bash
cd /Users/admin-h26/enterprise-ai && pytest platform-sdk/tests/unit/test_cli_scaffold.py -v
```

Expected: FAIL.

- [ ] **Step 8.4: Implement the CLI**

Create `platform-sdk/platform_sdk/cli/__init__.py`:

```python
"""Scaffolding CLI for new agents and MCP servers."""
```

Create `platform-sdk/platform_sdk/cli/main.py`:

```python
"""platform-sdk command-line entry point."""
from __future__ import annotations

import shutil
from pathlib import Path

import click

TEMPLATES = Path(__file__).parent / "templates"


@click.group()
def cli() -> None:
    """Enterprise AI Platform SDK scaffolding tools."""


@cli.group()
def new() -> None:
    """Create a new agent or MCP server repo from the canonical template."""


def _render_tree(template_dir: Path, target: Path, name: str) -> None:
    if target.exists():
        raise click.UsageError(f"{target} already exists; refusing to overwrite.")
    shutil.copytree(template_dir, target)
    # Walk the tree and substitute {{name}} in file content + paths.
    for path in list(target.rglob("*")):
        if path.is_file():
            text = path.read_text()
            new_text = text.replace("{{name}}", name)
            if new_text != text:
                path.write_text(new_text)
        # Rename paths containing {{name}}.
        if "{{name}}" in path.name:
            path.rename(path.with_name(path.name.replace("{{name}}", name)))


@new.command("agent")
@click.option("--name", required=True, help="Short agent name, e.g. 'foo' (will produce ai-agent-foo).")
@click.option("--target", type=click.Path(), required=True, help="Path where the new repo dir is created.")
def new_agent(name: str, target: str) -> None:
    """Scaffold a new agent repo."""
    _render_tree(TEMPLATES / "agent", Path(target), name)
    click.echo(f"Scaffolded ai-agent-{name} at {target}")


@new.command("mcp")
@click.option("--name", required=True, help="Short MCP name, e.g. 'foo' (will produce ai-mcp-foo).")
@click.option("--target", type=click.Path(), required=True, help="Path where the new repo dir is created.")
def new_mcp(name: str, target: str) -> None:
    """Scaffold a new MCP server repo."""
    _render_tree(TEMPLATES / "mcp", Path(target), name)
    click.echo(f"Scaffolded ai-mcp-{name} at {target}")


if __name__ == "__main__":
    cli()
```

- [ ] **Step 8.5: Create the agent template tree**

Create the following files under `platform-sdk/platform_sdk/cli/templates/agent/`:

`Dockerfile`:
```dockerfile
ARG BASE_TAG=3.11-sdk0.4.0
FROM ghcr.io/narisun/ai-python-base:${BASE_TAG}

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY src/ /app/src/

USER appuser
EXPOSE 8000
CMD ["uvicorn", "src.app:app", "--host", "0.0.0.0", "--port", "8000"]
```

`pyproject.toml`:
```toml
[project]
name = "ai-agent-{{name}}"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "enterprise-ai-platform-sdk[fastapi] @ git+ssh://git@github.com/narisun/ai-platform-sdk.git@v0.4.0",
    "uvicorn[standard]>=0.30.0,<1.0.0",
]
```

`requirements.txt`:
```
enterprise-ai-platform-sdk[fastapi] @ git+ssh://git@github.com/narisun/ai-platform-sdk.git@v0.4.0
uvicorn[standard]>=0.30.0,<1.0.0
```

`src/__init__.py`:
```python
```

`src/app.py`:
```python
"""ai-agent-{{name}} — FastAPI application."""
from platform_sdk import BaseAgentApp


class {{name}}AgentApp(BaseAgentApp):
    service_name = "ai-agent-{{name}}"
    mcp_servers = {}
    enable_telemetry = True

    def build_dependencies(self, *, bridges, checkpointer, store):
        return {"placeholder": True}

    def routes(self):
        return []


_agent = {{name}}AgentApp()
app = _agent.create_app()
```

`tests/unit/__init__.py`:
```python
```

`tests/unit/test_smoke.py`:
```python
def test_app_imports():
    from src.app import app
    assert app is not None
```

`conftest.py`:
```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
```

`.gitignore`:
```
__pycache__/
.venv/
*.egg-info/
.pytest_cache/
```

`README.md`:
```markdown
# ai-agent-{{name}}

Generated from `platform-sdk new agent`. See `src/app.py` for the entry point.
```

- [ ] **Step 8.6: Create the MCP template tree**

Under `platform-sdk/platform_sdk/cli/templates/mcp/`:

`Dockerfile`:
```dockerfile
ARG BASE_TAG=3.11-sdk0.4.0
FROM ghcr.io/narisun/ai-python-base:${BASE_TAG}

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY src/ /app/src/

USER appuser
EXPOSE 8080
CMD ["python", "-m", "src.main"]
```

`requirements.txt`:
```
enterprise-ai-platform-sdk @ git+ssh://git@github.com/narisun/ai-platform-sdk.git@v0.4.0
```

`src/__init__.py`:
```python
```

`src/{{name}}_service.py`:
```python
"""ai-mcp-{{name}} — MCP service class."""
from typing import Any

from platform_sdk import MCPConfig, get_logger, make_error
from platform_sdk.base import McpService

log = get_logger(__name__)


class {{name}}McpService(McpService):
    cache_ttl_seconds = 300
    requires_database = False
    enable_telemetry = True

    async def on_startup(self) -> None:
        log.info("{{name}}_mcp_ready")

    def register_tools(self, mcp: Any) -> None:
        @mcp.tool()
        async def hello(name: str = "world") -> str:
            return f"Hello, {name}!"
```

`src/main.py`:
```python
"""ai-mcp-{{name}} — FastMCP entry point."""
import os

from mcp.server.fastmcp import FastMCP
from platform_sdk import configure_logging, get_logger

from .{{name}}_service import {{name}}McpService

configure_logging()
log = get_logger(__name__)

TRANSPORT = os.environ.get("MCP_TRANSPORT", "stdio")
service = {{name}}McpService("ai-mcp-{{name}}")

if TRANSPORT == "sse":
    mcp = FastMCP(
        "ai-mcp-{{name}}",
        lifespan=service.lifespan,
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8080")),
    )
else:
    mcp = FastMCP("ai-mcp-{{name}}", lifespan=service.lifespan)

service.register_tools(mcp)


if __name__ == "__main__":
    log.info("mcp_server_starting", transport=TRANSPORT)
    mcp.run(transport=TRANSPORT)
```

`tests/unit/__init__.py`:
```python
```

`tests/unit/test_smoke.py`:
```python
def test_service_imports():
    from src.{{name}}_service import {{name}}McpService
    svc = {{name}}McpService("test")
    assert svc.service_name == "test" or svc.name == "test"
```

`conftest.py`:
```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
```

`.gitignore`:
```
__pycache__/
.venv/
*.egg-info/
.pytest_cache/
```

`README.md`:
```markdown
# ai-mcp-{{name}}

Generated from `platform-sdk new mcp`. See `src/main.py` for the entry point.
```

- [ ] **Step 8.7: Reinstall SDK so the `platform-sdk` script registers**

Run:
```bash
cd /Users/admin-h26/enterprise-ai && pip install -e platform-sdk/ --quiet
which platform-sdk
```

Expected: a path inside the venv.

- [ ] **Step 8.8: Run the CLI tests to confirm they pass**

Run:
```bash
cd /Users/admin-h26/enterprise-ai && pytest platform-sdk/tests/unit/test_cli_scaffold.py -v
```

Expected: 3 passed.

- [ ] **Step 8.9: Manual scaffold smoke**

Run:
```bash
cd /tmp && rm -rf ai-agent-demo
platform-sdk new agent --name demo --target /tmp/ai-agent-demo
ls /tmp/ai-agent-demo
```

Expected: `Dockerfile  README.md  conftest.py  pyproject.toml  requirements.txt  src/  tests/`.

```bash
rm -rf /tmp/ai-agent-demo
```

- [ ] **Step 8.10: Commit**

```bash
cd /Users/admin-h26/enterprise-ai
git add platform-sdk/platform_sdk/cli/ \
        platform-sdk/tests/unit/test_cli_scaffold.py \
        platform-sdk/pyproject.toml
git commit -m "feat(platform-sdk): add 'platform-sdk new agent|mcp' scaffolding CLI

Click-based CLI that copies a template tree and substitutes {{name}}.
Templates target the canonical multi-repo layout: thin Dockerfile that
inherits from ghcr.io/narisun/ai-python-base, requirements.txt with the
SDK pinned via git+ssh URL, and a starter app.py / main.py that
extends BaseAgentApp / McpService.

Refs: docs/superpowers/plans/2026-04-30-multi-repo-restructure.md (Task 8)"
```

---

## Phase 5 — Repo Carve-Out

This phase creates the new repos and moves code into them with history preserved via `git filter-repo`. This is reversible — until the monorepo is archived, all PRs can still target it. The phase is broken into one task per new repo plus a final task to update `ai-dev-stack` to pull from the new image registry.

**Pre-flight — required tooling:**

- [ ] **Step P.1: Install `git filter-repo`**

Run:
```bash
brew install git-filter-repo
git filter-repo --version
```

Expected: a version number. (`git filter-repo` replaces the deprecated `git filter-branch`; it preserves history with proper rewrite semantics.)

- [ ] **Step P.2: Create the new GitHub repos (manual, via GitHub UI or `gh`)**

Run (or do it via the UI):
```bash
for repo in ai-platform-sdk ai-agent-analytics ai-mcp-data ai-mcp-salesforce ai-mcp-payments ai-mcp-news-search ai-frontend-analytics ai-dev-stack; do
  gh repo create narisun/$repo --public --description "Enterprise AI Platform — $repo"
done
```

Expected: 8 repos created, all empty.

---

### Task 9: Carve out `ai-platform-sdk`

**Files:**
- Source: `platform-sdk/` subtree of the monorepo
- Target: new repo `narisun/ai-platform-sdk`

- [ ] **Step 9.1: Clone monorepo to a fresh working directory**

Run:
```bash
mkdir -p ~/carve-out && cd ~/carve-out
git clone --no-local /Users/admin-h26/enterprise-ai ai-platform-sdk
cd ai-platform-sdk
```

- [ ] **Step 9.2: Filter to keep only `platform-sdk/` and rewrite paths to root**

Run:
```bash
git filter-repo \
  --subdirectory-filter platform-sdk \
  --force
```

This rewrites every commit so files originally at `platform-sdk/foo` now appear at `foo`.

- [ ] **Step 9.3: Move the parked workflow into `.github/`**

Run:
```bash
mkdir -p .github
mv .github-pending/workflows .github/workflows
rmdir .github-pending
git add .github
git commit -m "chore: activate release workflow"
```

- [ ] **Step 9.4: Set the new remote and push**

Run:
```bash
git remote remove origin
git remote add origin git@github.com:narisun/ai-platform-sdk.git
git push -u origin main
```

- [ ] **Step 9.5: Cut the release branch and tag**

Run:
```bash
git checkout -b release/0.4
git push -u origin release/0.4
git tag -a v0.4.0 -m "Release 0.4.0"
git push origin v0.4.0
```

This triggers the release workflow (Step 6.5) which builds and pushes `ghcr.io/narisun/ai-python-base:3.11-sdk0.4.0`.

- [ ] **Step 9.6: Verify the workflow succeeded**

Run:
```bash
gh run list --repo narisun/ai-platform-sdk --limit 3
```

Wait until the `Release SDK` run shows `completed success`. Then:

```bash
docker pull ghcr.io/narisun/ai-python-base:3.11-sdk0.4.0
```

Expected: pulls cleanly.

---

### Task 10: Carve out `ai-agent-analytics`

**Files:**
- Source: `agents/analytics-agent/` subtree
- Target: new repo `narisun/ai-agent-analytics`

- [ ] **Step 10.1: Clone fresh and filter**

Run:
```bash
cd ~/carve-out
git clone --no-local /Users/admin-h26/enterprise-ai ai-agent-analytics
cd ai-agent-analytics
git filter-repo \
  --subdirectory-filter agents/analytics-agent \
  --force
```

- [ ] **Step 10.2: Replace the SDK pin in `requirements.txt`**

Edit `requirements.txt` and ensure the first line is exactly:

```
enterprise-ai-platform-sdk[fastapi,postgres-checkpointer] @ git+ssh://git@github.com/narisun/ai-platform-sdk.git@v0.4.0
```

(Plus the extras kept in Step 7.2.)

- [ ] **Step 10.3: Add a CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main, "release/*"]
  pull_request:

jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - uses: webfactory/ssh-agent@v0.9.0
        with:
          ssh-private-key: ${{ secrets.AI_PLATFORM_SDK_DEPLOY_KEY }}
      - run: |
          ssh-keyscan github.com >> ~/.ssh/known_hosts
          pip install -r requirements.txt
          pip install pytest pytest-asyncio pyjwt
          pytest tests/unit -v -m unit
```

This requires a deploy key on `narisun/ai-platform-sdk` (read-only) and the corresponding private key stored as `AI_PLATFORM_SDK_DEPLOY_KEY` secret on `ai-agent-analytics`. Document this in `README.md`.

- [ ] **Step 10.4: Add a `release.yml` that builds the image on tag**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*.*.*'

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - name: Extract version
        id: ver
        run: echo "v=${GITHUB_REF_NAME#v}" >> "$GITHUB_OUTPUT"
      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Build & push
        uses: docker/build-push-action@v5
        with:
          context: .
          file: Dockerfile
          push: true
          tags: |
            ghcr.io/narisun/ai-agent-analytics:${{ steps.ver.outputs.v }}
            ghcr.io/narisun/ai-agent-analytics:latest
```

- [ ] **Step 10.5: Update Dockerfile build context (paths now relative to repo root)**

Edit `Dockerfile`. The `COPY` paths from the monorepo (`COPY agents/analytics-agent/requirements.txt .`) are no longer correct. Replace with:

```dockerfile
ARG BASE_TAG=3.11-sdk0.4.0
FROM ghcr.io/narisun/ai-python-base:${BASE_TAG}

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY src/ /app/src/

USER appuser
EXPOSE 8000
CMD ["uvicorn", "src.app:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 10.6: Push, cut release branch, tag**

```bash
git remote remove origin
git remote add origin git@github.com:narisun/ai-agent-analytics.git
git add -A && git commit -m "chore: prepare for repo split (paths, CI, SDK pin)"
git push -u origin main
git checkout -b release/0.4 && git push -u origin release/0.4
git tag -a v0.4.0 -m "First post-split release"
git push origin v0.4.0
```

Verify the release workflow succeeds and `ghcr.io/narisun/ai-agent-analytics:0.4.0` is published.

---

### Task 11: Carve out each MCP repo (apply Task 10 pattern × 4)

For each of `data-mcp`, `salesforce-mcp`, `payments-mcp`, `news-search-mcp`, repeat the Task 10 sequence with these adjustments:

- [ ] **Step 11.1 (per MCP): Clone + filter**

```bash
cd ~/carve-out
git clone --no-local /Users/admin-h26/enterprise-ai ai-mcp-<NAME>
cd ai-mcp-<NAME>
git filter-repo --subdirectory-filter tools/<NAME> --force
```

- [ ] **Step 11.2: Update Dockerfile paths to root** (same shape as Step 10.5 but `EXPOSE` matches the MCP's port: 8080 / 8081 / 8082 / 8083; CMD is `python -m src.main`).

- [ ] **Step 11.3: Pin SDK in `requirements.txt`** (Step 7.4 already left this near-empty; add the SDK pin):

```
enterprise-ai-platform-sdk @ git+ssh://git@github.com/narisun/ai-platform-sdk.git@v0.4.0
```

(For news-search-mcp also keep `tavily-python>=0.5.0,<1.0.0`.)

- [ ] **Step 11.4: Add `.github/workflows/ci.yml` and `release.yml`** (copy from `ai-agent-analytics` Step 10.3 / 10.4; only the image name changes to `ghcr.io/narisun/ai-mcp-<NAME>`).

- [ ] **Step 11.5: Push, cut release branch, tag.**

Repeat the full sequence for all four MCPs.

---

### Task 12: Carve out `ai-frontend-analytics`

**Files:**
- Source: `frontends/analytics-dashboard/` subtree
- Target: new repo `narisun/ai-frontend-analytics`

- [ ] **Step 12.1: Clone, filter, push**

```bash
cd ~/carve-out
git clone --no-local /Users/admin-h26/enterprise-ai ai-frontend-analytics
cd ai-frontend-analytics
git filter-repo --subdirectory-filter frontends/analytics-dashboard --force
git remote remove origin
git remote add origin git@github.com:narisun/ai-frontend-analytics.git
git push -u origin main
```

- [ ] **Step 12.2: Add a Node CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main, "release/*"]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run lint
      - run: npm run build
```

- [ ] **Step 12.3: Cut release branch + tag (image build optional — frontend may deploy via Vercel instead).**

```bash
git checkout -b release/0.4 && git push -u origin release/0.4
git tag -a v0.4.0 -m "First post-split release"
git push origin v0.4.0
```

---

### Task 13: Carve out `ai-dev-stack`

**Files:**
- Source: `docker-compose.yml`, `docker-compose.cloud.yml`, `Makefile`, `platform/`, `testdata/`, `tools/policies/` (→ `policies/`), `tests/integration/`, `tests/evals/`, `tests/conftest.py`, `tests/requirements.txt`, `.env.example`
- Target: new repo `narisun/ai-dev-stack`

This is the most invasive carve-out because it pulls files from many monorepo paths.

- [ ] **Step 13.1: Clone monorepo and filter to keep selected paths**

```bash
cd ~/carve-out
git clone --no-local /Users/admin-h26/enterprise-ai ai-dev-stack
cd ai-dev-stack
git filter-repo \
  --path docker-compose.yml \
  --path docker-compose.cloud.yml \
  --path Makefile \
  --path platform/ \
  --path testdata/ \
  --path tools/policies/ \
  --path tests/integration/ \
  --path tests/evals/ \
  --path tests/conftest.py \
  --path tests/requirements.txt \
  --path .env.example \
  --force
```

- [ ] **Step 13.2: Restructure paths**

Move `tools/policies/` → `policies/`, then drop the now-empty `tools/`:

```bash
git mv tools/policies policies
rmdir tools 2>/dev/null || true
```

Move `tests/integration/`, `tests/evals/`, `tests/conftest.py`, `tests/requirements.txt` to top-level (they are already under `tests/` after the filter — keep them there).

- [ ] **Step 13.3: Update `docker-compose.yml` to pull tagged images instead of building**

For each agent / MCP service in the compose file, replace the `build:` block with `image: ghcr.io/narisun/<repo>:<tag>`. Example for analytics-agent:

Before:
```yaml
analytics-agent:
  container_name: ai-analytics-agent
  build:
    context: .
    dockerfile: agents/analytics-agent/Dockerfile
  ...
```

After:
```yaml
analytics-agent:
  container_name: ai-analytics-agent
  image: ghcr.io/narisun/ai-agent-analytics:0.4.0
  ...
```

Repeat for `data-mcp`, `salesforce-mcp`, `payments-mcp`, `news-search-mcp`. Also update the `analytics-dashboard:` block to either pull a tagged image (if the frontend repo publishes one) or remove the service if that frontend deploys to Vercel exclusively.

- [ ] **Step 13.4: Update Makefile**

Edit `Makefile`. Drop the editable SDK install (no longer needed in dev-stack):

```makefile
$(PYTHON):
    python3 -m venv $(VENV)
    $(PIP) install --upgrade pip --quiet
    $(PIP) install -r tests/requirements.txt --quiet
```

- [ ] **Step 13.5: Update OPA policy mount path in compose**

The OPA service mounts policies. Find:
```yaml
opa:
  volumes:
    - ./tools/policies/opa:/policies:ro
```
And change `./tools/policies/opa` → `./policies/opa`.

- [ ] **Step 13.6: Add an integration-test CI workflow that pulls the latest images**

Create `.github/workflows/e2e.yml`:

```yaml
name: E2E

on:
  push:
    branches: [main]
  pull_request:
  schedule:
    - cron: '0 6 * * *'

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - name: Pull images and bring up stack
        run: |
          docker compose pull
          docker compose up -d
          sleep 30
      - name: Install test deps and run integration tests
        run: |
          pip install -r tests/requirements.txt
          pytest tests/integration -v
      - name: Show logs on failure
        if: failure()
        run: docker compose logs --no-color
```

- [ ] **Step 13.7: Push and tag**

```bash
git add -A && git commit -m "chore: restructure for ai-dev-stack repo (policies/, image refs, Makefile)"
git remote remove origin
git remote add origin git@github.com:narisun/ai-dev-stack.git
git push -u origin main
git checkout -b release/0.4 && git push -u origin release/0.4
git tag v0.4.0 && git push origin v0.4.0
```

- [ ] **Step 13.8: Final smoke — clone fresh and bring the stack up**

```bash
cd /tmp && git clone git@github.com:narisun/ai-dev-stack.git
cd ai-dev-stack
make setup
docker compose ps
```

Expected: every service `Up (healthy)`. Then run integration tests:

```bash
pytest tests/integration -v
```

Expected: all green.

---

### Task 14: Archive the monorepo

Once Tasks 9–13 are merged and CI in every new repo is green, archive the monorepo so future commits are forced into the right places.

- [ ] **Step 14.1: Verify all consumers green**

For each new repo, confirm:
```bash
gh run list --repo narisun/<repo> --limit 1
```
shows the latest run as `completed success`.

- [ ] **Step 14.2: Update the monorepo README to point at the new repos**

Edit `/Users/admin-h26/enterprise-ai/README.md` and replace the architecture section with:

```markdown
> **This monorepo has been split.** Active development happens in:
>
> - https://github.com/narisun/ai-platform-sdk
> - https://github.com/narisun/ai-agent-analytics
> - https://github.com/narisun/ai-mcp-data
> - https://github.com/narisun/ai-mcp-salesforce
> - https://github.com/narisun/ai-mcp-payments
> - https://github.com/narisun/ai-mcp-news-search
> - https://github.com/narisun/ai-frontend-analytics
> - https://github.com/narisun/ai-dev-stack
>
> This repository is preserved for historical reference only.
```

Commit and push:

```bash
cd /Users/admin-h26/enterprise-ai
git add README.md
git commit -m "docs: monorepo split notice"
git push origin main
```

- [ ] **Step 14.3: Archive on GitHub**

Run:
```bash
gh repo archive narisun/enterprise-ai --yes
```

(Or use the GitHub UI: Settings → Danger Zone → Archive this repository.)

---

## Self-Review Checklist

Run through this after the plan is in hand and before starting work.

| Item | Confirmed? |
|------|-----------|
| Every new SDK feature (`mcp_auth` move, `BaseAgentApp`, `testing.plugin`, `cli`) has a TDD task with failing-test → impl → passing-test → commit. | ✅ |
| Every consumer change (analytics-agent, MCPs, frontend) has a baseline-test step before the change. | ✅ |
| Dockerfile rewrites are paired with a `make restart` + `pytest tests/integration` verification step. | ✅ |
| `git filter-repo` is used for every carve-out so commit history is preserved. | ✅ |
| Each new repo gets `main` + `release/0.4` + tag `v0.4.0` so the branching model is in place from day 1. | ✅ |
| The base image build is verified locally (Step 6.4) before any Dockerfile depends on it (Task 7). | ✅ |
| The deprecation shim at `tools/shared/mcp_auth.py` survives until the carve-out, then disappears with `tools/` itself. | ✅ |
| OPA policies move to `ai-dev-stack/policies/`, not into any service repo. | ✅ |
| `infra/azure/` (Helm) is explicitly out of scope for this round. | ✅ |
| No step says "TBD" / "implement later" — every code block is executable. | ✅ |
| Frontend (`ai-frontend-analytics`) is carved out as its own repo per the user's decision. | ✅ |
| Legacy `agents/src/` is deleted in Task 5 before the split, so no stale code carries over. | ✅ |

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-30-multi-repo-restructure.md`.

Two execution options when you're ready:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch with checkpoints for review.

Which approach do you want when execution starts?
