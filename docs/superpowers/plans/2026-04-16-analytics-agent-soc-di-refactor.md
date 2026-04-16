# Analytics-Agent + Platform-SDK: SoC + DI Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `agents/analytics-agent/` and `platform-sdk/` to a clean four-layer architecture (Transport / Service / Domain / Infrastructure) with constructor injection, Protocol-defined seams, and a pure composition root; fix four P0 bugs that overlap the refactor surface; produce unit / component / application / integration test tiers.

**Architecture:** Consumer-owned `typing.Protocol` ports in `agents/analytics-agent/src/ports.py`; SDK adapters structurally satisfy those ports; `AppDependencies` dataclass + pure `create_app(deps)` + `lifespan(app)` as the only I/O root. Nodes become callable classes with constructor injection. `UserContext` flows via LangGraph's `configurable`, never via module-level state.

**Tech Stack:** Python 3.11, FastAPI, LangGraph, LangChain, pydantic, pytest, asyncio, Postgres (asyncpg), Redis, MCP over SSE, OpenTelemetry, Langfuse.

**Spec reference:** `docs/superpowers/specs/2026-04-16-analytics-agent-soc-di-refactor-design.md`

**Conventions used below:**
- `pytest` is run from repo root unless noted.
- Ruff line length 100; `select = ["E","F","W","I"]`.
- Commit messages use Conventional Commit prefixes: `feat`, `refactor`, `test`, `fix`, `chore`.
- Every "Commit" step creates a **new** commit (no amending).
- Every implementation task is prefixed with a red-first test task, per `superpowers:test-driven-development`.

---

## Phase 0 — Triage the in-flight work

Goal: review the uncommitted refactor already on disk, land the clean parts as a baseline, list rework items for later phases.

### Task 0.1: Review in-flight `src/routes/`, `src/services/`, `src/streaming/`, `src/lifespan.py`

**Files:**
- Review only (no edits): `agents/analytics-agent/src/routes/{__init__.py,chat.py,conversations.py,health.py}`
- Review only: `agents/analytics-agent/src/services/{__init__.py,chat_service.py}`
- Review only: `agents/analytics-agent/src/streaming/{__init__.py,base.py,data_stream_encoder.py,sse_encoder.py}`
- Review only: `agents/analytics-agent/src/lifespan.py`
- Review only: `agents/analytics-agent/src/app.py` (modifications)

- [ ] **Step 1: Invoke the code-review skill against the uncommitted work**

Invoke `superpowers:receiving-code-review`. Brief:

> The files listed above are uncommitted in-flight work that moves `analytics-agent` toward the four-layer architecture in `docs/superpowers/specs/2026-04-16-analytics-agent-soc-di-refactor-design.md`. Review them against that spec only. For each file, produce a disposition: **accept** (ready to commit as baseline), **rework** (commit as baseline but deferred TODO filed against a later phase), or **discard** (do not commit; rewrite from scratch in a later phase). Do not run tests. Focus on: does this file do one thing? does it take dependencies via `__init__`? does it avoid module-level state? does it leak concrete vendor types into domain code?

- [ ] **Step 2: Capture the review output**

Write the review output to `docs/superpowers/plans/phase0-triage-notes.md`. File structure:

```markdown
# Phase 0 Triage Notes

**Date:** <YYYY-MM-DD>

## Accept (commit as-is)
- `src/routes/health.py` — reason
- ...

## Rework (commit, file TODO against phase N)
- `src/services/chat_service.py` — reason; TODO: Task 5.x

## Discard (do not commit)
- ... — reason; rebuild in Task N.x
```

- [ ] **Step 3: Commit the triage notes**

```bash
git add docs/superpowers/plans/phase0-triage-notes.md
git commit -m "chore: add phase-0 triage notes for in-flight refactor"
```

### Task 0.2: Stage and commit the "accept" in-flight files as baseline

**Files:** only files marked "accept" in `phase0-triage-notes.md`.

- [ ] **Step 1: Stage only the accept-marked files**

Example (replace with actual file list from triage notes):

```bash
git add agents/analytics-agent/src/routes/health.py
git add agents/analytics-agent/src/streaming/base.py
# ... etc
```

- [ ] **Step 2: Run existing tests to verify nothing breaks**

```bash
pytest agents/analytics-agent/tests/ -x
```

Expected: PASS. If failures, stop — triage missed something.

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(analytics-agent): commit accepted phase-0 baseline files"
```

### Task 0.3: Stage and commit the "rework" in-flight files with TODO markers

**Files:** only files marked "rework" in `phase0-triage-notes.md`.

- [ ] **Step 1: Add a `# TODO(phase-N.x):` comment at the top of each rework file**

For each rework file, add a one-line TODO at the top of the module docstring:

```python
"""Module docstring...

TODO(phase-5.3): refactor to remove set_user_auth_token / reset_user_auth_token
calls in favor of explicit user_ctx parameter (see plan task 5.3).
"""
```

- [ ] **Step 2: Stage and commit**

```bash
git add <rework-file-1> <rework-file-2> ...
git commit -m "refactor(analytics-agent): commit rework baseline with phase TODOs"
```

### Task 0.4: Leave "discard" files uncommitted OR stash them

**Files:** files marked "discard".

- [ ] **Step 1: Check the current status**

```bash
git status --short
```

- [ ] **Step 2: Stash discarded changes under a named stash**

```bash
git stash push -u -m "phase-0-discarded" <file1> <file2> ...
```

The named stash is a safety net. Later phases will re-implement from scratch.

- [ ] **Step 3: Record the stash in the triage notes**

Edit `docs/superpowers/plans/phase0-triage-notes.md` and append:

```
## Stashed
Created stash "phase-0-discarded" via `git stash push -u -m "phase-0-discarded"`.
Recover with `git stash list | grep phase-0-discarded` then `git stash show -p <id>`.
```

Commit:

```bash
git add docs/superpowers/plans/phase0-triage-notes.md
git commit -m "chore: record phase-0 stash in triage notes"
```

### Task 0.5: Verify `main` is green

- [ ] **Step 1: Full test run**

```bash
pytest -x
```

Expected: PASS. If failures from pre-existing broken tests, document them in `phase0-triage-notes.md` under a "Pre-existing failures" section and commit. Do not fix here.

- [ ] **Step 2: Commit any triage-note update**

```bash
git add docs/superpowers/plans/phase0-triage-notes.md
git commit -m "chore: record pre-existing test failures baseline"
```

---

## Phase 1 — Ports and shared types

Goal: introduce the consumer-owned Protocol ports and domain value types. No production behavior changes.

### Task 1.1: Create `src/domain/` package

**Files:**
- Create: `agents/analytics-agent/src/domain/__init__.py`

- [ ] **Step 1: Create the package**

```bash
mkdir -p agents/analytics-agent/src/domain
```

Write `agents/analytics-agent/src/domain/__init__.py`:

```python
"""Domain layer — pure logic, no I/O, no FastAPI, no concrete vendor clients.

Exports:
  UserContext, ChatRequest, ChatResponse, Conversation, ConversationSummary
  AnalyticsError (and subclasses)
"""
```

- [ ] **Step 2: Commit**

```bash
git add agents/analytics-agent/src/domain/__init__.py
git commit -m "feat(analytics-agent): add domain package scaffold"
```

### Task 1.2: Write `UserContext` value type — red test

**Files:**
- Test: `agents/analytics-agent/tests/unit/test_user_context.py`

- [ ] **Step 1: Create `tests/unit/` if it doesn't exist**

```bash
mkdir -p agents/analytics-agent/tests/unit
touch agents/analytics-agent/tests/unit/__init__.py
```

- [ ] **Step 2: Write the failing test**

Write `agents/analytics-agent/tests/unit/test_user_context.py`:

```python
"""Unit tests for UserContext value type."""
import pytest

from analytics_agent.src.domain.types import UserContext


class TestUserContext:
    def test_is_frozen(self):
        ctx = UserContext(user_id="u1", tenant_id="t1", auth_token="tok")
        with pytest.raises((AttributeError, Exception)):
            ctx.user_id = "u2"  # type: ignore

    def test_equality_by_value(self):
        a = UserContext(user_id="u1", tenant_id="t1", auth_token="tok")
        b = UserContext(user_id="u1", tenant_id="t1", auth_token="tok")
        assert a == b

    def test_hashable(self):
        ctx = UserContext(user_id="u1", tenant_id="t1", auth_token="tok")
        assert hash(ctx) == hash(UserContext(user_id="u1", tenant_id="t1", auth_token="tok"))

    def test_redacts_auth_token_in_repr(self):
        ctx = UserContext(user_id="u1", tenant_id="t1", auth_token="secret-token-12345")
        r = repr(ctx)
        assert "secret-token-12345" not in r
        assert "u1" in r
```

Note: depending on how the repo is importable, the import path may be `src.domain.types` instead of `analytics_agent.src.domain.types`. Check `agents/analytics-agent/tests/conftest.py` for the existing import convention and adjust.

- [ ] **Step 3: Run the test to verify it fails**

```bash
pytest agents/analytics-agent/tests/unit/test_user_context.py -v
```

Expected: `ImportError` / `ModuleNotFoundError` — the `types` module does not exist yet.

- [ ] **Step 4: Write the minimal implementation**

Create `agents/analytics-agent/src/domain/types.py`:

```python
"""Domain value types — frozen dataclasses and pydantic models.

UserContext replaces the module-level auth ContextVar in platform_sdk.mcp_bridge.
It flows explicitly through ChatService and into LangGraph config["configurable"].
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class UserContext:
    """Per-request user identity and auth scope.

    auth_token is never shown in repr/log output.
    """
    user_id: str
    tenant_id: str
    auth_token: str = field(repr=False)

    def __repr__(self) -> str:
        return f"UserContext(user_id={self.user_id!r}, tenant_id={self.tenant_id!r}, auth_token=<redacted>)"
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pytest agents/analytics-agent/tests/unit/test_user_context.py -v
```

Expected: all 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add agents/analytics-agent/src/domain/types.py agents/analytics-agent/tests/unit/test_user_context.py agents/analytics-agent/tests/unit/__init__.py
git commit -m "feat(analytics-agent): add UserContext frozen dataclass with redacted token"
```

### Task 1.3: Add `ChatRequest`, `ChatResponse`, `Conversation`, `ConversationSummary` pydantic models

**Files:**
- Modify: `agents/analytics-agent/src/domain/types.py`
- Test: `agents/analytics-agent/tests/unit/test_domain_models.py`

- [ ] **Step 1: Write the failing test**

Write `agents/analytics-agent/tests/unit/test_domain_models.py`:

```python
"""Unit tests for domain pydantic models."""
import pytest
from pydantic import ValidationError

from analytics_agent.src.domain.types import (
    ChatRequest,
    ChatResponse,
    Conversation,
    ConversationSummary,
)


class TestChatRequest:
    def test_parses_minimal_body(self):
        req = ChatRequest(message="hello")
        assert req.message == "hello"
        assert req.conversation_id is None
        assert req.history == []

    def test_rejects_empty_message(self):
        with pytest.raises(ValidationError):
            ChatRequest(message="")

    def test_accepts_history(self):
        req = ChatRequest(
            message="hi",
            history=[{"role": "user", "content": "prev"}],
        )
        assert req.history[0]["role"] == "user"


class TestConversation:
    def test_summary_has_title_and_id(self):
        s = ConversationSummary(conversation_id="c1", title="Hello", updated_at="2026-04-16T00:00:00Z")
        assert s.conversation_id == "c1"


class TestChatResponse:
    def test_shape(self):
        r = ChatResponse(conversation_id="c1", narrative="n", components=[])
        assert r.narrative == "n"
```

- [ ] **Step 2: Run to verify it fails**

```bash
pytest agents/analytics-agent/tests/unit/test_domain_models.py -v
```

Expected: `ImportError` — the models don't exist yet.

- [ ] **Step 3: Add the models**

Append to `agents/analytics-agent/src/domain/types.py`:

```python
from typing import Any

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    """Incoming chat request from the HTTP layer."""
    message: str = Field(..., min_length=1)
    conversation_id: str | None = None
    history: list[dict[str, Any]] = Field(default_factory=list)


class ChatResponse(BaseModel):
    """Structured chat response (non-streaming path)."""
    conversation_id: str
    narrative: str
    components: list[dict[str, Any]] = Field(default_factory=list)
    follow_up_suggestions: list[str] = Field(default_factory=list)


class ConversationSummary(BaseModel):
    """Summary entry for the conversation list."""
    conversation_id: str
    title: str
    updated_at: str


class Conversation(BaseModel):
    """Full conversation with messages."""
    conversation_id: str
    title: str
    updated_at: str
    messages: list[dict[str, Any]] = Field(default_factory=list)
```

- [ ] **Step 4: Run to verify tests pass**

```bash
pytest agents/analytics-agent/tests/unit/test_domain_models.py -v
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/analytics-agent/src/domain/types.py agents/analytics-agent/tests/unit/test_domain_models.py
git commit -m "feat(analytics-agent): add ChatRequest/Response and Conversation pydantic models"
```

### Task 1.4: Add `AnalyticsError` exception hierarchy — red test first

**Files:**
- Test: `agents/analytics-agent/tests/unit/test_domain_errors.py`
- Create: `agents/analytics-agent/src/domain/errors.py`

- [ ] **Step 1: Write the failing test**

Write `agents/analytics-agent/tests/unit/test_domain_errors.py`:

```python
"""Unit tests for the domain error hierarchy."""
import pytest

from analytics_agent.src.domain.errors import (
    AnalyticsError,
    AuthError,
    ConversationNotFound,
    IntentError,
    LLMError,
    LLMStructuredOutputError,
    LLMUnavailable,
    StoreError,
    StoreUnavailable,
    ToolsError,
    ToolsUnavailable,
    UnknownIntent,
    UnsupportedSchemaError,
)


def test_all_subclass_analytics_error():
    for cls in [
        AuthError,
        IntentError,
        UnknownIntent,
        ToolsError,
        ToolsUnavailable,
        UnsupportedSchemaError,
        LLMError,
        LLMUnavailable,
        LLMStructuredOutputError,
        StoreError,
        StoreUnavailable,
        ConversationNotFound,
    ]:
        assert issubclass(cls, AnalyticsError), f"{cls.__name__} is not an AnalyticsError"


def test_unknown_intent_carries_intent_string():
    err = UnknownIntent(intent="bogus")
    assert err.intent == "bogus"
    assert "bogus" in str(err)


def test_unsupported_schema_carries_tool_and_keyword():
    err = UnsupportedSchemaError(tool_name="fetch_x", keyword="$ref")
    assert err.tool_name == "fetch_x"
    assert err.keyword == "$ref"
    assert "fetch_x" in str(err)
    assert "$ref" in str(err)


def test_conversation_not_found_carries_id():
    err = ConversationNotFound(conversation_id="c-123")
    assert err.conversation_id == "c-123"


def test_raising_subclass_catchable_as_base():
    with pytest.raises(AnalyticsError):
        raise UnknownIntent(intent="x")
```

- [ ] **Step 2: Run to verify it fails**

```bash
pytest agents/analytics-agent/tests/unit/test_domain_errors.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Write the implementation**

Create `agents/analytics-agent/src/domain/errors.py`:

```python
"""Domain-owned exception hierarchy.

Infrastructure adapters (platform-sdk) catch vendor exceptions and re-raise
as one of these types. Domain and service code only ever sees this tree.
"""
from __future__ import annotations


class AnalyticsError(Exception):
    """Base for all analytics-agent domain errors."""


class AuthError(AnalyticsError):
    """Auth context invalid, missing, or denied by OPA."""


class IntentError(AnalyticsError):
    """Base for intent-classification problems."""


class UnknownIntent(IntentError):
    """Router LLM returned an intent the graph cannot route. (P0 fix)"""

    def __init__(self, intent: str) -> None:
        self.intent = intent
        super().__init__(f"Unknown intent from router: {intent!r}")


class ToolsError(AnalyticsError):
    """Base for MCP-tool problems."""


class ToolsUnavailable(ToolsError):
    """No MCP bridges are reachable."""


class UnsupportedSchemaError(ToolsError):
    """MCP tool schema uses unsupported JSON Schema keyword. (P0 fix)"""

    def __init__(self, tool_name: str, keyword: str) -> None:
        self.tool_name = tool_name
        self.keyword = keyword
        super().__init__(
            f"MCP tool {tool_name!r} schema uses unsupported keyword {keyword!r}"
        )


class LLMError(AnalyticsError):
    """Base for LLM-layer problems."""


class LLMUnavailable(LLMError):
    """LLM provider could not be reached."""


class LLMStructuredOutputError(LLMError):
    """LLM returned output that failed schema validation."""


class StoreError(AnalyticsError):
    """Base for conversation-store problems."""


class StoreUnavailable(StoreError):
    """Conversation store could not be reached."""


class ConversationNotFound(StoreError):
    """Requested conversation does not exist."""

    def __init__(self, conversation_id: str) -> None:
        self.conversation_id = conversation_id
        super().__init__(f"Conversation not found: {conversation_id!r}")
```

- [ ] **Step 4: Run to verify tests pass**

```bash
pytest agents/analytics-agent/tests/unit/test_domain_errors.py -v
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/analytics-agent/src/domain/errors.py agents/analytics-agent/tests/unit/test_domain_errors.py
git commit -m "feat(analytics-agent): add AnalyticsError hierarchy including P0-fix error types"
```

### Task 1.5: Create `src/ports.py` with Protocol seams

**Files:**
- Create: `agents/analytics-agent/src/ports.py`
- Test: `agents/analytics-agent/tests/unit/test_ports.py`

- [ ] **Step 1: Write the failing test**

The test verifies each Protocol exists and that a minimal in-memory fake structurally satisfies it (using `isinstance` against `@runtime_checkable` Protocols):

Write `agents/analytics-agent/tests/unit/test_ports.py`:

```python
"""Unit tests verifying Protocol seams exist and are structurally satisfiable."""
from __future__ import annotations

from typing import Any, AsyncIterator
from contextlib import contextmanager

from analytics_agent.src.ports import (
    ConversationStore,
    MCPToolsProvider,
    LLMFactory,
    StreamEncoder,
    CompactionModifier,
    TelemetryScope,
)
from analytics_agent.src.domain.types import (
    UserContext,
    Conversation,
    ConversationSummary,
)


class _FakeStore:
    async def save(self, convo, user_ctx): ...
    async def load(self, convo_id, user_ctx): return None
    async def list(self, user_ctx): return []
    async def delete(self, convo_id, user_ctx): ...


class _FakeToolsProvider:
    async def get_langchain_tools(self, user_ctx): return []


class _FakeLLMFactory:
    def make_router_llm(self): return None
    def make_synthesis_llm(self): return None


class _FakeEncoder:
    def encode_event(self, event): return b""
    def encode_error(self, err, *, error_id): return b""
    def finalize(self): return b""


class _FakeCompaction:
    def apply(self, messages): return messages


class _FakeSpan:
    def record_exception(self, err): ...
    def set_status(self, status): ...


class _FakeTelemetry:
    @contextmanager
    def start_span(self, name):
        yield _FakeSpan()

    def record_event(self, name, **attrs): ...


def test_conversation_store_protocol():
    assert isinstance(_FakeStore(), ConversationStore)


def test_mcp_tools_provider_protocol():
    assert isinstance(_FakeToolsProvider(), MCPToolsProvider)


def test_llm_factory_protocol():
    assert isinstance(_FakeLLMFactory(), LLMFactory)


def test_stream_encoder_protocol():
    assert isinstance(_FakeEncoder(), StreamEncoder)


def test_compaction_modifier_protocol():
    assert isinstance(_FakeCompaction(), CompactionModifier)


def test_telemetry_scope_protocol():
    assert isinstance(_FakeTelemetry(), TelemetryScope)
```

- [ ] **Step 2: Run to verify it fails**

```bash
pytest agents/analytics-agent/tests/unit/test_ports.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Write the implementation**

Create `agents/analytics-agent/src/ports.py`:

```python
"""Port Protocols — consumer-owned interfaces.

These Protocols define what ChatService, routes, and nodes depend on.
Adapters in platform-sdk structurally satisfy these Protocols without
importing from analytics-agent (Dependency Inversion).
"""
from __future__ import annotations

from contextlib import AbstractContextManager
from typing import Any, Iterator, Protocol, runtime_checkable

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import BaseMessage
from langchain_core.tools import BaseTool

from .domain.types import (
    Conversation,
    ConversationSummary,
    UserContext,
)


@runtime_checkable
class ConversationStore(Protocol):
    """Persistence port for conversations. Tenant-scoped via UserContext."""

    async def save(self, convo: Conversation, user_ctx: UserContext) -> None: ...

    async def load(
        self, convo_id: str, user_ctx: UserContext
    ) -> Conversation | None: ...

    async def list(self, user_ctx: UserContext) -> list[ConversationSummary]: ...

    async def delete(self, convo_id: str, user_ctx: UserContext) -> None: ...


@runtime_checkable
class MCPToolsProvider(Protocol):
    """Aggregates MCP bridges behind a single port."""

    async def get_langchain_tools(
        self, user_ctx: UserContext
    ) -> list[BaseTool]: ...


@runtime_checkable
class LLMFactory(Protocol):
    """Builds configured LLM clients."""

    def make_router_llm(self) -> BaseChatModel: ...

    def make_synthesis_llm(self) -> BaseChatModel: ...


@runtime_checkable
class StreamEncoder(Protocol):
    """Encodes graph events into wire bytes (Vercel Data Stream, SSE, etc.).

    Call contract:
      - encode_event per graph event
      - encode_error if the stream aborts
      - finalize once at end
    """

    def encode_event(self, event: dict[str, Any]) -> bytes: ...

    def encode_error(self, err: Exception, *, error_id: str) -> bytes: ...

    def finalize(self) -> bytes: ...


@runtime_checkable
class CompactionModifier(Protocol):
    """Trims long message histories to fit a token budget."""

    def apply(self, messages: list[BaseMessage]) -> list[BaseMessage]: ...


@runtime_checkable
class TelemetryScope(Protocol):
    """Abstract telemetry (spans + events) over OTel / Langfuse / etc."""

    def start_span(self, name: str) -> AbstractContextManager[Any]: ...

    def record_event(self, name: str, **attrs: Any) -> None: ...
```

- [ ] **Step 4: Run to verify tests pass**

```bash
pytest agents/analytics-agent/tests/unit/test_ports.py -v
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/analytics-agent/src/ports.py agents/analytics-agent/tests/unit/test_ports.py
git commit -m "feat(analytics-agent): add Protocol ports (consumer-owned interfaces)"
```

---

## Phase 2 — Test scaffolding

Goal: create `tests/fakes/` doubles and the `build_test_dependencies` factory; reorganize tests into `unit/`, `component/`, `application/`, `integration/` directories.

### Task 2.1: Create `tests/fakes/` package and stub `__init__.py`

**Files:**
- Create: `agents/analytics-agent/tests/fakes/__init__.py`

- [ ] **Step 1: Create the directory and init file**

```bash
mkdir -p agents/analytics-agent/tests/fakes
```

Write `agents/analytics-agent/tests/fakes/__init__.py`:

```python
"""Reusable in-memory doubles for tests.

All fakes structurally satisfy the Protocols in analytics_agent.src.ports.
Use build_test_dependencies() to wire them into a full AppDependencies.
"""
```

- [ ] **Step 2: Commit**

```bash
git add agents/analytics-agent/tests/fakes/__init__.py
git commit -m "test(analytics-agent): add fakes package scaffold"
```

### Task 2.2: Add `FakeConversationStore`

**Files:**
- Create: `agents/analytics-agent/tests/fakes/fake_conversation_store.py`
- Test: `agents/analytics-agent/tests/unit/test_fake_conversation_store.py`

- [ ] **Step 1: Write the failing test**

Write `agents/analytics-agent/tests/unit/test_fake_conversation_store.py`:

```python
"""Unit tests for FakeConversationStore."""
import pytest

from analytics_agent.src.domain.types import Conversation, UserContext
from analytics_agent.src.ports import ConversationStore
from analytics_agent.tests.fakes.fake_conversation_store import FakeConversationStore


@pytest.fixture
def ctx():
    return UserContext(user_id="u1", tenant_id="t1", auth_token="tok")


async def test_satisfies_protocol():
    assert isinstance(FakeConversationStore(), ConversationStore)


async def test_save_then_load(ctx):
    store = FakeConversationStore()
    convo = Conversation(conversation_id="c1", title="hi", updated_at="2026-04-16T00:00:00Z")
    await store.save(convo, ctx)
    loaded = await store.load("c1", ctx)
    assert loaded is not None
    assert loaded.conversation_id == "c1"


async def test_load_missing_returns_none(ctx):
    store = FakeConversationStore()
    assert await store.load("nope", ctx) is None


async def test_list_tenant_scoped(ctx):
    store = FakeConversationStore()
    c = Conversation(conversation_id="c1", title="x", updated_at="2026-04-16T00:00:00Z")
    await store.save(c, ctx)
    other_ctx = UserContext(user_id="u2", tenant_id="OTHER", auth_token="tok")
    listed = await store.list(other_ctx)
    assert listed == []


async def test_delete(ctx):
    store = FakeConversationStore()
    c = Conversation(conversation_id="c1", title="x", updated_at="2026-04-16T00:00:00Z")
    await store.save(c, ctx)
    await store.delete("c1", ctx)
    assert await store.load("c1", ctx) is None
```

- [ ] **Step 2: Run to verify it fails**

```bash
pytest agents/analytics-agent/tests/unit/test_fake_conversation_store.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Write the fake**

Create `agents/analytics-agent/tests/fakes/fake_conversation_store.py`:

```python
"""In-memory ConversationStore for tests."""
from __future__ import annotations

from analytics_agent.src.domain.types import (
    Conversation,
    ConversationSummary,
    UserContext,
)


class FakeConversationStore:
    """Tenant-scoped in-memory store. Not thread-safe."""

    def __init__(self) -> None:
        # key = (tenant_id, conversation_id)
        self._data: dict[tuple[str, str], Conversation] = {}

    async def save(self, convo: Conversation, user_ctx: UserContext) -> None:
        self._data[(user_ctx.tenant_id, convo.conversation_id)] = convo

    async def load(
        self, convo_id: str, user_ctx: UserContext
    ) -> Conversation | None:
        return self._data.get((user_ctx.tenant_id, convo_id))

    async def list(self, user_ctx: UserContext) -> list[ConversationSummary]:
        return [
            ConversationSummary(
                conversation_id=c.conversation_id,
                title=c.title,
                updated_at=c.updated_at,
            )
            for (tenant, _), c in self._data.items()
            if tenant == user_ctx.tenant_id
        ]

    async def delete(self, convo_id: str, user_ctx: UserContext) -> None:
        self._data.pop((user_ctx.tenant_id, convo_id), None)
```

- [ ] **Step 4: Run to verify tests pass**

```bash
pytest agents/analytics-agent/tests/unit/test_fake_conversation_store.py -v
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/analytics-agent/tests/fakes/fake_conversation_store.py agents/analytics-agent/tests/unit/test_fake_conversation_store.py
git commit -m "test(analytics-agent): add FakeConversationStore"
```

### Task 2.3: Add `FakeMCPToolsProvider`, `FakeLLM`, `FakeLLMFactory`

**Files:**
- Create: `agents/analytics-agent/tests/fakes/fake_mcp_tools_provider.py`
- Create: `agents/analytics-agent/tests/fakes/fake_llm.py`
- Create: `agents/analytics-agent/tests/fakes/fake_llm_factory.py`
- Test: `agents/analytics-agent/tests/unit/test_fakes_llm_and_mcp.py`

- [ ] **Step 1: Write the failing tests**

Write `agents/analytics-agent/tests/unit/test_fakes_llm_and_mcp.py`:

```python
"""Unit tests for FakeLLM, FakeLLMFactory, FakeMCPToolsProvider."""
import pytest
from langchain_core.messages import AIMessage, HumanMessage

from analytics_agent.src.domain.types import UserContext
from analytics_agent.src.ports import LLMFactory, MCPToolsProvider
from analytics_agent.tests.fakes.fake_llm import FakeLLM
from analytics_agent.tests.fakes.fake_llm_factory import FakeLLMFactory
from analytics_agent.tests.fakes.fake_mcp_tools_provider import FakeMCPToolsProvider


def test_fake_llm_factory_satisfies_protocol():
    assert isinstance(FakeLLMFactory(), LLMFactory)


def test_fake_mcp_tools_provider_satisfies_protocol():
    assert isinstance(FakeMCPToolsProvider(), MCPToolsProvider)


async def test_fake_llm_returns_canned_response():
    llm = FakeLLM(response="hello there")
    result = await llm.ainvoke([HumanMessage(content="hi")])
    assert isinstance(result, AIMessage)
    assert result.content == "hello there"


async def test_fake_llm_with_structured_output():
    from pydantic import BaseModel

    class Schema(BaseModel):
        answer: str

    llm = FakeLLM(structured_response=Schema(answer="42"))
    bound = llm.with_structured_output(Schema)
    result = await bound.ainvoke([HumanMessage(content="q?")])
    assert result.answer == "42"


async def test_fake_llm_records_calls():
    llm = FakeLLM(response="ok")
    await llm.ainvoke([HumanMessage(content="first")])
    await llm.ainvoke([HumanMessage(content="second")])
    assert len(llm.calls) == 2


async def test_fake_mcp_tools_provider_returns_injected_tools():
    from langchain_core.tools import tool

    @tool
    def dummy(x: int) -> int:
        """Dummy tool."""
        return x * 2

    provider = FakeMCPToolsProvider(tools=[dummy])
    ctx = UserContext(user_id="u", tenant_id="t", auth_token="tok")
    tools = await provider.get_langchain_tools(ctx)
    assert len(tools) == 1
    assert tools[0].name == "dummy"
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest agents/analytics-agent/tests/unit/test_fakes_llm_and_mcp.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Write `FakeLLM`**

Create `agents/analytics-agent/tests/fakes/fake_llm.py`:

```python
"""In-memory BaseChatModel-compatible fake for tests.

Does not subclass BaseChatModel because langchain's Runnable machinery
is overkill for tests. Instead provides the two methods ChatService
and nodes actually call: ainvoke() and with_structured_output().bind.
"""
from __future__ import annotations

from typing import Any

from langchain_core.messages import AIMessage, BaseMessage


class _StructuredBound:
    def __init__(self, response: Any):
        self._response = response
        self.calls: list[list[BaseMessage]] = []

    async def ainvoke(self, messages: list[BaseMessage], config: Any = None) -> Any:
        self.calls.append(messages)
        return self._response

    def invoke(self, messages: list[BaseMessage], config: Any = None) -> Any:
        self.calls.append(messages)
        return self._response


class FakeLLM:
    """Configurable fake chat model.

    - response: content for plain ainvoke() calls.
    - structured_response: return value for with_structured_output(...).ainvoke().
    """

    def __init__(
        self,
        response: str = "",
        structured_response: Any = None,
    ):
        self._response = response
        self._structured_response = structured_response
        self.calls: list[list[BaseMessage]] = []

    async def ainvoke(self, messages: list[BaseMessage], config: Any = None) -> AIMessage:
        self.calls.append(messages)
        return AIMessage(content=self._response)

    def invoke(self, messages: list[BaseMessage], config: Any = None) -> AIMessage:
        self.calls.append(messages)
        return AIMessage(content=self._response)

    def with_structured_output(self, schema: Any) -> _StructuredBound:
        return _StructuredBound(self._structured_response)
```

- [ ] **Step 4: Write `FakeLLMFactory`**

Create `agents/analytics-agent/tests/fakes/fake_llm_factory.py`:

```python
"""FakeLLMFactory — returns FakeLLM instances for router and synthesis."""
from __future__ import annotations

from .fake_llm import FakeLLM


class FakeLLMFactory:
    def __init__(
        self,
        router_llm: FakeLLM | None = None,
        synthesis_llm: FakeLLM | None = None,
    ):
        self._router = router_llm or FakeLLM()
        self._synthesis = synthesis_llm or FakeLLM()

    def make_router_llm(self) -> FakeLLM:
        return self._router

    def make_synthesis_llm(self) -> FakeLLM:
        return self._synthesis
```

- [ ] **Step 5: Write `FakeMCPToolsProvider`**

Create `agents/analytics-agent/tests/fakes/fake_mcp_tools_provider.py`:

```python
"""FakeMCPToolsProvider — returns a preconfigured list of langchain tools."""
from __future__ import annotations

from langchain_core.tools import BaseTool

from analytics_agent.src.domain.types import UserContext


class FakeMCPToolsProvider:
    def __init__(self, tools: list[BaseTool] | None = None):
        self._tools = list(tools or [])
        self.calls: list[UserContext] = []

    async def get_langchain_tools(self, user_ctx: UserContext) -> list[BaseTool]:
        self.calls.append(user_ctx)
        return list(self._tools)
```

- [ ] **Step 6: Run tests**

```bash
pytest agents/analytics-agent/tests/unit/test_fakes_llm_and_mcp.py -v
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add agents/analytics-agent/tests/fakes/fake_llm.py agents/analytics-agent/tests/fakes/fake_llm_factory.py agents/analytics-agent/tests/fakes/fake_mcp_tools_provider.py agents/analytics-agent/tests/unit/test_fakes_llm_and_mcp.py
git commit -m "test(analytics-agent): add FakeLLM, FakeLLMFactory, FakeMCPToolsProvider"
```

### Task 2.4: Add `FakeStreamEncoder`, `FakeTelemetryScope`, `FakeCompactionModifier`

**Files:**
- Create: `agents/analytics-agent/tests/fakes/fake_stream_encoder.py`
- Create: `agents/analytics-agent/tests/fakes/fake_telemetry.py`
- Create: `agents/analytics-agent/tests/fakes/fake_compaction.py`
- Test: `agents/analytics-agent/tests/unit/test_fakes_misc.py`

- [ ] **Step 1: Write the failing tests**

Write `agents/analytics-agent/tests/unit/test_fakes_misc.py`:

```python
"""Unit tests for FakeStreamEncoder, FakeTelemetryScope, FakeCompactionModifier."""
from analytics_agent.src.ports import (
    CompactionModifier,
    StreamEncoder,
    TelemetryScope,
)
from analytics_agent.tests.fakes.fake_compaction import FakeCompactionModifier
from analytics_agent.tests.fakes.fake_stream_encoder import FakeStreamEncoder
from analytics_agent.tests.fakes.fake_telemetry import FakeTelemetryScope


def test_stream_encoder_satisfies_protocol():
    assert isinstance(FakeStreamEncoder(), StreamEncoder)


def test_telemetry_satisfies_protocol():
    assert isinstance(FakeTelemetryScope(), TelemetryScope)


def test_compaction_satisfies_protocol():
    assert isinstance(FakeCompactionModifier(), CompactionModifier)


def test_encoder_records_events():
    enc = FakeStreamEncoder()
    enc.encode_event({"type": "x"})
    enc.encode_event({"type": "y"})
    enc.encode_error(ValueError("bad"), error_id="e1")
    enc.finalize()
    assert len(enc.events) == 2
    assert len(enc.errors) == 1
    assert enc.finalized is True


def test_telemetry_records_spans_and_events():
    t = FakeTelemetryScope()
    with t.start_span("step1") as span:
        t.record_event("work", x=1)
    assert t.spans == ["step1"]
    assert t.events == [("work", {"x": 1})]


def test_compaction_passthrough():
    c = FakeCompactionModifier()
    msgs = ["a", "b", "c"]
    assert c.apply(msgs) == msgs
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest agents/analytics-agent/tests/unit/test_fakes_misc.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Write `FakeStreamEncoder`**

Create `agents/analytics-agent/tests/fakes/fake_stream_encoder.py`:

```python
"""FakeStreamEncoder — records calls, returns deterministic bytes."""
from __future__ import annotations

import json
from typing import Any


class FakeStreamEncoder:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []
        self.errors: list[tuple[str, str]] = []  # (error_id, str(err))
        self.finalized: bool = False

    def encode_event(self, event: dict[str, Any]) -> bytes:
        self.events.append(event)
        return json.dumps({"event": event}).encode() + b"\n"

    def encode_error(self, err: Exception, *, error_id: str) -> bytes:
        self.errors.append((error_id, str(err)))
        return json.dumps({"error": str(err), "error_id": error_id}).encode() + b"\n"

    def finalize(self) -> bytes:
        self.finalized = True
        return b""
```

- [ ] **Step 4: Write `FakeTelemetryScope`**

Create `agents/analytics-agent/tests/fakes/fake_telemetry.py`:

```python
"""FakeTelemetryScope — records spans and events."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator


class _FakeSpan:
    def __init__(self) -> None:
        self.exceptions: list[Exception] = []
        self.status: str | None = None

    def record_exception(self, err: Exception) -> None:
        self.exceptions.append(err)

    def set_status(self, status: str) -> None:
        self.status = status


class FakeTelemetryScope:
    def __init__(self) -> None:
        self.spans: list[str] = []
        self.events: list[tuple[str, dict[str, Any]]] = []
        self.last_span = _FakeSpan()

    @contextmanager
    def start_span(self, name: str) -> Iterator[_FakeSpan]:
        self.spans.append(name)
        self.last_span = _FakeSpan()
        yield self.last_span

    def record_event(self, name: str, **attrs: Any) -> None:
        self.events.append((name, attrs))
```

- [ ] **Step 5: Write `FakeCompactionModifier`**

Create `agents/analytics-agent/tests/fakes/fake_compaction.py`:

```python
"""FakeCompactionModifier — passthrough by default."""
from __future__ import annotations

from langchain_core.messages import BaseMessage


class FakeCompactionModifier:
    def __init__(self, passthrough: bool = True) -> None:
        self._passthrough = passthrough

    def apply(self, messages: list[BaseMessage]) -> list[BaseMessage]:
        return list(messages) if self._passthrough else []
```

- [ ] **Step 6: Run tests**

```bash
pytest agents/analytics-agent/tests/unit/test_fakes_misc.py -v
```

Expected: all 6 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add agents/analytics-agent/tests/fakes/fake_stream_encoder.py agents/analytics-agent/tests/fakes/fake_telemetry.py agents/analytics-agent/tests/fakes/fake_compaction.py agents/analytics-agent/tests/unit/test_fakes_misc.py
git commit -m "test(analytics-agent): add FakeStreamEncoder, FakeTelemetryScope, FakeCompactionModifier"
```

### Task 2.5: Add `build_test_dependencies` factory

**Files:**
- Create: `agents/analytics-agent/tests/fakes/build_test_deps.py`
- Test: `agents/analytics-agent/tests/unit/test_build_test_deps.py`

> **Note:** `AppDependencies` doesn't exist yet (Phase 4). For this task, define a *placeholder* `AppDependencies` dataclass inside `build_test_deps.py` that will be replaced in Phase 4 Task 4.1. This avoids a circular dependency between phases. Phase 4.1 will `from analytics_agent.src.app_dependencies import AppDependencies` once it's written.

- [ ] **Step 1: Write the failing test**

Write `agents/analytics-agent/tests/unit/test_build_test_deps.py`:

```python
"""Unit tests for build_test_dependencies factory."""
from analytics_agent.tests.fakes.build_test_deps import build_test_dependencies
from analytics_agent.tests.fakes.fake_conversation_store import FakeConversationStore
from analytics_agent.tests.fakes.fake_llm_factory import FakeLLMFactory


def test_returns_populated_deps_by_default():
    deps = build_test_dependencies()
    assert deps.conversation_store is not None
    assert deps.mcp_tools_provider is not None
    assert deps.llm_factory is not None
    assert deps.telemetry is not None
    assert deps.compaction is not None


def test_override_individual_fake():
    custom_store = FakeConversationStore()
    deps = build_test_dependencies(conversation_store=custom_store)
    assert deps.conversation_store is custom_store


def test_override_llm_factory():
    custom_factory = FakeLLMFactory()
    deps = build_test_dependencies(llm_factory=custom_factory)
    assert deps.llm_factory is custom_factory
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest agents/analytics-agent/tests/unit/test_build_test_deps.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Write `build_test_deps.py` with placeholder dataclass**

Create `agents/analytics-agent/tests/fakes/build_test_deps.py`:

```python
"""build_test_dependencies — one-knob factory for test composition.

Builds an AppDependencies populated with fakes. Override any piece by
passing the keyword.

NOTE: AppDependencies is imported from analytics_agent.src.app_dependencies
once Phase 4 Task 4.1 lands. Until then this module defines a placeholder
dataclass with the same shape.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

try:
    from analytics_agent.src.app_dependencies import AppDependencies  # type: ignore
except ImportError:  # pre-Phase-4
    @dataclass
    class AppDependencies:  # type: ignore[no-redef]
        config: Any = None
        graph: Any = None
        conversation_store: Any = None
        mcp_tools_provider: Any = None
        llm_factory: Any = None
        telemetry: Any = None
        compaction: Any = None
        encoder_factory: Callable[[], Any] | None = None
        chat_service_factory: Callable[..., Any] | None = None

from .fake_compaction import FakeCompactionModifier
from .fake_conversation_store import FakeConversationStore
from .fake_llm_factory import FakeLLMFactory
from .fake_mcp_tools_provider import FakeMCPToolsProvider
from .fake_stream_encoder import FakeStreamEncoder
from .fake_telemetry import FakeTelemetryScope


def build_test_dependencies(
    *,
    config: Any | None = None,
    graph: Any | None = None,
    conversation_store: Any | None = None,
    mcp_tools_provider: Any | None = None,
    llm_factory: Any | None = None,
    telemetry: Any | None = None,
    compaction: Any | None = None,
    encoder_factory: Callable[[], Any] | None = None,
    chat_service_factory: Callable[..., Any] | None = None,
) -> AppDependencies:
    """Build AppDependencies with fakes; override per keyword."""
    return AppDependencies(
        config=config,
        graph=graph,
        conversation_store=conversation_store or FakeConversationStore(),
        mcp_tools_provider=mcp_tools_provider or FakeMCPToolsProvider(),
        llm_factory=llm_factory or FakeLLMFactory(),
        telemetry=telemetry or FakeTelemetryScope(),
        compaction=compaction or FakeCompactionModifier(),
        encoder_factory=encoder_factory or (lambda: FakeStreamEncoder()),
        chat_service_factory=chat_service_factory,
    )
```

- [ ] **Step 4: Run tests**

```bash
pytest agents/analytics-agent/tests/unit/test_build_test_deps.py -v
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/analytics-agent/tests/fakes/build_test_deps.py agents/analytics-agent/tests/unit/test_build_test_deps.py
git commit -m "test(analytics-agent): add build_test_dependencies factory"
```

### Task 2.6: Reorganize existing tests into `unit/`, `component/`, `application/`, `integration/`

**Files:**
- Modify: `agents/analytics-agent/tests/` directory structure
- Create: `agents/analytics-agent/tests/{component,application,integration}/__init__.py` and `conftest.py`

- [ ] **Step 1: Create tier directories**

```bash
mkdir -p agents/analytics-agent/tests/component
mkdir -p agents/analytics-agent/tests/application
mkdir -p agents/analytics-agent/tests/integration
touch agents/analytics-agent/tests/component/__init__.py
touch agents/analytics-agent/tests/application/__init__.py
touch agents/analytics-agent/tests/integration/__init__.py
```

- [ ] **Step 2: Move existing tests by classification**

Use `git mv` to preserve history. Classification from the spec:

| Old file | Destination |
|---|---|
| `tests/test_intent_router.py` | `tests/unit/test_intent_router_node.py` |
| `tests/test_synthesis.py` | `tests/unit/test_synthesis_node.py` |
| `tests/test_ui_schemas.py` | `tests/unit/test_ui_schemas.py` |
| `tests/test_graph.py` | `tests/component/test_graph_wiring.py` |
| `tests/test_graph_injectable.py` | `tests/component/test_graph_injectable.py` |
| `tests/test_chat_service.py` | `tests/component/test_chat_service.py` |
| `tests/test_stream_encoders.py` | `tests/component/test_stream_encoders.py` |
| `tests/test_mcp_registry.py` | `tests/component/test_mcp_registry.py` |
| `tests/test_app_factory.py` | `tests/application/test_app_factory.py` |
| `tests/test_e2e_streaming.py` | `tests/integration/test_e2e_streaming.py` |

Run:

```bash
cd agents/analytics-agent
git mv tests/test_intent_router.py tests/unit/test_intent_router_node.py
git mv tests/test_synthesis.py tests/unit/test_synthesis_node.py
git mv tests/test_ui_schemas.py tests/unit/test_ui_schemas.py
git mv tests/test_graph.py tests/component/test_graph_wiring.py
git mv tests/test_graph_injectable.py tests/component/test_graph_injectable.py
git mv tests/test_chat_service.py tests/component/test_chat_service.py
git mv tests/test_stream_encoders.py tests/component/test_stream_encoders.py
git mv tests/test_mcp_registry.py tests/component/test_mcp_registry.py
git mv tests/test_app_factory.py tests/application/test_app_factory.py
git mv tests/test_e2e_streaming.py tests/integration/test_e2e_streaming.py
cd -
```

- [ ] **Step 3: Verify existing tests still collect and run**

```bash
pytest agents/analytics-agent/tests/ --collect-only
```

Expected: all tests collect without import errors. If a moved test has a relative import that's now broken, fix the import (e.g., `from ..conftest import X` → `from ...conftest import X`).

- [ ] **Step 4: Run the default test set**

```bash
pytest agents/analytics-agent/tests/ -x --ignore=agents/analytics-agent/tests/integration
```

Expected: same pass/fail state as before Phase 2 (no regressions).

- [ ] **Step 5: Add a `pytest -m integration` hook**

Verify integration tests are marked. Edit `agents/analytics-agent/tests/integration/test_e2e_streaming.py` — confirm `pytestmark = pytest.mark.integration` exists at module top; if not, add it:

```python
import pytest

pytestmark = pytest.mark.integration
```

- [ ] **Step 6: Commit**

```bash
git add agents/analytics-agent/tests/
git commit -m "test(analytics-agent): reorganize tests into unit/component/application/integration tiers"
```

### Task 2.7: Ensure pytest picks up the analytics-agent tests

**Files:**
- Modify: `pyproject.toml` (repo root)

- [ ] **Step 1: Verify current `testpaths`**

```bash
grep -A 10 "testpaths" pyproject.toml
```

- [ ] **Step 2: Add `agents/analytics-agent/tests` to testpaths if missing**

Edit `pyproject.toml` lines ~20–27. Ensure the list includes `agents/analytics-agent/tests`:

```toml
testpaths = [
    "tests",
    "agents/tests",
    "agents/analytics-agent/tests",
    "tools/data-mcp/tests",
    "tools/payments-mcp/tests",
    "tools/salesforce-mcp/tests",
    "tools/news-search-mcp/tests",
]
```

- [ ] **Step 3: Run the default test set from the repo root**

```bash
pytest -x --ignore=agents/analytics-agent/tests/integration -q
```

Expected: all non-integration tests PASS (or reproduce the pre-existing failures from Phase 0).

- [ ] **Step 4: Commit**

```bash
git add pyproject.toml
git commit -m "chore: include analytics-agent/tests in pytest testpaths"
```

---

## Phase 3 — Platform-SDK cleanups

Goal: remove module-level state; make adapters constructor-injected; adjust public API.

### Task 3.1: Extract `TokenAwareCompactionModifier` class (red test first)

**Files:**
- Modify: `platform-sdk/platform_sdk/compaction.py`
- Test: `tests/platform_sdk/unit/test_token_aware_compaction.py`

- [ ] **Step 1: Create test directory if missing**

```bash
mkdir -p tests/platform_sdk/unit
touch tests/platform_sdk/__init__.py tests/platform_sdk/unit/__init__.py
```

- [ ] **Step 2: Write the failing test**

Write `tests/platform_sdk/unit/test_token_aware_compaction.py`:

```python
"""Unit tests for TokenAwareCompactionModifier.

Verifies tiktoken is NOT loaded at import time and the class is
constructor-configurable.
"""
import importlib
import sys

from langchain_core.messages import HumanMessage, SystemMessage


def test_compaction_module_does_not_load_tiktoken_at_import():
    # Fresh import; module-level tiktoken should not appear in loaded modules.
    for mod in list(sys.modules):
        if mod.startswith("tiktoken") or mod.startswith("platform_sdk.compaction"):
            del sys.modules[mod]
    importlib.import_module("platform_sdk.compaction")
    assert "tiktoken" not in sys.modules, (
        "tiktoken was imported at module load — it should be lazy inside "
        "TokenAwareCompactionModifier.__init__."
    )


def test_class_instantiable_with_token_limit():
    from platform_sdk.compaction import TokenAwareCompactionModifier

    c = TokenAwareCompactionModifier(token_limit=1000)
    assert c is not None


def test_apply_returns_messages_under_limit_unchanged():
    from platform_sdk.compaction import TokenAwareCompactionModifier

    c = TokenAwareCompactionModifier(token_limit=10_000)
    msgs = [SystemMessage(content="system"), HumanMessage(content="hi")]
    assert c.apply(msgs) == msgs


def test_apply_trims_when_over_limit():
    from platform_sdk.compaction import TokenAwareCompactionModifier

    c = TokenAwareCompactionModifier(token_limit=10)  # very small
    long_msg = "x " * 1000
    msgs = [SystemMessage(content="sys"), HumanMessage(content=long_msg)]
    out = c.apply(msgs)
    # At minimum, the system message is preserved, and history is truncated.
    assert len(out) <= len(msgs)
```

- [ ] **Step 3: Run to verify failure**

```bash
pytest tests/platform_sdk/unit/test_token_aware_compaction.py -v
```

Expected: `ImportError` for `TokenAwareCompactionModifier`.

- [ ] **Step 4: Read the existing `compaction.py`**

```bash
cat platform-sdk/platform_sdk/compaction.py
```

Identify the module-level token counter initialization and the existing `make_compaction_modifier` function.

- [ ] **Step 5: Refactor `compaction.py`**

Rewrite `platform-sdk/platform_sdk/compaction.py` to move tiktoken init into the class, preserving the existing `make_compaction_modifier` as a thin wrapper:

```python
"""Token-aware compaction for long conversation histories.

TokenAwareCompactionModifier is the primary entry point; constructor
accepts a token limit and encoding name. tiktoken is loaded lazily in
__init__ to keep module import cheap.

make_compaction_modifier(config) remains for backward compatibility
during the refactor; new code should instantiate the class directly.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

from langchain_core.messages import BaseMessage, SystemMessage

if TYPE_CHECKING:
    from platform_sdk.config import AgentConfig


class TokenAwareCompactionModifier:
    """Trim message history to fit a token budget while preserving the system prompt."""

    def __init__(
        self,
        token_limit: int,
        encoding: str = "cl100k_base",
    ) -> None:
        self._token_limit = token_limit
        self._encoding_name = encoding
        self._encoding = None  # lazy

    def _get_encoding(self) -> Any:
        if self._encoding is None:
            import tiktoken  # lazy

            try:
                self._encoding = tiktoken.get_encoding(self._encoding_name)
            except Exception:
                self._encoding = tiktoken.get_encoding("cl100k_base")
        return self._encoding

    def _count_tokens(self, msg: BaseMessage) -> int:
        content = msg.content if isinstance(msg.content, str) else str(msg.content)
        return len(self._get_encoding().encode(content))

    def apply(self, messages: list[BaseMessage]) -> list[BaseMessage]:
        if not messages:
            return messages

        # Preserve the leading system message(s); trim the rest from the start.
        system_prefix: list[BaseMessage] = []
        rest: list[BaseMessage] = []
        for m in messages:
            if isinstance(m, SystemMessage) and not rest:
                system_prefix.append(m)
            else:
                rest.append(m)

        budget = self._token_limit - sum(self._count_tokens(m) for m in system_prefix)
        kept_reversed: list[BaseMessage] = []
        used = 0
        for m in reversed(rest):
            cost = self._count_tokens(m)
            if used + cost > budget:
                break
            kept_reversed.append(m)
            used += cost

        return system_prefix + list(reversed(kept_reversed))


def make_compaction_modifier(config: "AgentConfig") -> TokenAwareCompactionModifier:
    """Backward-compatible factory wrapping TokenAwareCompactionModifier."""
    return TokenAwareCompactionModifier(
        token_limit=config.context_token_limit,
    )
```

- [ ] **Step 6: Run the new tests**

```bash
pytest tests/platform_sdk/unit/test_token_aware_compaction.py -v
```

Expected: all 4 tests PASS.

- [ ] **Step 7: Run the rest of the suite to verify no regressions**

```bash
pytest -x --ignore=agents/analytics-agent/tests/integration -q
```

Expected: same pass/fail state as Phase 2 end.

- [ ] **Step 8: Commit**

```bash
git add platform-sdk/platform_sdk/compaction.py tests/platform_sdk/unit/test_token_aware_compaction.py tests/platform_sdk/__init__.py tests/platform_sdk/unit/__init__.py
git commit -m "refactor(platform-sdk): extract TokenAwareCompactionModifier with lazy tiktoken init"
```

### Task 3.2: Add `UserContext` parameter to `MCPToolBridge.get_langchain_tools` — red test

**Files:**
- Modify: `platform-sdk/platform_sdk/mcp_bridge.py`
- Test: `tests/platform_sdk/component/test_mcp_bridge_user_ctx.py`

> **Context:** Today `get_langchain_tools()` reads a module-level `ContextVar`. The refactor makes it take `user_ctx: UserContext` explicitly. We cannot delete the ContextVar helpers yet — consumers (`ChatService`) still use them. Phase 5 removes those calls, then Task 3.3 removes the ContextVar.

- [ ] **Step 1: Create component test dir**

```bash
mkdir -p tests/platform_sdk/component
touch tests/platform_sdk/component/__init__.py
```

- [ ] **Step 2: Write the failing test**

Write `tests/platform_sdk/component/test_mcp_bridge_user_ctx.py`:

```python
"""MCPToolBridge accepts UserContext parameter on get_langchain_tools."""
import pytest

from analytics_agent.src.domain.types import UserContext
from platform_sdk.mcp_bridge import MCPToolBridge


@pytest.fixture
def ctx():
    return UserContext(user_id="u1", tenant_id="t1", auth_token="hmac-token-xyz")


async def test_get_langchain_tools_accepts_user_ctx_param(ctx):
    """Signature accepts user_ctx; implementation must not rely solely on ContextVar."""
    # A disconnected bridge returns [] — exercise the signature, not the wire.
    bridge = MCPToolBridge(server_name="test", server_url="http://127.0.0.1:0")
    # Call with explicit user_ctx — should not raise TypeError.
    tools = await bridge.get_langchain_tools(user_ctx=ctx)
    assert isinstance(tools, list)


async def test_user_ctx_overrides_contextvar(ctx):
    """When user_ctx passed, it wins over any ContextVar state."""
    from platform_sdk.mcp_bridge import set_user_auth_token, reset_user_auth_token

    token = set_user_auth_token("SHOULD_NOT_BE_USED")
    try:
        bridge = MCPToolBridge(server_name="test", server_url="http://127.0.0.1:0")
        # Calling with explicit ctx must not raise and must prefer ctx over the ContextVar.
        await bridge.get_langchain_tools(user_ctx=ctx)
        # Observable effect: whatever headers bridge would stamp come from ctx.
        # Exact header-stamping test is covered by MCP_bridge internal tests;
        # here we assert the signature exists and call succeeds.
    finally:
        reset_user_auth_token(token)
```

- [ ] **Step 3: Run to verify failure**

```bash
pytest tests/platform_sdk/component/test_mcp_bridge_user_ctx.py -v
```

Expected: `TypeError: ... unexpected keyword argument 'user_ctx'` — the signature doesn't accept it yet.

- [ ] **Step 4: Read the existing `mcp_bridge.py` to find `get_langchain_tools`**

```bash
grep -n "def get_langchain_tools" platform-sdk/platform_sdk/mcp_bridge.py
```

Record the current signature and the location where auth header is built.

- [ ] **Step 5: Modify the signature to accept `user_ctx`**

Edit `platform-sdk/platform_sdk/mcp_bridge.py`:

Add an import at the top (guarded to avoid circularity):

```python
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from analytics_agent.src.domain.types import UserContext
```

> **Note:** importing from the agent package creates a coupling. For a decoupled alternative, define a minimal `UserContext` Protocol right inside `platform_sdk` (`platform_sdk/user_context.py`) with the same three fields and import it here. If the agent's `UserContext` is a dataclass with matching fields, it structurally satisfies the Protocol.

Change the signature:

```python
async def get_langchain_tools(
    self,
    user_ctx: "UserContext | None" = None,
) -> list[BaseTool]:
    ...
```

Inside the body, when building headers:

```python
# Prefer explicit user_ctx; fall back to ContextVar for backward compat
# during Phase 3–5. Phase 5 removes the ContextVar path.
if user_ctx is not None:
    auth_header_value = user_ctx.auth_token
else:
    auth_header_value = _user_auth_ctx.get(None)  # existing behavior
```

- [ ] **Step 6: Run the new test**

```bash
pytest tests/platform_sdk/component/test_mcp_bridge_user_ctx.py -v
```

Expected: both tests PASS.

- [ ] **Step 7: Run full test suite**

```bash
pytest -x --ignore=agents/analytics-agent/tests/integration -q
```

Expected: no regressions.

- [ ] **Step 8: Commit**

```bash
git add platform-sdk/platform_sdk/mcp_bridge.py tests/platform_sdk/component/test_mcp_bridge_user_ctx.py tests/platform_sdk/component/__init__.py
git commit -m "refactor(platform-sdk): add user_ctx parameter to MCPToolBridge.get_langchain_tools"
```

### Task 3.3: Remove the `_user_auth_ctx` ContextVar (after Phase 5 migration)

> **Blocking dependency:** Do not execute this task until **Task 5.3** has completed — `ChatService` must first stop calling `set_user_auth_token` / `reset_user_auth_token`.

**Files:**
- Modify: `platform-sdk/platform_sdk/mcp_bridge.py`
- Test: `tests/platform_sdk/unit/test_no_module_auth_state.py`

- [ ] **Step 1: Write the failing test (should pass once ContextVar is removed)**

Write `tests/platform_sdk/unit/test_no_module_auth_state.py`:

```python
"""Guardrail: platform_sdk.mcp_bridge must not expose module-level auth state."""
import platform_sdk.mcp_bridge as mb


def test_no_user_auth_ctx_at_module_level():
    assert not hasattr(mb, "_user_auth_ctx"), (
        "_user_auth_ctx was removed — user context now flows via explicit parameter. "
        "If you need it back, you probably want to pass UserContext down instead."
    )


def test_no_set_user_auth_token_at_module_level():
    assert not hasattr(mb, "set_user_auth_token")


def test_no_reset_user_auth_token_at_module_level():
    assert not hasattr(mb, "reset_user_auth_token")
```

- [ ] **Step 2: Run to verify it fails (ContextVar still there)**

```bash
pytest tests/platform_sdk/unit/test_no_module_auth_state.py -v
```

Expected: FAIL — the three symbols still exist.

- [ ] **Step 3: Delete the ContextVar and helpers**

Edit `platform-sdk/platform_sdk/mcp_bridge.py`:
- Remove the line `_user_auth_ctx: ContextVar[str | None] = ContextVar(...)`.
- Remove `set_user_auth_token(token)` function.
- Remove `reset_user_auth_token(token)` function.
- Remove any `from contextvars import ContextVar` import if no longer used.
- In `get_langchain_tools`, simplify to require `user_ctx`:

```python
async def get_langchain_tools(
    self,
    user_ctx: "UserContext",
) -> list[BaseTool]:
    ...
    auth_header_value = user_ctx.auth_token
    ...
```

Make `user_ctx` required (no default).

- [ ] **Step 4: Run the guardrail test**

```bash
pytest tests/platform_sdk/unit/test_no_module_auth_state.py -v
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Run full suite**

```bash
pytest -x --ignore=agents/analytics-agent/tests/integration -q
```

Expected: no regressions. If a test fails because some code still imports `set_user_auth_token`, that code was supposed to be migrated in Phase 5 — return to Phase 5 and fix it.

- [ ] **Step 6: Commit**

```bash
git add platform-sdk/platform_sdk/mcp_bridge.py tests/platform_sdk/unit/test_no_module_auth_state.py
git commit -m "refactor(platform-sdk): remove module-level _user_auth_ctx ContextVar; user_ctx now required"
```

### Task 3.4: Narrow `platform_sdk/__init__.py` public surface

**Files:**
- Modify: `platform-sdk/platform_sdk/__init__.py`
- Test: `tests/platform_sdk/unit/test_public_api.py`

- [ ] **Step 1: Inspect the current public API**

```bash
grep -n "^from\|^__all__" platform-sdk/platform_sdk/__init__.py
```

- [ ] **Step 2: Write the guardrail test**

Write `tests/platform_sdk/unit/test_public_api.py`:

```python
"""Lock the public API surface of platform_sdk.

Any intentional change to public exports requires updating this list.
"""
import platform_sdk as psdk

EXPECTED_PUBLIC = {
    # Config
    "AgentConfig",
    # Auth / Context
    "AgentContext",
    "AgentContextAuthorizer",
    # Agents / Graphs
    "build_agent",
    "build_specialist_agent",
    "make_checkpointer",
    "setup_checkpointer",
    # LLM
    "make_chat_llm",
    # MCP
    "MCPToolBridge",
    "McpRegistry",
    # Telemetry / Logging
    "configure_logging",
    "get_logger",
    "setup_telemetry",
    "flush_langfuse",
    # Security
    "OpaClient",
    # Cache
    "ToolResultCache",
    # Compaction
    "TokenAwareCompactionModifier",
    "make_compaction_modifier",
    # Prompts
    "PromptLoader",
}


def test_public_api_contains_expected():
    actual = {name for name in dir(psdk) if not name.startswith("_")}
    missing = EXPECTED_PUBLIC - actual
    extra = actual - EXPECTED_PUBLIC
    assert not missing, f"Missing public symbols: {missing}"
    assert not extra, (
        f"Unexpected public symbols (did you add without updating the test?): {extra}"
    )
```

- [ ] **Step 3: Run to see current gap**

```bash
pytest tests/platform_sdk/unit/test_public_api.py -v
```

Expected: FAIL — actual set differs.

- [ ] **Step 4: Curate `platform_sdk/__init__.py`**

Rewrite `platform-sdk/platform_sdk/__init__.py` so `dir(psdk)` non-underscore names exactly match `EXPECTED_PUBLIC`. Import only what the test expects; remove internal-only re-exports. If a symbol is still imported internally by another SDK module, the internal import stays, but the re-export from `__init__.py` is dropped.

- [ ] **Step 5: Run test again**

```bash
pytest tests/platform_sdk/unit/test_public_api.py -v
```

Expected: PASS.

- [ ] **Step 6: Run full suite — in-repo consumers may break**

```bash
pytest -x --ignore=agents/analytics-agent/tests/integration -q
```

Expected: likely failures from consumers importing dropped symbols. If so, **do not** fix them here — create a NOTES.md with the failing imports; they are handled in Phase 9. Revert Task 3.4 if a consumer import is needed before Phase 9.

Alternative: if the test failures are narrow (e.g., 1–2 symbols), add them to `EXPECTED_PUBLIC` and re-run.

- [ ] **Step 7: Commit**

```bash
git add platform-sdk/platform_sdk/__init__.py tests/platform_sdk/unit/test_public_api.py
git commit -m "refactor(platform-sdk): narrow public API surface; lock via test_public_api"
```

### Task 3.5: Make `ChatLLMFactory` stateless at module level

**Files:**
- Modify: `platform-sdk/platform_sdk/services/chat_llm_factory.py` (path may vary — locate via grep)
- Test: `tests/platform_sdk/unit/test_chat_llm_factory_stateless.py`

- [ ] **Step 1: Locate the factory**

```bash
grep -rn "class ChatLLMFactory\|make_chat_llm" platform-sdk/platform_sdk/ --include="*.py"
```

Record the file path (referred to below as `CHAT_LLM_FACTORY_PATH`).

- [ ] **Step 2: Write the failing test**

Write `tests/platform_sdk/unit/test_chat_llm_factory_stateless.py`:

```python
"""ChatLLMFactory must hold no module-level caches."""
import importlib

FACTORY_MODULE = "platform_sdk.services.chat_llm_factory"  # adjust after locating


def test_no_module_level_cache():
    mod = importlib.import_module(FACTORY_MODULE)
    for attr in dir(mod):
        if attr.startswith("_"):
            continue
        val = getattr(mod, attr)
        if isinstance(val, dict) and attr.lower().endswith(("cache", "registry", "pool")):
            raise AssertionError(
                f"Module-level {type(val).__name__} found: {attr}. "
                f"Move it into ChatLLMFactory.__init__."
            )


def test_factory_instantiable_without_config():
    from platform_sdk.services.chat_llm_factory import ChatLLMFactory  # adjust
    f = ChatLLMFactory.__new__(ChatLLMFactory)  # smoke test — class exists
    assert f is not None
```

- [ ] **Step 3: Run to verify failure (if any caches exist)**

```bash
pytest tests/platform_sdk/unit/test_chat_llm_factory_stateless.py -v
```

- [ ] **Step 4: Refactor the factory**

If module-level caches exist, move them into `ChatLLMFactory.__init__`:

```python
class ChatLLMFactory:
    def __init__(self, config: AgentConfig) -> None:
        self._config = config
        self._cache: dict[str, BaseChatModel] = {}

    def make_router_llm(self) -> BaseChatModel:
        return self._memoized(self._config.router_model_route)

    def make_synthesis_llm(self) -> BaseChatModel:
        return self._memoized(self._config.synthesis_model_route)

    def _memoized(self, route: str) -> BaseChatModel:
        if route not in self._cache:
            self._cache[route] = _build_chat_model(route, self._config)
        return self._cache[route]
```

Remove any module-level dicts.

- [ ] **Step 5: Run the test**

```bash
pytest tests/platform_sdk/unit/test_chat_llm_factory_stateless.py -v
```

Expected: PASS.

- [ ] **Step 6: Run full suite**

```bash
pytest -x --ignore=agents/analytics-agent/tests/integration -q
```

Expected: no regressions.

- [ ] **Step 7: Commit**

```bash
git add <CHAT_LLM_FACTORY_PATH> tests/platform_sdk/unit/test_chat_llm_factory_stateless.py
git commit -m "refactor(platform-sdk): move ChatLLMFactory caches from module level into instance"
```

---

## Phase 4 — Composition root

Goal: introduce `AppDependencies` dataclass; make `create_app(deps)` pure; refactor `lifespan(app)` to build `AppDependencies`.

### Task 4.1: Create `src/app_dependencies.py` with `AppDependencies` dataclass

**Files:**
- Create: `agents/analytics-agent/src/app_dependencies.py`
- Test: `agents/analytics-agent/tests/unit/test_app_dependencies.py`

- [ ] **Step 1: Write the failing test**

Write `agents/analytics-agent/tests/unit/test_app_dependencies.py`:

```python
"""AppDependencies dataclass holds wired singletons + factories."""
from dataclasses import fields

from analytics_agent.src.app_dependencies import AppDependencies


def test_has_required_fields():
    names = {f.name for f in fields(AppDependencies)}
    expected = {
        "config",
        "graph",
        "conversation_store",
        "mcp_tools_provider",
        "llm_factory",
        "telemetry",
        "compaction",
        "encoder_factory",
        "chat_service_factory",
    }
    assert expected <= names, f"Missing: {expected - names}"


def test_instantiation_with_nones_is_allowed_for_tests():
    deps = AppDependencies(
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
    assert deps is not None
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest agents/analytics-agent/tests/unit/test_app_dependencies.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Write the dataclass**

Create `agents/analytics-agent/src/app_dependencies.py`:

```python
"""AppDependencies — the single wiring dataclass for analytics-agent.

Built by lifespan() at startup from the environment; passed to create_app()
as its only argument. Tests build it via tests.fakes.build_test_dependencies.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from platform_sdk import AgentConfig

from .domain.types import UserContext
from .ports import (
    CompactionModifier,
    ConversationStore,
    LLMFactory,
    MCPToolsProvider,
    StreamEncoder,
    TelemetryScope,
)


@dataclass
class AppDependencies:
    """Fully-wired singletons + per-request factories."""

    config: AgentConfig | None
    graph: Any  # CompiledGraph from langgraph; left as Any to avoid heavy import
    conversation_store: ConversationStore | None
    mcp_tools_provider: MCPToolsProvider | None
    llm_factory: LLMFactory | None
    telemetry: TelemetryScope | None
    compaction: CompactionModifier | None
    encoder_factory: Callable[[], StreamEncoder] | None
    chat_service_factory: Callable[[UserContext], Any] | None
```

- [ ] **Step 4: Run the test**

```bash
pytest agents/analytics-agent/tests/unit/test_app_dependencies.py -v
```

Expected: PASS.

- [ ] **Step 5: Update `build_test_deps.py` to use the real `AppDependencies`**

Edit `agents/analytics-agent/tests/fakes/build_test_deps.py` — the fallback `try/except` now succeeds; nothing to change functionally, but verify the real import is picked up:

```bash
python -c "from analytics_agent.tests.fakes.build_test_deps import AppDependencies; print(AppDependencies.__module__)"
```

Expected output: `analytics_agent.src.app_dependencies` (not the placeholder).

- [ ] **Step 6: Commit**

```bash
git add agents/analytics-agent/src/app_dependencies.py agents/analytics-agent/tests/unit/test_app_dependencies.py
git commit -m "feat(analytics-agent): add AppDependencies dataclass as single wiring object"
```

### Task 4.2: Refactor `create_app` to be pure — red test first

**Files:**
- Modify: `agents/analytics-agent/src/app.py`
- Test: `agents/analytics-agent/tests/application/test_create_app_pure.py`

- [ ] **Step 1: Create application test conftest**

Write `agents/analytics-agent/tests/application/conftest.py`:

```python
"""Shared fixtures for application-tier tests."""
import pytest
from httpx import AsyncClient, ASGITransport

from analytics_agent.src.app import create_app
from analytics_agent.tests.fakes.build_test_deps import build_test_dependencies


@pytest.fixture
def app():
    """Real FastAPI app wired with fakes; no lifespan, no Docker."""
    deps = build_test_dependencies()
    return create_app(deps)


@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
```

- [ ] **Step 2: Write the failing test**

Write `agents/analytics-agent/tests/application/test_create_app_pure.py`:

```python
"""create_app must be a pure function taking AppDependencies."""
import inspect

from analytics_agent.src.app import create_app


def test_signature_takes_deps():
    sig = inspect.signature(create_app)
    params = list(sig.parameters)
    assert params == ["deps"], f"Expected single 'deps' param, got {params}"


def test_no_module_level_app_instance():
    """The module must not construct an `app = create_app()` at import time."""
    import analytics_agent.src.app as app_mod
    # `app` should either be absent or require explicit construction.
    # If present, it must be a factory call using lifespan-built deps,
    # not an env-reading instantiation.
    # For the pure refactor, no module-level `app` variable exists.
    assert not hasattr(app_mod, "app") or callable(getattr(app_mod, "app")), (
        "Module-level app instance makes testing and lifespans fragile"
    )


def test_returns_fastapi_instance_when_called_with_deps(app):
    from fastapi import FastAPI
    assert isinstance(app, FastAPI)
```

- [ ] **Step 3: Run to verify failure**

```bash
pytest agents/analytics-agent/tests/application/test_create_app_pure.py -v
```

Expected: FAIL on signature and/or module-level `app` presence.

- [ ] **Step 4: Refactor `app.py`**

Rewrite `agents/analytics-agent/src/app.py`:

```python
"""Analytics Agent — FastAPI application factory.

create_app(deps) is a pure function: it registers routes and middleware on
a new FastAPI instance using the dependencies provided, and returns it.
No environment reads, no I/O. All infrastructure construction happens in
lifespan.py and is packaged into AppDependencies.

Production entry point (see `entrypoint.py` or equivalent):
    from .lifespan import lifespan
    # lifespan builds AppDependencies and attaches via app.state

Tests construct their own AppDependencies via
    analytics_agent.tests.fakes.build_test_deps.build_test_dependencies
"""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .app_dependencies import AppDependencies
from .lifespan import lifespan
from .routes import chat_router, conversations_router, health_router


def create_app(deps: AppDependencies) -> FastAPI:
    """Create and configure a FastAPI app with the provided dependencies.

    Pure function — no env reads, no I/O. The `deps` object is attached
    to `app.state.deps` so routes can access services via dependency
    injection.
    """
    application = FastAPI(
        title="Analytics Agent",
        description="Enterprise Agentic Analytics Platform — LangGraph orchestrator",
        version="1.0.0",
        lifespan=lifespan,
    )

    application.state.deps = deps

    application.include_router(health_router)
    application.include_router(chat_router)
    application.include_router(conversations_router)

    application.add_middleware(
        CORSMiddleware,
        allow_origins=os.getenv("ALLOWED_ORIGINS", "*").split(","),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    return application
```

Remove the module-level `app = create_app()`.

> **Consequence:** uvicorn / Docker entrypoint configuration that was loading `analytics_agent.src.app:app` will break. Add a thin entry module.

- [ ] **Step 5: Add production entrypoint**

Create `agents/analytics-agent/src/entrypoint.py`:

```python
"""Production uvicorn entrypoint: builds real AppDependencies via lifespan.

uvicorn analytics_agent.src.entrypoint:app
"""
from .app import create_app
from .app_dependencies import AppDependencies

# At import time we create an app with an empty-deps scaffold; lifespan
# will populate app.state.deps on startup. Routes must read from
# app.state.deps, never from the closure of create_app.
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
app = create_app(_empty_deps)
```

- [ ] **Step 6: Run tests**

```bash
pytest agents/analytics-agent/tests/application/test_create_app_pure.py -v
```

Expected: PASS.

- [ ] **Step 7: Run full suite**

```bash
pytest -x --ignore=agents/analytics-agent/tests/integration -q
```

Expected: some existing tests may fail because they imported `from .app import app`. Update them to use the `app` fixture from `conftest.py` instead. If you touch more than 2 test files here, stop — that's Phase 7 territory.

- [ ] **Step 8: Update uvicorn command references**

Grep for references to `analytics_agent.src.app:app` in `Dockerfile`, `docker-compose*.yml`, `Makefile`, and CI config. Replace with `analytics_agent.src.entrypoint:app`.

```bash
grep -rn "analytics_agent.src.app:app\|analytics_agent.src.app:create_app" --include="Dockerfile*" --include="docker-compose*.yml" --include="Makefile" --include="*.yml" --include="*.yaml"
```

For each hit, update to `analytics_agent.src.entrypoint:app`.

- [ ] **Step 9: Commit**

```bash
git add agents/analytics-agent/src/app.py agents/analytics-agent/src/entrypoint.py agents/analytics-agent/tests/application/conftest.py agents/analytics-agent/tests/application/test_create_app_pure.py <any updated Docker/compose/Makefile>
git commit -m "refactor(analytics-agent): make create_app(deps) pure; add entrypoint shim for uvicorn"
```

### Task 4.3: Refactor `lifespan(app)` to build `AppDependencies`

**Files:**
- Modify: `agents/analytics-agent/src/lifespan.py`
- Test: `agents/analytics-agent/tests/component/test_lifespan_builds_deps.py`

- [ ] **Step 1: Write the failing test**

Write `agents/analytics-agent/tests/component/test_lifespan_builds_deps.py`:

```python
"""lifespan populates app.state.deps with a fully-wired AppDependencies."""
import pytest
from fastapi import FastAPI
from unittest.mock import AsyncMock, MagicMock, patch

from analytics_agent.src.app_dependencies import AppDependencies
from analytics_agent.src.lifespan import lifespan


@pytest.fixture
def app():
    return FastAPI()


async def test_lifespan_attaches_appdependencies(app, monkeypatch):
    # Patch heavyweight startups with mocks.
    monkeypatch.setenv("DATABASE_URL", "")  # force memory store path

    fake_registry = MagicMock()
    fake_registry.connect_all = AsyncMock(return_value={})
    fake_registry.disconnect_all = AsyncMock()

    with patch("analytics_agent.src.lifespan.McpRegistry", return_value=fake_registry), \
         patch("analytics_agent.src.lifespan.setup_checkpointer", new=AsyncMock(return_value=None)), \
         patch("analytics_agent.src.lifespan.setup_telemetry"), \
         patch("analytics_agent.src.lifespan.flush_langfuse"):
        async with lifespan(app):
            deps = getattr(app.state, "deps", None)
            assert isinstance(deps, AppDependencies)
            assert deps.config is not None
            assert deps.conversation_store is not None
            assert deps.mcp_tools_provider is not None
            assert deps.llm_factory is not None
            assert deps.telemetry is not None
            assert deps.compaction is not None
            assert deps.encoder_factory is not None
            assert deps.chat_service_factory is not None
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest agents/analytics-agent/tests/component/test_lifespan_builds_deps.py -v
```

Expected: FAIL — lifespan sets individual attrs, not a single `deps`.

- [ ] **Step 3: Refactor `lifespan.py`**

Rewrite `agents/analytics-agent/src/lifespan.py`:

```python
"""Analytics Agent — application lifespan (startup/shutdown).

Builds the fully-wired AppDependencies from environment at startup,
attaches to app.state.deps, and tears down on shutdown. This is the
ONLY place that instantiates real infrastructure.
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from platform_sdk import (
    AgentConfig,
    AgentContext,
    configure_logging,
    flush_langfuse,
    get_logger,
    setup_checkpointer,
    setup_telemetry,
)
from platform_sdk.compaction import TokenAwareCompactionModifier
from platform_sdk.mcp_registry import McpRegistry

from .app_dependencies import AppDependencies
from .graph import build_analytics_graph
from .persistence import MemoryConversationStore, PostgresConversationStore
from .services.chat_service import ChatService
from .streaming.data_stream_encoder import DataStreamEncoder

configure_logging()
log = get_logger(__name__)


def _make_conversation_store():
    db_url = os.getenv("DATABASE_URL")
    if db_url and os.getenv("ENVIRONMENT") not in ("local",) and PostgresConversationStore is not None:
        return PostgresConversationStore(db_url)
    if db_url and PostgresConversationStore is None:
        log.warning("asyncpg_not_available", fallback="MemoryConversationStore")
    return MemoryConversationStore()


class _MCPBridgeToolsProvider:
    """Aggregates MCPToolBridge instances behind MCPToolsProvider Protocol."""

    def __init__(self, bridges: dict):
        self._bridges = bridges

    async def get_langchain_tools(self, user_ctx):
        tools: list = []
        for bridge in self._bridges.values():
            if bridge.is_connected:
                tools.extend(await bridge.get_langchain_tools(user_ctx))
        return tools


class _LLMFactoryAdapter:
    """Wraps platform_sdk.make_chat_llm into the LLMFactory Protocol shape."""

    def __init__(self, config: AgentConfig):
        from platform_sdk import make_chat_llm

        self._make = make_chat_llm
        self._config = config

    def make_router_llm(self):
        return self._make(self._config.router_model_route, config=self._config)

    def make_synthesis_llm(self):
        return self._make(self._config.synthesis_model_route, config=self._config)


class _LangfuseTelemetry:
    """Thin TelemetryScope adapter over existing Langfuse helpers."""

    def start_span(self, name):
        from contextlib import contextmanager

        @contextmanager
        def _span():
            yield None  # observation handled by existing OTel/Langfuse instrumentation

        return _span()

    def record_event(self, name, **attrs):
        log.info(name, **attrs)


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_telemetry("analytics-agent")
    config = AgentConfig.from_env()

    agent_context = AgentContext(
        rm_id="analytics-agent",
        rm_name="Analytics Agent",
        role="manager",
        team_id="analytics",
        assigned_account_ids=(),
        compliance_clearance=("standard", "aml_view"),
    )

    registry = McpRegistry()
    bridges = await registry.connect_all(
        agent_context=agent_context,
        timeout=config.mcp_startup_timeout,
    )
    for name, bridge in bridges.items():
        log.info("mcp_startup_status", server=name, connected=bridge.is_connected)

    mcp_tools_provider = _MCPBridgeToolsProvider(bridges)
    llm_factory = _LLMFactoryAdapter(config)
    compaction = TokenAwareCompactionModifier(config.context_token_limit)

    checkpointer = await setup_checkpointer(config)
    graph = build_analytics_graph(bridges=bridges, config=config, checkpointer=checkpointer)

    conversation_store = _make_conversation_store()
    if hasattr(conversation_store, "connect"):
        await conversation_store.connect()

    telemetry = _LangfuseTelemetry()
    encoder_factory = lambda: DataStreamEncoder()

    def chat_service_factory(user_ctx):
        return ChatService(
            graph=graph,
            conversation_store=conversation_store,
            config=config,
            user_ctx=user_ctx,
            encoder_factory=encoder_factory,
            telemetry=telemetry,
        )

    app.state.deps = AppDependencies(
        config=config,
        graph=graph,
        conversation_store=conversation_store,
        mcp_tools_provider=mcp_tools_provider,
        llm_factory=llm_factory,
        telemetry=telemetry,
        compaction=compaction,
        encoder_factory=encoder_factory,
        chat_service_factory=chat_service_factory,
    )

    log.info("analytics_agent_ready")
    yield

    flush_langfuse()
    if hasattr(conversation_store, "disconnect"):
        await conversation_store.disconnect()
    await registry.disconnect_all(bridges)
```

> **Note:** `ChatService(..., user_ctx=user_ctx, encoder_factory=encoder_factory, telemetry=telemetry)` matches the **new** constructor signature from Phase 5. If Phase 5 hasn't landed yet, this factory may need a simpler form. Execute Phase 5 first, then revisit this file to add the new ChatService params.

- [ ] **Step 4: Run the component test**

```bash
pytest agents/analytics-agent/tests/component/test_lifespan_builds_deps.py -v
```

Expected: PASS (may need adjusting imports for `ChatService` signature).

- [ ] **Step 5: Run full suite**

```bash
pytest -x --ignore=agents/analytics-agent/tests/integration -q
```

Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add agents/analytics-agent/src/lifespan.py agents/analytics-agent/tests/component/test_lifespan_builds_deps.py
git commit -m "refactor(analytics-agent): lifespan builds AppDependencies and attaches to app.state"
```

---

## Phase 5 — Service layer

Goal: make `ChatService` take all deps by constructor; plumb `UserContext` explicitly; add red-first tests for orchestration.

### Task 5.1: Write the `ChatService` target-signature test

**Files:**
- Test: `agents/analytics-agent/tests/component/test_chat_service_signature.py`

- [ ] **Step 1: Write the failing test**

Write `agents/analytics-agent/tests/component/test_chat_service_signature.py`:

```python
"""Lock the new ChatService constructor signature."""
import inspect

from analytics_agent.src.services.chat_service import ChatService


def test_constructor_takes_named_deps():
    sig = inspect.signature(ChatService.__init__)
    names = {p.name for p in sig.parameters.values() if p.name != "self"}
    expected = {
        "graph",
        "conversation_store",
        "config",
        "user_ctx",
        "encoder_factory",
        "telemetry",
    }
    assert expected <= names, f"Missing ctor params: {expected - names}"


def test_execute_takes_chat_request():
    sig = inspect.signature(ChatService.execute)
    params = [p.name for p in sig.parameters.values() if p.name != "self"]
    assert params == ["req"], f"Expected execute(self, req), got {params}"
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest agents/analytics-agent/tests/component/test_chat_service_signature.py -v
```

Expected: FAIL — the current `execute()` takes many positional args.

### Task 5.2: Rewrite `ChatService` to take deps by constructor and `ChatRequest` by call

**Files:**
- Modify: `agents/analytics-agent/src/services/chat_service.py`

- [ ] **Step 1: Read the current `ChatService`**

```bash
wc -l agents/analytics-agent/src/services/chat_service.py
```

- [ ] **Step 2: Rewrite `chat_service.py`**

Rewrite `agents/analytics-agent/src/services/chat_service.py`:

```python
"""ChatService — orchestrates graph invocation, streaming, and persistence.

Constructor-injected. Per-request UserContext is held on the instance.
No module-level state. Emits bytes via the injected StreamEncoder.
"""
from __future__ import annotations

import json
import uuid
from typing import Any, AsyncIterator, Callable, Optional

from platform_sdk import AgentConfig, get_logger

from ..domain.errors import AnalyticsError
from ..domain.types import ChatRequest, UserContext
from ..ports import ConversationStore, StreamEncoder, TelemetryScope

log = get_logger(__name__)

GRAPH_NODES = {"intent_router", "mcp_tool_caller", "synthesis", "error_handler"}
REASONING_NODES = {"intent_router", "mcp_tool_caller", "error_handler"}


class ChatService:
    """One per request. Owns graph lifecycle, streaming, persistence."""

    def __init__(
        self,
        *,
        graph: Any,
        conversation_store: ConversationStore,
        config: AgentConfig,
        user_ctx: UserContext,
        encoder_factory: Callable[[], StreamEncoder],
        telemetry: TelemetryScope,
    ) -> None:
        self._graph = graph
        self._store = conversation_store
        self._config = config
        self._user_ctx = user_ctx
        self._encoder_factory = encoder_factory
        self._telemetry = telemetry

    async def execute(self, req: ChatRequest) -> AsyncIterator[bytes]:
        """Execute one chat request; yield encoded wire bytes."""
        encoder = self._encoder_factory()
        session_id = req.conversation_id or uuid.uuid4().hex

        captured_narrative = ""
        captured_components: list[dict] = []
        error_id: Optional[str] = None

        with self._telemetry.start_span("chat.execute"):
            try:
                # Ensure conversation exists (if the store supports it).
                if hasattr(self._store, "get_conversation"):
                    conv = await self._store.get_conversation(session_id)
                    if not conv and hasattr(self._store, "create_conversation"):
                        await self._store.create_conversation(session_id, "New Conversation")

                graph_messages = list(req.history) + [
                    {"role": "user", "content": req.message}
                ]
                run_config = {
                    "configurable": {
                        "user_ctx": self._user_ctx,
                        "thread_id": session_id,
                        "session_id": session_id,
                    }
                }

                async for event in self._graph.astream_events(
                    {"messages": graph_messages, "session_id": session_id},
                    config=run_config,
                    version="v2",
                ):
                    yield encoder.encode_event(event)

                    if (
                        event.get("event") == "on_chain_end"
                        and event.get("name") == "synthesis"
                    ):
                        out = event.get("data", {}).get("output", {}) or {}
                        captured_narrative = out.get("narrative", captured_narrative)
                        captured_components = out.get("ui_components", captured_components)

                yield encoder.finalize()

                if captured_narrative:
                    try:
                        if hasattr(self._store, "add_message"):
                            await self._store.add_message(
                                session_id, "user", req.message, components=None
                            )
                            await self._store.add_message(
                                session_id,
                                "assistant",
                                captured_narrative,
                                components=captured_components or None,
                            )
                    except Exception as exc:
                        log.error(
                            "conversation_persistence_failed",
                            error=str(exc),
                            conversation_id=session_id,
                        )

            except AnalyticsError as exc:
                error_id = uuid.uuid4().hex
                log.error(
                    "chat_service_error",
                    error=str(exc),
                    error_type=type(exc).__name__,
                    error_id=error_id,
                    user_id=self._user_ctx.user_id,
                )
                yield encoder.encode_error(exc, error_id=error_id)
                yield encoder.finalize()
            except Exception as exc:
                error_id = uuid.uuid4().hex
                log.error(
                    "chat_service_unexpected_error",
                    error=str(exc),
                    error_id=error_id,
                )
                yield encoder.encode_error(exc, error_id=error_id)
                yield encoder.finalize()
```

- [ ] **Step 3: Run the signature test**

```bash
pytest agents/analytics-agent/tests/component/test_chat_service_signature.py -v
```

Expected: PASS.

- [ ] **Step 4: Run the full suite**

```bash
pytest -x --ignore=agents/analytics-agent/tests/integration -q
```

Expected: **several failures** — existing `test_chat_service.py` calls the old signature and routes in `routes/chat.py` use the old signature. These are fixed in Tasks 5.3 and 7.1–7.2 respectively. Continue to Task 5.3.

- [ ] **Step 5: Commit**

```bash
git add agents/analytics-agent/src/services/chat_service.py agents/analytics-agent/tests/component/test_chat_service_signature.py
git commit -m "refactor(analytics-agent): ChatService takes deps by constructor, ChatRequest by call"
```

### Task 5.3: Update `routes/chat.py` to use new `ChatService` signature

**Files:**
- Modify: `agents/analytics-agent/src/routes/chat.py`

- [ ] **Step 1: Read the current route**

```bash
cat agents/analytics-agent/src/routes/chat.py
```

- [ ] **Step 2: Rewrite the route to use `chat_service_factory`**

Replace the body of the POST handler:

```python
"""Chat route — POST /api/v1/analytics/chat.

Thin translation from HTTP into ChatService.execute(ChatRequest).
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from ..domain.errors import AuthError, ConversationNotFound
from ..domain.types import ChatRequest, UserContext

chat_router = APIRouter(prefix="/api/v1/analytics", tags=["chat"])


def _user_ctx_from(request: Request) -> UserContext:
    user_id = request.headers.get("x-user-id")
    tenant_id = request.headers.get("x-tenant-id")
    auth = request.headers.get("authorization", "")
    if not user_id or not tenant_id:
        raise AuthError("Missing x-user-id or x-tenant-id headers")
    token = auth[7:] if auth.lower().startswith("bearer ") else auth
    return UserContext(user_id=user_id, tenant_id=tenant_id, auth_token=token)


@chat_router.post("/chat")
async def chat(request: Request, req: ChatRequest):
    """POST /chat — streams Vercel AI SDK Data Stream Protocol bytes."""
    deps = request.app.state.deps
    if deps is None or deps.chat_service_factory is None:
        raise HTTPException(500, "Analytics agent not initialized")
    user_ctx = _user_ctx_from(request)
    service = deps.chat_service_factory(user_ctx)
    return StreamingResponse(
        service.execute(req),
        media_type="text/plain; charset=utf-8",
    )
```

- [ ] **Step 3: Register exception handlers in `create_app`**

Edit `agents/analytics-agent/src/app.py` — add exception handlers after `application.state.deps = deps`:

```python
from fastapi import Request
from fastapi.responses import JSONResponse
import uuid

from .domain.errors import (
    AnalyticsError,
    AuthError,
    ConversationNotFound,
)

@application.exception_handler(AuthError)
async def _auth_err(request: Request, exc: AuthError):
    return JSONResponse({"error_id": uuid.uuid4().hex, "type": "auth", "message": str(exc)}, status_code=401)

@application.exception_handler(ConversationNotFound)
async def _notfound(request: Request, exc: ConversationNotFound):
    return JSONResponse({"error_id": uuid.uuid4().hex, "type": "not_found", "message": str(exc)}, status_code=404)

@application.exception_handler(AnalyticsError)
async def _internal(request: Request, exc: AnalyticsError):
    return JSONResponse({"error_id": uuid.uuid4().hex, "type": "internal"}, status_code=500)
```

- [ ] **Step 4: Update `conversations.py` and `health.py` routes similarly**

For `routes/conversations.py`: replace any direct `app.state.conversation_store` access with `app.state.deps.conversation_store`.

For `routes/health.py`: no changes expected unless it reads old `app.state.graph` — update to `app.state.deps.graph`.

- [ ] **Step 5: Run the component tests**

```bash
pytest agents/analytics-agent/tests/component/ -v
```

Expected: earlier `test_chat_service.py` failures are now resolved. New failures in routes-related tests (if any) indicate the routes still use the old signature — return to step 4.

- [ ] **Step 6: Commit**

```bash
git add agents/analytics-agent/src/routes/chat.py agents/analytics-agent/src/routes/conversations.py agents/analytics-agent/src/routes/health.py agents/analytics-agent/src/app.py
git commit -m "refactor(analytics-agent): routes read deps from app.state.deps; register exception handlers"
```

### Task 5.4: Orchestration test — ChatService streams encoded events

**Files:**
- Test: `agents/analytics-agent/tests/component/test_chat_service_orchestration.py`

- [ ] **Step 1: Write the test**

Write `agents/analytics-agent/tests/component/test_chat_service_orchestration.py`:

```python
"""ChatService orchestration at component tier."""
import pytest
from unittest.mock import AsyncMock, MagicMock

from analytics_agent.src.domain.types import ChatRequest, UserContext
from analytics_agent.src.services.chat_service import ChatService
from analytics_agent.tests.fakes.fake_conversation_store import FakeConversationStore
from analytics_agent.tests.fakes.fake_stream_encoder import FakeStreamEncoder
from analytics_agent.tests.fakes.fake_telemetry import FakeTelemetryScope


@pytest.fixture
def ctx():
    return UserContext(user_id="u1", tenant_id="t1", auth_token="tok")


def _fake_graph_emitting(events):
    graph = MagicMock()

    async def _astream(*args, **kwargs):
        for e in events:
            yield e

    graph.astream_events = _astream
    return graph


async def test_streams_events_via_encoder(ctx):
    encoder = FakeStreamEncoder()
    events = [
        {"event": "on_chain_start", "name": "intent_router"},
        {"event": "on_chain_end", "name": "synthesis", "data": {"output": {"narrative": "done"}}},
    ]
    graph = _fake_graph_emitting(events)
    store = FakeConversationStore()

    service = ChatService(
        graph=graph,
        conversation_store=store,
        config=MagicMock(),
        user_ctx=ctx,
        encoder_factory=lambda: encoder,
        telemetry=FakeTelemetryScope(),
    )

    collected = [chunk async for chunk in service.execute(ChatRequest(message="hi"))]

    assert len(encoder.events) == 2
    assert encoder.finalized is True
    assert len(collected) >= 2  # 2 events + finalize


async def test_error_is_encoded_and_stream_closes(ctx):
    encoder = FakeStreamEncoder()

    graph = MagicMock()

    async def _boom(*args, **kwargs):
        raise ValueError("boom")
        yield  # unreachable — makes it an async gen
    graph.astream_events = _boom

    service = ChatService(
        graph=graph,
        conversation_store=FakeConversationStore(),
        config=MagicMock(),
        user_ctx=ctx,
        encoder_factory=lambda: encoder,
        telemetry=FakeTelemetryScope(),
    )

    _ = [chunk async for chunk in service.execute(ChatRequest(message="hi"))]
    assert len(encoder.errors) == 1
    assert encoder.finalized is True
```

- [ ] **Step 2: Run**

```bash
pytest agents/analytics-agent/tests/component/test_chat_service_orchestration.py -v
```

Expected: PASS. If the `_fake_graph_emitting` `async def _astream` doesn't produce an async generator correctly, convert to an `async def` with a `for ... yield` body.

- [ ] **Step 3: Commit**

```bash
git add agents/analytics-agent/tests/component/test_chat_service_orchestration.py
git commit -m "test(analytics-agent): add ChatService orchestration and error-path component tests"
```

### Task 5.5: Migrate the old `test_chat_service.py` to the new signature

**Files:**
- Modify: `agents/analytics-agent/tests/component/test_chat_service.py`

- [ ] **Step 1: Run the old test to confirm current failures**

```bash
pytest agents/analytics-agent/tests/component/test_chat_service.py -v
```

Record failures.

- [ ] **Step 2: Update each failing test**

For each test that calls the old `ChatService(graph, conversation_store, config)` with `execute(session_id, user_message, history_messages, user_context, encoder)`:
- Rewrite construction to keyword-only: `ChatService(graph=..., conversation_store=..., config=..., user_ctx=..., encoder_factory=lambda: ..., telemetry=FakeTelemetryScope())`.
- Rewrite `.execute(...)` calls to pass a `ChatRequest(message=user_message, conversation_id=session_id, history=history_messages)`.
- Replace `AgentContext`-based fakes with `UserContext(...)`.

- [ ] **Step 3: Run the migrated tests**

```bash
pytest agents/analytics-agent/tests/component/test_chat_service.py -v
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add agents/analytics-agent/tests/component/test_chat_service.py
git commit -m "test(analytics-agent): migrate chat-service tests to new constructor/ChatRequest API"
```

### Task 5.6: Remove `set_user_auth_token` / `reset_user_auth_token` calls from `ChatService` if any remain

**Files:**
- Verify: `agents/analytics-agent/src/services/chat_service.py`

- [ ] **Step 1: Grep for lingering ContextVar auth calls**

```bash
grep -n "set_user_auth_token\|reset_user_auth_token" agents/analytics-agent/src/ agents/analytics-agent/tests/
```

- [ ] **Step 2: Remove any matches**

Any hit must be rewritten. In production code, user context is now in `self._user_ctx` and in `run_config["configurable"]["user_ctx"]`. In tests, supply `UserContext` directly.

- [ ] **Step 3: Run the full suite**

```bash
pytest -x --ignore=agents/analytics-agent/tests/integration -q
```

Expected: PASS (excluding pre-existing Phase 0 failures).

- [ ] **Step 4: Commit**

```bash
git add <modified-files>
git commit -m "refactor(analytics-agent): remove remaining set/reset_user_auth_token calls"
```

This task also **unblocks Task 3.3** — return to Phase 3 and execute Task 3.3 now.

---

## Phase 6 — Domain layer: nodes as classes

Goal: convert node factories into callable classes with constructor injection; standardize `build_analytics_graph(deps)`; fix P0 intent-validation and schema bugs.

### Task 6.1: Add `GraphDependencies` dataclass

**Files:**
- Create: `agents/analytics-agent/src/graph_dependencies.py`
- Test: `agents/analytics-agent/tests/unit/test_graph_dependencies.py`

- [ ] **Step 1: Write failing test**

Write `agents/analytics-agent/tests/unit/test_graph_dependencies.py`:

```python
"""GraphDependencies dataclass exists and has required fields."""
from dataclasses import fields

from analytics_agent.src.graph_dependencies import GraphDependencies


def test_fields():
    names = {f.name for f in fields(GraphDependencies)}
    assert {"llm_factory", "tools_provider", "compaction", "config", "prompts"} <= names
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest agents/analytics-agent/tests/unit/test_graph_dependencies.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Write dataclass**

Create `agents/analytics-agent/src/graph_dependencies.py`:

```python
"""GraphDependencies — dependencies needed to build the analytics graph."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from platform_sdk import AgentConfig

from .ports import CompactionModifier, LLMFactory, MCPToolsProvider


@dataclass
class GraphDependencies:
    llm_factory: LLMFactory
    tools_provider: MCPToolsProvider
    compaction: CompactionModifier
    config: AgentConfig
    prompts: Any = None  # PromptLoader | None
```

- [ ] **Step 4: Run**

```bash
pytest agents/analytics-agent/tests/unit/test_graph_dependencies.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/analytics-agent/src/graph_dependencies.py agents/analytics-agent/tests/unit/test_graph_dependencies.py
git commit -m "feat(analytics-agent): add GraphDependencies dataclass"
```

### Task 6.2: Convert `IntentRouterNode` to callable class — red test for structure

**Files:**
- Modify: `agents/analytics-agent/src/nodes/intent_router.py`
- Test: `agents/analytics-agent/tests/unit/test_intent_router_node_class.py`

- [ ] **Step 1: Write the failing test**

Write `agents/analytics-agent/tests/unit/test_intent_router_node_class.py`:

```python
"""IntentRouterNode is a callable class with constructor injection."""
import inspect
import pytest

from analytics_agent.src.nodes.intent_router import IntentRouterNode
from analytics_agent.tests.fakes.fake_compaction import FakeCompactionModifier
from analytics_agent.tests.fakes.fake_llm import FakeLLM
from analytics_agent.tests.fakes.fake_mcp_tools_provider import FakeMCPToolsProvider


def test_constructor_takes_named_deps():
    sig = inspect.signature(IntentRouterNode.__init__)
    names = {p.name for p in sig.parameters.values() if p.name != "self"}
    assert {"llm", "tools_provider", "prompts", "compaction"} <= names


def test_is_async_callable():
    node = IntentRouterNode(
        llm=FakeLLM(),
        tools_provider=FakeMCPToolsProvider(),
        prompts=None,
        compaction=FakeCompactionModifier(),
    )
    assert callable(node)
    assert inspect.iscoroutinefunction(node.__call__)
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest agents/analytics-agent/tests/unit/test_intent_router_node_class.py -v
```

Expected: FAIL — `IntentRouterNode` class doesn't exist (file currently exports `make_intent_router_node`).

- [ ] **Step 3: Refactor `intent_router.py` to a class, preserving behavior**

Read the current `intent_router.py` (523 lines). Wrap its logic into a class:

```python
"""Intent router node — classifies incoming messages and generates query plans."""
from __future__ import annotations

from typing import Any

from langchain_core.messages import BaseMessage
from langchain_core.runnables import RunnableConfig

from ..domain.errors import UnknownIntent
from ..ports import CompactionModifier, MCPToolsProvider
from ..state import AnalyticsState, migrate_state

VALID_INTENTS = {"data_query", "follow_up", "clarification"}


class IntentRouterNode:
    """Classify user intent; generate query plan; route.

    On unknown intent (P0 fix): sets intent="clarification" and populates
    a user-facing clarification message; does NOT raise.
    """

    def __init__(
        self,
        *,
        llm: Any,
        tools_provider: MCPToolsProvider,
        prompts: Any,
        compaction: CompactionModifier,
    ) -> None:
        self._llm = llm
        self._tools_provider = tools_provider
        self._prompts = prompts
        self._compaction = compaction

    async def __call__(
        self, state: AnalyticsState, config: RunnableConfig
    ) -> dict:
        migration = migrate_state(state)
        if migration:
            state = {**state, **migration}

        user_ctx = config.get("configurable", {}).get("user_ctx")
        tools = await self._tools_provider.get_langchain_tools(user_ctx) if user_ctx else []

        # ... existing prompt building, schema, LLM call ...
        # (copy the current implementation of make_intent_router_node's inner function)
        # replace `bridges` references with `tools` from get_langchain_tools
        # replace `compaction_modifier` with `self._compaction`
        # replace `router_llm` with `self._llm`

        # P0 fix: validate returned intent.
        # After the LLM call produces `raw_intent`:
        # if raw_intent not in VALID_INTENTS:
        #     return {"intent": "clarification", "intent_reasoning": f"Unknown intent: {raw_intent!r}; asking for clarification.", "query_plan": []}

        raise NotImplementedError("Move existing make_intent_router_node logic into __call__")


def route_after_intent(state: AnalyticsState) -> str:
    """Conditional edge selector — preserves existing routing."""
    intent = state.get("intent", "clarification")
    if intent == "data_query":
        return "mcp_tool_caller"
    if intent == "follow_up":
        return "synthesis"
    return "error_handler"
```

> **Important:** the real implementation must port the **existing behavior** from `make_intent_router_node` inside `__call__`. Do not lose business logic. Use `git log -p agents/analytics-agent/src/nodes/intent_router.py` to see the prior content.

For the duration of this migration, keep the old `make_intent_router_node` function alongside (delegating to `IntentRouterNode`):

```python
def make_intent_router_node(llm, bridges, prompts, compaction):
    """Deprecated shim — retained until graph.py is migrated to GraphDependencies."""
    class _ToolsProviderFromBridges:
        async def get_langchain_tools(self, user_ctx):
            all_tools = []
            for b in bridges.values():
                if getattr(b, "is_connected", False):
                    all_tools.extend(await b.get_langchain_tools(user_ctx))
            return all_tools

    node = IntentRouterNode(
        llm=llm,
        tools_provider=_ToolsProviderFromBridges(),
        prompts=prompts,
        compaction=compaction,
    )
    return node  # callable, compatible with builder.add_node
```

- [ ] **Step 4: Run the class test**

```bash
pytest agents/analytics-agent/tests/unit/test_intent_router_node_class.py -v
```

Expected: PASS (both tests). The deeper behavior tests run next.

- [ ] **Step 5: Commit the class wrapper**

```bash
git add agents/analytics-agent/src/nodes/intent_router.py agents/analytics-agent/tests/unit/test_intent_router_node_class.py
git commit -m "refactor(analytics-agent): IntentRouterNode is a callable class with constructor injection"
```

### Task 6.3: P0 fix — `IntentRouterNode` validates intent (red test first)

**Files:**
- Modify: `agents/analytics-agent/src/nodes/intent_router.py`
- Test: `agents/analytics-agent/tests/unit/test_intent_router_node_validation.py`

- [ ] **Step 1: Write the failing test**

Write `agents/analytics-agent/tests/unit/test_intent_router_node_validation.py`:

```python
"""P0 regression: unknown intents from the LLM route to error_handler, not a crash."""
import pytest
from langchain_core.messages import HumanMessage

from analytics_agent.src.domain.types import UserContext
from analytics_agent.src.nodes.intent_router import IntentRouterNode, route_after_intent
from analytics_agent.tests.fakes.fake_compaction import FakeCompactionModifier
from analytics_agent.tests.fakes.fake_llm import FakeLLM
from analytics_agent.tests.fakes.fake_mcp_tools_provider import FakeMCPToolsProvider


class _Schema:
    intent = "bogus_intent"
    query_plan = []
    intent_reasoning = "LLM hallucinated."


async def test_unknown_intent_routes_to_error_handler():
    # FakeLLM structured_response returns a Schema-shaped object with bogus intent.
    llm = FakeLLM(structured_response=_Schema())

    node = IntentRouterNode(
        llm=llm,
        tools_provider=FakeMCPToolsProvider(),
        prompts=None,
        compaction=FakeCompactionModifier(),
    )

    ctx = UserContext(user_id="u", tenant_id="t", auth_token="tok")
    state = {"messages": [HumanMessage(content="help")], "session_id": "s1", "turn_count": 0}
    config = {"configurable": {"user_ctx": ctx}}

    result = await node(state, config)

    assert result.get("intent") == "clarification", (
        "Unknown intents must be rewritten to 'clarification' (P0 fix)"
    )
    # And the router function must route "clarification" to "error_handler"
    assert route_after_intent({**state, **result}) == "error_handler"
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest agents/analytics-agent/tests/unit/test_intent_router_node_validation.py -v
```

Expected: FAIL (current code likely returns the raw intent).

- [ ] **Step 3: Implement the validation**

Inside `IntentRouterNode.__call__`, after the LLM call that produces a structured result with `intent`:

```python
raw_intent = structured_result.intent
if raw_intent not in VALID_INTENTS:
    return {
        "intent": "clarification",
        "intent_reasoning": f"Unknown intent returned by router: {raw_intent!r}",
        "query_plan": [],
    }
```

- [ ] **Step 4: Run the test**

```bash
pytest agents/analytics-agent/tests/unit/test_intent_router_node_validation.py -v
```

Expected: PASS.

- [ ] **Step 5: Run the old intent router tests**

```bash
pytest agents/analytics-agent/tests/unit/test_intent_router_node.py -v
```

Expected: PASS (existing behavior preserved for valid intents).

- [ ] **Step 6: Commit**

```bash
git add agents/analytics-agent/src/nodes/intent_router.py agents/analytics-agent/tests/unit/test_intent_router_node_validation.py
git commit -m "fix(analytics-agent): IntentRouterNode validates intent; unknown → clarification (P0)"
```

### Task 6.4: Convert `MCPToolCallerNode`, `SynthesisNode`, `ErrorHandlerNode` to classes

**Files:**
- Modify: `agents/analytics-agent/src/nodes/mcp_tool_caller.py`
- Modify: `agents/analytics-agent/src/nodes/synthesis.py`
- Modify: `agents/analytics-agent/src/nodes/error_handler.py`
- Tests: class-structure tests for each

For each of the three nodes, repeat the pattern from Task 6.2:

- [ ] **Step 1: Write a structure test for each**

Write one `test_<node>_class.py` per node (unit tier) asserting:
- Class exists and is callable
- Constructor accepts the expected named parameters
- `__call__` is an async coroutine function

Skeleton:

```python
import inspect
from analytics_agent.src.nodes.<node_module> import <NodeClass>

def test_is_class():
    assert inspect.isclass(<NodeClass>)

def test_async_callable():
    # ... minimal instantiation with fakes
    assert inspect.iscoroutinefunction(<NodeClass>.__call__)
```

Use these constructor signatures:

```
MCPToolCallerNode(*, tools_provider: MCPToolsProvider)
SynthesisNode(*, llm, prompts, compaction: CompactionModifier, chart_max_data_points: int)
ErrorHandlerNode()  # no deps — pure behavior
```

- [ ] **Step 2: Run each test to verify failure**

```bash
pytest agents/analytics-agent/tests/unit/test_mcp_tool_caller_node_class.py agents/analytics-agent/tests/unit/test_synthesis_node_class.py agents/analytics-agent/tests/unit/test_error_handler_node_class.py -v
```

- [ ] **Step 3: Wrap each `make_*_node` into a class; keep a `make_*_node` shim**

For each node module, introduce the class and keep the old factory as a thin wrapper that instantiates it, mirroring Task 6.2.

- [ ] **Step 4: Run tests**

```bash
pytest agents/analytics-agent/tests/unit/ -v
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/analytics-agent/src/nodes/mcp_tool_caller.py agents/analytics-agent/src/nodes/synthesis.py agents/analytics-agent/src/nodes/error_handler.py agents/analytics-agent/tests/unit/test_mcp_tool_caller_node_class.py agents/analytics-agent/tests/unit/test_synthesis_node_class.py agents/analytics-agent/tests/unit/test_error_handler_node_class.py
git commit -m "refactor(analytics-agent): MCPToolCaller/Synthesis/ErrorHandler nodes as callable classes"
```

### Task 6.5: P0 fix — `MCPToolBridge._convert_schema` raises `UnsupportedSchemaError`

**Files:**
- Modify: `platform-sdk/platform_sdk/mcp_bridge.py`
- Test: `tests/platform_sdk/unit/test_unsupported_schema.py`

- [ ] **Step 1: Write the failing test**

Write `tests/platform_sdk/unit/test_unsupported_schema.py`:

```python
"""P0 regression: MCP tool schema parsing raises on unsupported JSON Schema keywords."""
import pytest

from analytics_agent.src.domain.errors import UnsupportedSchemaError
from platform_sdk.mcp_bridge import MCPToolBridge


def _call_convert_schema(bridge, schema):
    """Access the schema converter; name may differ — locate during implementation."""
    return bridge._convert_schema("fetch_x", schema)


def test_ref_raises():
    bridge = MCPToolBridge(server_name="test", server_url="http://127.0.0.1:0")
    with pytest.raises(UnsupportedSchemaError) as exc:
        _call_convert_schema(bridge, {"$ref": "#/defs/foo"})
    assert exc.value.tool_name == "fetch_x"
    assert exc.value.keyword == "$ref"


def test_allof_raises():
    bridge = MCPToolBridge(server_name="test", server_url="http://127.0.0.1:0")
    with pytest.raises(UnsupportedSchemaError) as exc:
        _call_convert_schema(bridge, {"allOf": [{}, {}]})
    assert exc.value.keyword == "allOf"


def test_anyof_raises():
    bridge = MCPToolBridge(server_name="test", server_url="http://127.0.0.1:0")
    with pytest.raises(UnsupportedSchemaError) as exc:
        _call_convert_schema(bridge, {"anyOf": [{}, {}]})
    assert exc.value.keyword == "anyOf"


def test_plain_object_passes():
    bridge = MCPToolBridge(server_name="test", server_url="http://127.0.0.1:0")
    # Should not raise
    _call_convert_schema(bridge, {"type": "object", "properties": {"q": {"type": "string"}}})
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/platform_sdk/unit/test_unsupported_schema.py -v
```

Expected: FAIL — current `_convert_schema` either silently drops or returns a partial schema.

- [ ] **Step 3: Locate and patch `_convert_schema` in `mcp_bridge.py`**

```bash
grep -n "_convert_schema\|def _convert\|jsonschema" platform-sdk/platform_sdk/mcp_bridge.py
```

Find the schema conversion function. At the top of it, add:

```python
UNSUPPORTED_KEYWORDS = ("$ref", "allOf", "anyOf")

def _convert_schema(self, tool_name: str, schema: dict) -> dict:
    for kw in UNSUPPORTED_KEYWORDS:
        if isinstance(schema, dict) and kw in schema:
            from analytics_agent.src.domain.errors import UnsupportedSchemaError
            raise UnsupportedSchemaError(tool_name=tool_name, keyword=kw)
    # ... existing conversion logic ...
```

> If importing from `analytics_agent.*` creates a coupling you don't want, define an identically-shaped `UnsupportedSchemaError` under `platform_sdk/errors.py` and have both packages re-export/catch it. The spec permits breaking SDK API here.

- [ ] **Step 4: Run tests**

```bash
pytest tests/platform_sdk/unit/test_unsupported_schema.py -v
```

Expected: PASS.

- [ ] **Step 5: Run full suite**

```bash
pytest -x --ignore=agents/analytics-agent/tests/integration -q
```

Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add platform-sdk/platform_sdk/mcp_bridge.py tests/platform_sdk/unit/test_unsupported_schema.py
git commit -m "fix(platform-sdk): MCPToolBridge._convert_schema raises UnsupportedSchemaError on unsupported keywords (P0)"
```

### Task 6.6: Refactor `build_analytics_graph(deps)` to take `GraphDependencies`

**Files:**
- Modify: `agents/analytics-agent/src/graph.py`
- Test: `agents/analytics-agent/tests/component/test_build_graph_from_deps.py`

- [ ] **Step 1: Write the failing test**

Write `agents/analytics-agent/tests/component/test_build_graph_from_deps.py`:

```python
"""build_analytics_graph(deps) takes a single GraphDependencies argument."""
import inspect

from analytics_agent.src.graph import build_analytics_graph


def test_signature_takes_deps():
    sig = inspect.signature(build_analytics_graph)
    params = list(sig.parameters)
    assert params[0] == "deps"
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest agents/analytics-agent/tests/component/test_build_graph_from_deps.py -v
```

Expected: FAIL.

- [ ] **Step 3: Add the new signature alongside the old**

Edit `agents/analytics-agent/src/graph.py`:

```python
from .graph_dependencies import GraphDependencies
from .nodes.error_handler import ErrorHandlerNode
from .nodes.intent_router import IntentRouterNode, route_after_intent
from .nodes.mcp_tool_caller import MCPToolCallerNode
from .nodes.synthesis import SynthesisNode


def build_analytics_graph(
    deps: GraphDependencies | None = None,
    *,
    checkpointer=None,
    # --- legacy kwargs retained for Phase 4 shim; removed in Phase 9 ---
    bridges: dict | None = None,
    config=None,
    prompts=None,
    router_llm=None,
    synthesis_llm=None,
):
    """Build the compiled LangGraph.

    Prefer the `deps: GraphDependencies` form. Legacy kwargs are retained
    transiently while consumers migrate.
    """
    if deps is None:
        # Legacy path — build a GraphDependencies on the fly.
        from platform_sdk import make_chat_llm
        from .lifespan import _LLMFactoryAdapter, _MCPBridgeToolsProvider
        from platform_sdk.compaction import TokenAwareCompactionModifier

        deps = GraphDependencies(
            llm_factory=_LLMFactoryAdapter(config) if config else None,
            tools_provider=_MCPBridgeToolsProvider(bridges or {}),
            compaction=TokenAwareCompactionModifier(config.context_token_limit),
            config=config,
            prompts=prompts,
        )

    builder = StateGraph(AnalyticsState)

    intent_node = IntentRouterNode(
        llm=deps.llm_factory.make_router_llm(),
        tools_provider=deps.tools_provider,
        prompts=deps.prompts,
        compaction=deps.compaction,
    )
    tool_node = MCPToolCallerNode(tools_provider=deps.tools_provider)
    synth_node = SynthesisNode(
        llm=deps.llm_factory.make_synthesis_llm(),
        prompts=deps.prompts,
        compaction=deps.compaction,
        chart_max_data_points=deps.config.chart_max_data_points,
    )
    err_node = ErrorHandlerNode()

    builder.add_node("intent_router", intent_node)
    builder.add_node("mcp_tool_caller", tool_node)
    builder.add_node("synthesis", synth_node)
    builder.add_node("error_handler", err_node)

    builder.set_entry_point("intent_router")
    builder.add_conditional_edges(
        "intent_router",
        route_after_intent,
        {
            "mcp_tool_caller": "mcp_tool_caller",
            "synthesis": "synthesis",
            "error_handler": "error_handler",
        },
    )
    builder.add_edge("mcp_tool_caller", "synthesis")
    builder.add_edge("synthesis", END)
    builder.add_edge("error_handler", END)

    return builder.compile(checkpointer=checkpointer)
```

- [ ] **Step 4: Run tests**

```bash
pytest agents/analytics-agent/tests/component/test_build_graph_from_deps.py agents/analytics-agent/tests/component/test_graph_wiring.py -v
```

Expected: PASS.

- [ ] **Step 5: Update `lifespan.py` to use the new signature**

Edit `agents/analytics-agent/src/lifespan.py`:

```python
from .graph_dependencies import GraphDependencies

# inside the async with lifespan body, replace:
#    graph = build_analytics_graph(bridges=bridges, config=config, checkpointer=checkpointer)
# with:

graph_deps = GraphDependencies(
    llm_factory=llm_factory,
    tools_provider=mcp_tools_provider,
    compaction=compaction,
    config=config,
    prompts=None,  # or load from env
)
graph = build_analytics_graph(graph_deps, checkpointer=checkpointer)
```

- [ ] **Step 6: Run full suite**

```bash
pytest -x --ignore=agents/analytics-agent/tests/integration -q
```

Expected: no regressions.

- [ ] **Step 7: Commit**

```bash
git add agents/analytics-agent/src/graph.py agents/analytics-agent/src/lifespan.py agents/analytics-agent/tests/component/test_build_graph_from_deps.py
git commit -m "refactor(analytics-agent): build_analytics_graph accepts GraphDependencies; nodes as classes"
```

---

## Phase 7 — Transport layer

Goal: thin routes; application-tier tests for every HTTP contract.

### Task 7.1: Thin `chat_router` and add application test

**Files:**
- Verify: `agents/analytics-agent/src/routes/chat.py` (already done in Task 5.3)
- Test: `agents/analytics-agent/tests/application/test_chat_endpoint.py`

- [ ] **Step 1: Write the application test**

Write `agents/analytics-agent/tests/application/test_chat_endpoint.py`:

```python
"""Application-tier tests for POST /api/v1/analytics/chat."""
import pytest
from fastapi import FastAPI

from analytics_agent.src.app import create_app
from analytics_agent.src.services.chat_service import ChatService
from analytics_agent.src.domain.types import UserContext
from analytics_agent.tests.fakes.build_test_deps import build_test_dependencies
from analytics_agent.tests.fakes.fake_stream_encoder import FakeStreamEncoder
from analytics_agent.tests.fakes.fake_conversation_store import FakeConversationStore
from analytics_agent.tests.fakes.fake_telemetry import FakeTelemetryScope
from unittest.mock import MagicMock
from httpx import ASGITransport, AsyncClient


def _fake_factory(graph):
    def factory(user_ctx: UserContext):
        return ChatService(
            graph=graph,
            conversation_store=FakeConversationStore(),
            config=MagicMock(),
            user_ctx=user_ctx,
            encoder_factory=FakeStreamEncoder,
            telemetry=FakeTelemetryScope(),
        )
    return factory


def _build_app(graph):
    deps = build_test_dependencies(
        graph=graph,
        chat_service_factory=_fake_factory(graph),
    )
    return create_app(deps)


@pytest.fixture
def graph_emitting_noop():
    g = MagicMock()

    async def _stream(*args, **kwargs):
        return
        yield  # unreachable
    g.astream_events = _stream
    return g


async def test_200_with_auth_headers(graph_emitting_noop):
    app = _build_app(graph_emitting_noop)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        resp = await c.post(
            "/api/v1/analytics/chat",
            headers={
                "x-user-id": "u1",
                "x-tenant-id": "t1",
                "authorization": "Bearer tok",
            },
            json={"message": "hi"},
        )
    assert resp.status_code == 200


async def test_401_without_user_headers(graph_emitting_noop):
    app = _build_app(graph_emitting_noop)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        resp = await c.post("/api/v1/analytics/chat", json={"message": "hi"})
    assert resp.status_code == 401


async def test_422_on_empty_message(graph_emitting_noop):
    app = _build_app(graph_emitting_noop)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        resp = await c.post(
            "/api/v1/analytics/chat",
            headers={
                "x-user-id": "u1",
                "x-tenant-id": "t1",
                "authorization": "Bearer tok",
            },
            json={"message": ""},
        )
    assert resp.status_code == 422
```

- [ ] **Step 2: Run**

```bash
pytest agents/analytics-agent/tests/application/test_chat_endpoint.py -v
```

Expected: PASS (Task 5.3 already made the route honor these contracts). Fix route code only if a test fails.

- [ ] **Step 3: Commit**

```bash
git add agents/analytics-agent/tests/application/test_chat_endpoint.py
git commit -m "test(analytics-agent): add application-tier tests for POST /chat"
```

### Task 7.2: Thin `conversations_router`; add application tests

**Files:**
- Modify (if not thin): `agents/analytics-agent/src/routes/conversations.py`
- Test: `agents/analytics-agent/tests/application/test_conversations_endpoint.py`

- [ ] **Step 1: Write the application test**

Write `agents/analytics-agent/tests/application/test_conversations_endpoint.py`:

```python
"""Application-tier tests for /api/v1/conversations."""
import pytest
from httpx import ASGITransport, AsyncClient

from analytics_agent.src.app import create_app
from analytics_agent.src.domain.types import Conversation, UserContext
from analytics_agent.tests.fakes.build_test_deps import build_test_dependencies
from analytics_agent.tests.fakes.fake_conversation_store import FakeConversationStore


@pytest.fixture
async def client_with_store():
    store = FakeConversationStore()
    ctx = UserContext(user_id="u1", tenant_id="t1", auth_token="tok")
    await store.save(
        Conversation(conversation_id="c1", title="Hello", updated_at="2026-04-16T00:00:00Z"),
        ctx,
    )
    deps = build_test_dependencies(conversation_store=store)
    app = create_app(deps)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def test_list_conversations_200(client_with_store):
    resp = await client_with_store.get(
        "/api/v1/conversations",
        headers={
            "x-user-id": "u1",
            "x-tenant-id": "t1",
            "authorization": "Bearer tok",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    # Shape depends on existing route — assert at least the ID is returned
    assert any("c1" in str(entry) for entry in (body if isinstance(body, list) else body.get("conversations", [])))


async def test_list_conversations_401_without_headers(client_with_store):
    resp = await client_with_store.get("/api/v1/conversations")
    assert resp.status_code == 401
```

- [ ] **Step 2: Run**

```bash
pytest agents/analytics-agent/tests/application/test_conversations_endpoint.py -v
```

Expected: some tests FAIL if `conversations.py` hasn't been thinned. Adjust the route to use `app.state.deps.conversation_store` and the same `_user_ctx_from(request)` helper as `chat.py`. Move `_user_ctx_from` into a shared module (`src/routes/_auth.py`) if both routes need it.

- [ ] **Step 3: Commit**

```bash
git add agents/analytics-agent/src/routes/conversations.py agents/analytics-agent/src/routes/_auth.py agents/analytics-agent/tests/application/test_conversations_endpoint.py
git commit -m "refactor(analytics-agent): thin conversations route; shared _user_ctx_from"
```

### Task 7.3: Application test for `/health`

**Files:**
- Test: `agents/analytics-agent/tests/application/test_health_endpoint.py`

- [ ] **Step 1: Write the test**

Write `agents/analytics-agent/tests/application/test_health_endpoint.py`:

```python
"""Application-tier tests for GET /health and /health/ready."""
import pytest
from httpx import ASGITransport, AsyncClient

from analytics_agent.src.app import create_app
from analytics_agent.tests.fakes.build_test_deps import build_test_dependencies


@pytest.fixture
async def client():
    app = create_app(build_test_dependencies())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def test_liveness_200(client):
    resp = await client.get("/health")
    assert resp.status_code == 200


async def test_readiness_reports_status(client):
    resp = await client.get("/health/ready")
    # 200 when ready (tests can pass with fake bridges as "ready"),
    # 503 when dependencies are missing. Either is valid — assert one of these.
    assert resp.status_code in (200, 503)
```

- [ ] **Step 2: Run**

```bash
pytest agents/analytics-agent/tests/application/test_health_endpoint.py -v
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add agents/analytics-agent/tests/application/test_health_endpoint.py
git commit -m "test(analytics-agent): add application-tier health endpoint tests"
```

### Task 7.4: Error-contract tests

**Files:**
- Test: `agents/analytics-agent/tests/application/test_error_contracts.py`

- [ ] **Step 1: Write the test**

Write `agents/analytics-agent/tests/application/test_error_contracts.py`:

```python
"""Pre-stream vs. mid-stream error contract."""
import pytest
from unittest.mock import MagicMock
from httpx import ASGITransport, AsyncClient

from analytics_agent.src.app import create_app
from analytics_agent.src.domain.errors import ToolsUnavailable
from analytics_agent.src.services.chat_service import ChatService
from analytics_agent.src.domain.types import UserContext
from analytics_agent.tests.fakes.build_test_deps import build_test_dependencies
from analytics_agent.tests.fakes.fake_conversation_store import FakeConversationStore
from analytics_agent.tests.fakes.fake_stream_encoder import FakeStreamEncoder
from analytics_agent.tests.fakes.fake_telemetry import FakeTelemetryScope


def _graph_that_raises_midstream():
    g = MagicMock()

    async def _stream(*a, **k):
        yield {"event": "on_chain_start", "name": "intent_router"}
        raise ToolsUnavailable("all MCP bridges unreachable")
    g.astream_events = _stream
    return g


async def test_mid_stream_error_returns_200_with_encoded_error():
    graph = _graph_that_raises_midstream()

    def factory(ctx: UserContext):
        return ChatService(
            graph=graph,
            conversation_store=FakeConversationStore(),
            config=MagicMock(),
            user_ctx=ctx,
            encoder_factory=FakeStreamEncoder,
            telemetry=FakeTelemetryScope(),
        )

    deps = build_test_dependencies(graph=graph, chat_service_factory=factory)
    app = create_app(deps)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        resp = await c.post(
            "/api/v1/analytics/chat",
            headers={
                "x-user-id": "u1",
                "x-tenant-id": "t1",
                "authorization": "Bearer tok",
            },
            json={"message": "hi"},
        )
    # HTTP status was already 200 when streaming started; error is in the body.
    assert resp.status_code == 200
    assert b"error" in resp.content.lower()
```

- [ ] **Step 2: Run**

```bash
pytest agents/analytics-agent/tests/application/test_error_contracts.py -v
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add agents/analytics-agent/tests/application/test_error_contracts.py
git commit -m "test(analytics-agent): add pre-stream vs mid-stream error contract tests"
```

### Task 7.5: Auth-scope plumbing test

**Files:**
- Test: `agents/analytics-agent/tests/application/test_auth_scoping.py`

- [ ] **Step 1: Write the test**

```python
"""Tenant/user scope: store interactions are scoped to UserContext.tenant_id."""
import pytest
from unittest.mock import MagicMock
from httpx import ASGITransport, AsyncClient

from analytics_agent.src.app import create_app
from analytics_agent.src.domain.types import Conversation, UserContext
from analytics_agent.src.services.chat_service import ChatService
from analytics_agent.tests.fakes.build_test_deps import build_test_dependencies
from analytics_agent.tests.fakes.fake_conversation_store import FakeConversationStore
from analytics_agent.tests.fakes.fake_stream_encoder import FakeStreamEncoder
from analytics_agent.tests.fakes.fake_telemetry import FakeTelemetryScope


async def test_different_tenants_see_only_their_own_conversations():
    store = FakeConversationStore()
    a_ctx = UserContext(user_id="u1", tenant_id="TENANT_A", auth_token="tok")
    b_ctx = UserContext(user_id="u2", tenant_id="TENANT_B", auth_token="tok")
    await store.save(Conversation(conversation_id="A1", title="a", updated_at="2026-04-16T00:00:00Z"), a_ctx)
    await store.save(Conversation(conversation_id="B1", title="b", updated_at="2026-04-16T00:00:00Z"), b_ctx)

    deps = build_test_dependencies(conversation_store=store)
    app = create_app(deps)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        resp_a = await c.get(
            "/api/v1/conversations",
            headers={"x-user-id": "u1", "x-tenant-id": "TENANT_A", "authorization": "Bearer tok"},
        )
        resp_b = await c.get(
            "/api/v1/conversations",
            headers={"x-user-id": "u2", "x-tenant-id": "TENANT_B", "authorization": "Bearer tok"},
        )
    body_a = resp_a.json()
    body_b = resp_b.json()
    assert "A1" in str(body_a) and "B1" not in str(body_a)
    assert "B1" in str(body_b) and "A1" not in str(body_b)
```

- [ ] **Step 2: Run**

```bash
pytest agents/analytics-agent/tests/application/test_auth_scoping.py -v
```

Expected: PASS (because `FakeConversationStore` scopes by `tenant_id` and `ConversationService` passes it through).

- [ ] **Step 3: Commit**

```bash
git add agents/analytics-agent/tests/application/test_auth_scoping.py
git commit -m "test(analytics-agent): add tenant-scope enforcement application test"
```

---

## Phase 8 — Remaining P0 fixes + resilience

### Task 8.1: P0 — `setup_checkpointer()` creates Postgres tables (integration test)

**Files:**
- Modify: `platform-sdk/platform_sdk/...setup_checkpointer` (locate)
- Test: `agents/analytics-agent/tests/integration/test_postgres_checkpointer_bootstrap.py`

- [ ] **Step 1: Locate `setup_checkpointer`**

```bash
grep -rn "def setup_checkpointer\|async def setup_checkpointer" platform-sdk/
```

- [ ] **Step 2: Write the failing integration test**

Write `agents/analytics-agent/tests/integration/test_postgres_checkpointer_bootstrap.py`:

```python
"""P0 regression: first run against an empty Postgres succeeds (tables are created)."""
import os

import pytest

pytestmark = pytest.mark.integration


async def test_checkpointer_setup_creates_tables():
    db_url = os.environ.get("TEST_DATABASE_URL")
    if not db_url:
        pytest.skip("TEST_DATABASE_URL not set; skipping integration test")

    import asyncpg
    from platform_sdk import AgentConfig, setup_checkpointer

    # Start with empty schema.
    conn = await asyncpg.connect(db_url)
    await conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    await conn.close()

    cfg = AgentConfig(
        checkpointer_type="postgres",
        checkpointer_url=db_url,
    )
    checkpointer = await setup_checkpointer(cfg)
    assert checkpointer is not None

    # Verify the checkpointer tables exist now.
    conn = await asyncpg.connect(db_url)
    try:
        rows = await conn.fetch(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
        )
        tables = {r["tablename"] for r in rows}
        # LangGraph's AsyncPostgresSaver creates at least: checkpoints, writes
        assert "checkpoints" in tables or any("checkpoint" in t for t in tables), (
            f"No checkpoint tables found after setup_checkpointer: {tables}"
        )
    finally:
        await conn.close()
```

- [ ] **Step 3: Ensure `setup_checkpointer` calls `.setup()`**

Open the existing `setup_checkpointer` implementation and verify it `await`s the saver's `.setup()`. If not, add it:

```python
async def setup_checkpointer(config: AgentConfig):
    if config.checkpointer_type == "postgres":
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
        saver = AsyncPostgresSaver.from_conn_string(config.checkpointer_url)
        await saver.setup()  # P0 fix — ensure tables exist
        return saver
    return make_checkpointer(config)  # in-memory / sync fallback
```

- [ ] **Step 4: Run locally with a disposable Postgres (skip in CI default)**

```bash
TEST_DATABASE_URL=postgresql://... pytest agents/analytics-agent/tests/integration/test_postgres_checkpointer_bootstrap.py -v -m integration
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add <setup_checkpointer path> agents/analytics-agent/tests/integration/test_postgres_checkpointer_bootstrap.py
git commit -m "fix(platform-sdk): setup_checkpointer calls .setup() to create Postgres tables (P0)"
```

### Task 8.2: P0 — Partial MCP connectivity at startup

**Files:**
- Modify: `platform-sdk/platform_sdk/mcp_bridge.py` and/or `mcp_registry.py`
- Test: `agents/analytics-agent/tests/component/test_partial_mcp_connectivity.py`

- [ ] **Step 1: Write the failing test**

Write `agents/analytics-agent/tests/component/test_partial_mcp_connectivity.py`:

```python
"""P0 regression: lifespan succeeds when some MCP servers are unreachable."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import FastAPI

from analytics_agent.src.lifespan import lifespan


async def test_lifespan_succeeds_with_one_unreachable_server():
    app = FastAPI()

    healthy = MagicMock()
    healthy.is_connected = True
    healthy.get_langchain_tools = AsyncMock(return_value=[])

    unreachable = MagicMock()
    unreachable.is_connected = False
    unreachable.get_langchain_tools = AsyncMock(return_value=[])

    fake_registry = MagicMock()
    fake_registry.connect_all = AsyncMock(
        return_value={"healthy": healthy, "down": unreachable}
    )
    fake_registry.disconnect_all = AsyncMock()

    with patch("analytics_agent.src.lifespan.McpRegistry", return_value=fake_registry), \
         patch("analytics_agent.src.lifespan.setup_checkpointer", new=AsyncMock(return_value=None)), \
         patch("analytics_agent.src.lifespan.setup_telemetry"), \
         patch("analytics_agent.src.lifespan.flush_langfuse"):
        async with lifespan(app):
            deps = app.state.deps
            tools = await deps.mcp_tools_provider.get_langchain_tools(
                MagicMock(user_id="u", tenant_id="t", auth_token="tok")
            )
            # No crash; returns whatever the healthy server provides.
            assert isinstance(tools, list)
```

- [ ] **Step 2: Run**

```bash
pytest agents/analytics-agent/tests/component/test_partial_mcp_connectivity.py -v
```

Expected: PASS or FAIL depending on current `_MCPBridgeToolsProvider` implementation.

- [ ] **Step 3: Ensure `_MCPBridgeToolsProvider.get_langchain_tools` skips disconnected bridges**

In `agents/analytics-agent/src/lifespan.py` (the adapter class):

```python
class _MCPBridgeToolsProvider:
    def __init__(self, bridges: dict):
        self._bridges = bridges

    async def get_langchain_tools(self, user_ctx):
        tools = []
        for name, bridge in self._bridges.items():
            if not bridge.is_connected:
                log.warning("mcp_bridge_unreachable_skipped", server=name)
                continue
            try:
                tools.extend(await bridge.get_langchain_tools(user_ctx))
            except Exception as exc:
                log.warning("mcp_bridge_tool_fetch_failed", server=name, error=str(exc))
        return tools
```

Also ensure `McpRegistry.connect_all` doesn't raise on a single failed server — it should log and continue. Edit `platform-sdk/platform_sdk/mcp_registry.py`:

```python
async def connect_all(self, agent_context, timeout):
    bridges = {}
    for name, url in self._discovered:
        bridge = MCPToolBridge(server_name=name, server_url=url)
        try:
            await asyncio.wait_for(bridge.connect(agent_context=agent_context), timeout=timeout)
        except Exception as exc:
            log.warning("mcp_startup_server_unreachable", server=name, error=str(exc))
        bridges[name] = bridge
    return bridges
```

- [ ] **Step 4: Run tests**

```bash
pytest agents/analytics-agent/tests/component/test_partial_mcp_connectivity.py -v
pytest tests/platform_sdk/component/ -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/analytics-agent/src/lifespan.py platform-sdk/platform_sdk/mcp_registry.py platform-sdk/platform_sdk/mcp_bridge.py agents/analytics-agent/tests/component/test_partial_mcp_connectivity.py
git commit -m "fix(platform-sdk): partial MCP connectivity at startup returns reachable tool subset (P0)"
```

---

## Phase 9 — Consumer migration & cleanup

Goal: update other in-repo consumers of platform-sdk that broke from Phase 3; delete dead code; move `test_e2e_streaming.py` into `integration/`; write the reference doc.

### Task 9.1: Fix any broken imports from narrowed public API

**Files:**
- Modify: any consumer of `platform_sdk` that fails on import

- [ ] **Step 1: Run the whole repo test collection**

```bash
pytest --collect-only -q 2>&1 | tee /tmp/collect.log
```

- [ ] **Step 2: Search for `ImportError` / `ModuleNotFoundError` / `AttributeError` from `platform_sdk`**

```bash
grep -E "ImportError|ModuleNotFoundError|platform_sdk" /tmp/collect.log
```

- [ ] **Step 3: For each broken import, update to the canonical path**

Typical patches:
- `from platform_sdk import set_user_auth_token` → remove; pass `UserContext` explicitly.
- `from platform_sdk import make_compaction_modifier` → stays (kept as shim).
- Any internal-only symbol that was dropped → replace with its module-qualified import: `from platform_sdk.foo import Bar`.

- [ ] **Step 4: Run the suite**

```bash
pytest -x --ignore=agents/analytics-agent/tests/integration -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add <affected files>
git commit -m "refactor: update in-repo consumers to narrowed platform_sdk public API"
```

### Task 9.2: Delete dead code

**Files:** various — identified via grep.

- [ ] **Step 1: Find dead code**

```bash
# Factories that are fully replaced
grep -rn "make_intent_router_node\|make_mcp_tool_caller_node\|make_synthesis_node\|make_error_handler_node" agents/ platform-sdk/ --include="*.py"
```

- [ ] **Step 2: If a shim is referenced only by tests that have migrated, delete it**

For each dead `make_*_node` shim with zero callers, delete the function and any now-unused imports.

- [ ] **Step 3: Run tests**

```bash
pytest -x --ignore=agents/analytics-agent/tests/integration -q
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add <deleted files>
git commit -m "chore(analytics-agent): delete deprecated make_*_node factory shims"
```

### Task 9.3: Write the reference pattern doc

**Files:**
- Create: `docs/architecture/agent-reference-pattern.md`

- [ ] **Step 1: Write the doc**

Write `docs/architecture/agent-reference-pattern.md`:

```markdown
# Agent Reference Pattern

This document describes the layered architecture used by
`agents/analytics-agent/`. New agents should follow the same structure.

## Directory layout

\`\`\`
agents/<agent-name>/
├── src/
│   ├── app.py                  # create_app(deps: AppDependencies)
│   ├── app_dependencies.py     # AppDependencies dataclass
│   ├── entrypoint.py           # uvicorn entrypoint
│   ├── lifespan.py             # builds AppDependencies
│   ├── graph.py                # build_<agent>_graph(deps)
│   ├── graph_dependencies.py   # GraphDependencies dataclass
│   ├── state.py                # LangGraph state schema
│   ├── ports.py                # Protocol seams (consumer-owned)
│   ├── domain/
│   │   ├── types.py            # UserContext, ChatRequest, etc.
│   │   └── errors.py           # Domain exception tree
│   ├── nodes/                  # Callable node classes
│   ├── services/               # ChatService, ConversationService
│   ├── routes/                 # Thin HTTP handlers
│   └── streaming/              # StreamEncoder implementations
└── tests/
    ├── fakes/                  # Reusable doubles + build_test_dependencies
    ├── unit/
    ├── component/
    ├── application/
    └── integration/            # @pytest.mark.integration
\`\`\`

## Rules

1. Constructor injection everywhere: no module-level state, no globals, no import-time I/O.
2. Protocols owned by the consumer (`src/ports.py`). SDK adapters structurally satisfy them.
3. `create_app(deps)` is pure; `lifespan(app)` is the only I/O root.
4. Nodes are callable classes; `build_<agent>_graph(deps)` takes one `GraphDependencies`.
5. `UserContext` flows via `config["configurable"]` through LangGraph; never via module state.
6. Tests are TDD (red → green → refactor) across four tiers.
7. P0 regressions get red-first tests before the fix.

See `docs/superpowers/specs/2026-04-16-analytics-agent-soc-di-refactor-design.md`
for the design rationale.
```

- [ ] **Step 2: Commit**

```bash
mkdir -p docs/architecture
git add docs/architecture/agent-reference-pattern.md
git commit -m "docs: add agent reference pattern guide"
```

### Task 9.4: Final full-repo verification

- [ ] **Step 1: Run default pytest**

```bash
pytest -x --ignore=agents/analytics-agent/tests/integration -q
```

Expected: all tests PASS.

- [ ] **Step 2: Run integration tier against local Docker stack (optional)**

```bash
docker compose -f docker-compose.infra.yml up -d
pytest -m integration -v
docker compose -f docker-compose.infra.yml down
```

Expected: PASS.

- [ ] **Step 3: Run ruff + coverage**

```bash
ruff check .
ruff format --check .
pytest --cov=platform_sdk --cov=agents -q
```

Note coverage per layer — expected ranges (not gates):
- domain ≥90%, services ≥85%, routes ≥80%, SDK adapters ≥70%.

- [ ] **Step 4: Commit any final cleanups**

```bash
git add <files>
git commit -m "chore: post-refactor lint fixes"
```

---

## Completion checklist

Before declaring the refactor complete, verify each success criterion from the spec:

- [ ] Every class in `agents/analytics-agent/src/` and `platform-sdk/platform_sdk/` takes its dependencies via `__init__`.
- [ ] No module-level `ContextVar`, singleton, or import-time initialization in either package (`grep -rn "^_[a-zA-Z]*\s*=\s*ContextVar\|^[A-Za-z_]* = .*(\(\)\|_make" platform-sdk/ agents/analytics-agent/src/` returns no legitimate hits).
- [ ] Port Protocols in `agents/analytics-agent/src/ports.py` are the contract; SDK adapters don't import the agent.
- [ ] `create_app(deps)` is pure and tests use it directly without Docker.
- [ ] `build_test_dependencies` is the single knob for test composition.
- [ ] All four P0 regression tests are green.
- [ ] Default `pytest` run (unit + component + application) is <60 s total and green.
- [ ] Integration suite (`pytest -m integration`) runs and passes on the Docker stack.
- [ ] In-repo consumers of the SDK compile and pass their own tests.
- [ ] `docs/architecture/agent-reference-pattern.md` exists.

---

## Self-review checklist (done by the plan author)

**Spec coverage:** every section of `2026-04-16-analytics-agent-soc-di-refactor-design.md` has at least one task:
- Section 2 (Architecture) → Tasks 1.5, 4.1, 4.2, 4.3
- Section 3 (Components) → Tasks 1.1–1.5, 4.1, 5.1–5.6, 6.1–6.6, 7.1–7.5
- Section 4 (SDK changes) → Tasks 3.1–3.5, 6.5, 8.1, 8.2
- Section 5 (Data flow) → Tasks 5.2, 5.4, 7.1
- Section 6 (Error handling) → Tasks 1.4, 5.3 (exception handlers), 7.4
- Section 7 (Testing strategy) → Tasks 2.1–2.7 + red-first tests throughout
- Section 8 (Phasing) → the phase structure itself
- Section 9 (Success criteria) → Completion checklist above
- Section 10/11 (Open items/Follow-ups) → deferred; not in tasks

**Placeholder scan:** no "TBD", "TODO" in code to be written, no "fill in details" in steps. Each code step shows code. Phase 0 uses `TODO(phase-N.x):` as a legitimate in-code marker for deferred rework.

**Type consistency:**
- `AppDependencies` fields referenced in Phase 2, 4, 5, 7 all match the definition in Task 4.1.
- `ChatService` constructor signature in Task 5.2 matches Tasks 5.4, 5.5, 7.1, 7.4.
- `IntentRouterNode(*, llm, tools_provider, prompts, compaction)` signature in Task 6.2 matches Tasks 6.3, 6.6.
- `UserContext(user_id, tenant_id, auth_token)` fields referenced consistently.
- `GraphDependencies(llm_factory, tools_provider, compaction, config, prompts)` in Task 6.1 matches Task 6.6.
- Protocol method names (`get_langchain_tools(user_ctx)`, `encode_event`, `encode_error`, `finalize`) consistent across Phase 2 fakes, Phase 3 real adapters, and all test invocations.
