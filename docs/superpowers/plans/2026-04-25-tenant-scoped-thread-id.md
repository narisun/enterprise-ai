# Tenant-Scoped LangGraph `thread_id` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate cross-user/cross-tenant LangGraph checkpoint leakage by deriving the `thread_id` server-side from the authenticated `(user_email, session_id)` pair instead of trusting the client-supplied `session_id`.

**Architecture:**
1. New helper module `agents/analytics-agent/src/thread_id.py` exporting one pure function `make_thread_id(user_email, session_id) -> str`. Single source of truth, easy to unit-test, no side effects.
2. Both `POST /api/v1/analytics/chat` and `POST /api/v1/analytics/stream` call the helper; both endpoints extract `X-User-Email` from headers (today only `/chat` does).
3. Six unit tests for the helper plus two endpoint tests that prove cross-user isolation: same `session_id` + different `X-User-Email` headers must produce different `thread_id` values.

**Tech Stack:** FastAPI, LangGraph (`astream_events`), pytest, pytest-asyncio, FastAPI `TestClient` with `app.dependency_overrides` for auth/rate-limit and direct `app.state.graph` injection (matches existing pattern in `test_e2e_streaming.py`).

**Threat addressed (P0 security):** today, `app.py:236` and `app.py:456` set `"configurable": {"thread_id": request.session_id}`. If two users from different tenants ever collide on a session UUID (federated auth replay, SSO realm overlap, or simple UUID collision in a long-lived deployment), they read/write the same checkpoint thread — full conversation-history exposure across the tenant boundary.

**Why a separate phase from the SoC/DI refactor:** the SoC/DI spec already moves `UserContext` into the LangGraph `RunnableConfig`, but it does **not** specify tenant-namespacing of the checkpoint thread itself. This plan is the minimum, targeted fix — pure addition of a helper plus two two-line edits in the endpoints — and it lands today, not after the multi-phase refactor.

**Key invariants:**
- `make test-unit` stays at `60 passed, 0 failed`.
- `pytest agents/analytics-agent/tests/` failure count must NOT exceed the pre-task baseline of `13 failed`. Passing count grows by 8 (6 helper unit tests + 2 endpoint integration tests).
- No SDK changes — this plan is contained inside `agents/analytics-agent/`.
- No drive-by edits to unrelated parts of `app.py`.

---

## Pre-flight

### Task 0: Establish baseline

**Files:** none (read-only)

- [ ] **Step 1: Confirm working tree state**

```bash
pwd
git status --short
git log -1 --oneline
```
Expected: `pwd` is `/Users/admin-h26/enterprise-ai/.worktrees/pep8-rename`. `git status --short` is empty. `git log -1 --oneline` shows the most recent rename commit.

- [ ] **Step 2: Confirm Phase 0a baseline test results**

```bash
make test-unit 2>&1 | tail -3
.venv/bin/pytest agents/analytics-agent/tests/ -q --no-cov 2>&1 | tail -3
```
Expected: `60 passed, 0 failed` and `13 failed, 28 passed` respectively.

These are the baselines every later task is measured against.

---

## Task 1: Add the `make_thread_id` helper (TDD)

**Files:**
- Create: `agents/analytics-agent/src/thread_id.py`
- Create: `agents/analytics-agent/tests/test_thread_id.py`

- [ ] **Step 1: Write the failing tests**

Create `agents/analytics-agent/tests/test_thread_id.py` with the following content:

```python
"""Unit tests for the tenant-scoped LangGraph thread_id helper."""
import pytest

from src.thread_id import make_thread_id


class TestMakeThreadId:
    """Contract for `make_thread_id(user_email, session_id) -> str`."""

    def test_concatenates_email_and_session_with_colon(self):
        assert make_thread_id("alice@example.com", "abc-123") == "alice@example.com:abc-123"

    def test_normalizes_email_to_lowercase(self):
        # SSO providers and email clients vary on case; the namespace must
        # be insensitive to them so two requests for the same person never
        # accidentally fork into two threads.
        assert make_thread_id("Alice@Example.COM", "abc-123") == "alice@example.com:abc-123"

    def test_strips_surrounding_whitespace_in_email(self):
        assert make_thread_id("  alice@example.com  ", "abc-123") == "alice@example.com:abc-123"

    def test_falls_back_to_anonymous_namespace_when_email_empty(self):
        # Empty / None X-User-Email defaults to a stable "anonymous" namespace
        # so dev and unauthenticated paths get a consistent thread key,
        # never a thread shared across users.
        assert make_thread_id("", "abc-123") == "anonymous:abc-123"
        assert make_thread_id(None, "abc-123") == "anonymous:abc-123"

    def test_different_emails_produce_different_thread_ids(self):
        same_session = "abc-123"
        alice = make_thread_id("alice@example.com", same_session)
        bob = make_thread_id("bob@example.com", same_session)
        assert alice != bob, (
            "Two users sharing a session_id MUST get distinct thread_ids — "
            "this is the core tenant-isolation guarantee."
        )

    def test_raises_on_empty_session_id(self):
        with pytest.raises(ValueError, match="session_id is required"):
            make_thread_id("alice@example.com", "")
```

- [ ] **Step 2: Run tests; confirm RED**

```bash
.venv/bin/pytest agents/analytics-agent/tests/test_thread_id.py -v --no-cov
```
Expected: every test fails at collection time with `ModuleNotFoundError: No module named 'src.thread_id'` (or all tests fail with `ImportError`). The number of failures should be **6**.

- [ ] **Step 3: Implement the helper (minimum to go GREEN)**

Create `agents/analytics-agent/src/thread_id.py` with the following content:

```python
"""Tenant-scoped LangGraph `thread_id` construction.

Derives a server-side thread key from `(user_email, session_id)` so two
users from different tenants cannot collide on the LangGraph
checkpointer even if they happen to share a session UUID. The helper is
deliberately small and pure: no I/O, no logging, no globals — every
caller and test can substitute its own `(email, session_id)` and reason
about the result locally.
"""
from typing import Final

_DEFAULT_USER: Final[str] = "anonymous"


def make_thread_id(user_email: str | None, session_id: str) -> str:
    """Return a tenant-namespaced LangGraph `thread_id`.

    The result is the literal concatenation
    ``"{normalized_email}:{session_id}"``. It is deterministic for a
    given ``(email, session_id)`` pair, and different emails always
    produce different `thread_id` values even when `session_id` is
    identical. Email is lowercased and stripped so SSO/case variations
    do not fork the same user into two threads. An empty or `None`
    email falls back to the literal namespace ``"anonymous"`` so dev
    and unauthenticated paths still get a stable, non-colliding key.

    Args:
        user_email: Authenticated user identity from the
            ``X-User-Email`` header. May be empty or ``None``.
        session_id: Client-supplied conversation thread UUID.

    Returns:
        A string suitable as the LangGraph
        ``configurable.thread_id``.

    Raises:
        ValueError: if ``session_id`` is empty.
    """
    if not session_id:
        raise ValueError("session_id is required")
    email = (user_email or "").strip().lower() or _DEFAULT_USER
    return f"{email}:{session_id}"
```

- [ ] **Step 4: Run tests; confirm GREEN**

```bash
.venv/bin/pytest agents/analytics-agent/tests/test_thread_id.py -v --no-cov
```
Expected: `6 passed`.

- [ ] **Step 5: Verify the wider analytics-agent suite is unaffected**

```bash
.venv/bin/pytest agents/analytics-agent/tests/ -q --no-cov 2>&1 | tail -3
```
Expected: `13 failed, 34 passed` (baseline 13 failed + 28 passed plus 6 new passing).

- [ ] **Step 6: Commit**

```bash
git add agents/analytics-agent/src/thread_id.py agents/analytics-agent/tests/test_thread_id.py
git commit -m "feat(analytics-agent): add tenant-scoped make_thread_id helper

Pure helper that derives a server-side LangGraph thread_id from
(user_email, session_id). Six unit tests cover normalization, the
anonymous fallback, the cross-user-isolation invariant, and the
empty-session_id error.

This is the primitive used in subsequent commits to namespace
LangGraph checkpoints by authenticated user. P0 security fix per
architecture review finding A4."
```

---

## Task 2: Wire `/chat` endpoint to use `make_thread_id` (TDD)

**Files:**
- Create: `agents/analytics-agent/tests/test_thread_id_endpoint.py`
- Modify: `agents/analytics-agent/src/app.py:31-33` (imports), `agents/analytics-agent/src/app.py:455-457` (`/chat` config block)

- [ ] **Step 1: Write the failing endpoint test**

Create `agents/analytics-agent/tests/test_thread_id_endpoint.py` with the following content:

```python
"""Endpoint-level proof that LangGraph thread_id is tenant-scoped.

Bypasses the FastAPI lifespan by injecting a fake graph and a fake
conversation_store directly into `app.state` (same pattern as
`test_e2e_streaming.py::app_with_mocks`), overrides auth and rate-limit
dependencies, and asserts that two requests with the same session_id
but different X-User-Email values arrive at the graph with distinct
`configurable.thread_id` values.
"""
import os
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

# IMPORTANT: set INTERNAL_API_KEY before importing app.py — module-level
# `make_api_key_verifier()` reads the env at request time but the
# dependency_overrides bypass the verifier entirely. We still set it so
# importing app.py doesn't surface unrelated config errors.
os.environ.setdefault("INTERNAL_API_KEY", "test-internal-api-key")

from src.app import app, verify_api_key, check_rate_limit  # noqa: E402


@pytest.fixture
def captured_configs():
    """List that the fake graph appends every received `config` dict to."""
    return []


@pytest.fixture
def client(captured_configs):
    """TestClient with a stub graph + store and overridden auth/rate-limit deps.

    Uses `app.state.X =` injection (no lifespan), exactly as
    `test_e2e_streaming.py::app_with_mocks` does. The /chat endpoint
    reads `app.state.conversation_store` mid-stream to persist messages,
    so we stub it with AsyncMocks. The /stream endpoint does not
    persist, but the same fixture serves both. After the test, all
    overrides are removed so subsequent tests see a clean app.
    """

    async def fake_astream_events(state, config, version):
        captured_configs.append(config)
        # Async generator that yields nothing — the endpoint code path
        # finishes the stream cleanly with no events.
        if False:
            yield  # pragma: no cover

    fake_graph = MagicMock()
    fake_graph.astream_events = fake_astream_events

    fake_store = MagicMock()
    fake_store.get_conversation = AsyncMock(return_value=None)
    fake_store.create_conversation = AsyncMock(return_value=None)
    fake_store.add_message = AsyncMock(return_value=None)

    app.state.graph = fake_graph
    app.state.conversation_store = fake_store

    app.dependency_overrides[verify_api_key] = lambda: "test-token"
    app.dependency_overrides[check_rate_limit] = lambda: None

    yield TestClient(app)

    app.dependency_overrides.clear()


class TestChatEndpointThreadIdIsolation:
    """Cross-user isolation contract for POST /api/v1/analytics/chat."""

    def test_thread_id_includes_user_email(self, client, captured_configs):
        payload = {
            "id": "shared-session-uuid",
            "messages": [{"role": "user", "content": "hi"}],
        }
        client.post(
            "/api/v1/analytics/chat",
            json=payload,
            headers={
                "Authorization": "Bearer test-token",
                "X-User-Email": "alice@example.com",
                "X-User-Role": "manager",
            },
        )
        assert len(captured_configs) == 1
        thread_id = captured_configs[0]["configurable"]["thread_id"]
        assert "alice@example.com" in thread_id
        assert "shared-session-uuid" in thread_id

    def test_two_users_with_same_session_id_get_distinct_thread_ids(
        self, client, captured_configs
    ):
        payload = {
            "id": "shared-session-uuid",
            "messages": [{"role": "user", "content": "hi"}],
        }
        for email in ("alice@example.com", "bob@example.com"):
            client.post(
                "/api/v1/analytics/chat",
                json=payload,
                headers={
                    "Authorization": "Bearer test-token",
                    "X-User-Email": email,
                    "X-User-Role": "manager",
                },
            )

        assert len(captured_configs) == 2
        thread_ids = [c["configurable"]["thread_id"] for c in captured_configs]
        assert thread_ids[0] != thread_ids[1], (
            "Two distinct users with the same session_id MUST get "
            "distinct thread_ids — this is the tenant-isolation guarantee."
        )
        assert "alice@example.com" in thread_ids[0]
        assert "bob@example.com" in thread_ids[1]
```

- [ ] **Step 2: Run the new tests; confirm RED**

```bash
.venv/bin/pytest agents/analytics-agent/tests/test_thread_id_endpoint.py::TestChatEndpointThreadIdIsolation -v --no-cov
```
Expected: both tests FAIL because the endpoint currently sets `thread_id = session_id` (no email). The first test fails with `assert "alice@example.com" in "shared-session-uuid"` (`False`). The second test fails with `assert "shared-session-uuid" != "shared-session-uuid"` (`False`).

- [ ] **Step 3: Update imports in `app.py`**

In `agents/analytics-agent/src/app.py` lines 31-36 (existing imports), find the block:
```python
from platform_sdk import AgentConfig, AgentContext, configure_logging, get_logger, setup_checkpointer, setup_telemetry, flush_langfuse
from platform_sdk.mcp_bridge import MCPToolBridge, set_user_auth_token, reset_user_auth_token
from platform_sdk.security import make_api_key_verifier
from .graph import build_analytics_graph
from .middleware.rate_limiter import make_rate_limiter
from .persistence import PostgresConversationStore, MemoryConversationStore
```

Append one new line so the block reads:
```python
from platform_sdk import AgentConfig, AgentContext, configure_logging, get_logger, setup_checkpointer, setup_telemetry, flush_langfuse
from platform_sdk.mcp_bridge import MCPToolBridge, set_user_auth_token, reset_user_auth_token
from platform_sdk.security import make_api_key_verifier
from .graph import build_analytics_graph
from .middleware.rate_limiter import make_rate_limiter
from .persistence import PostgresConversationStore, MemoryConversationStore
from .thread_id import make_thread_id
```

- [ ] **Step 4: Wire `make_thread_id` into `/chat`**

In `agents/analytics-agent/src/app.py`, locate the block at line 455-457:
```python
                config={
                    "configurable": {"thread_id": session_id},
                },
```

Replace it with:
```python
                config={
                    "configurable": {
                        "thread_id": make_thread_id(user_email, session_id),
                    },
                },
```

`user_email` and `session_id` are already in scope at this point (defined at lines 386 and 418 respectively).

- [ ] **Step 5: Run the new tests; confirm GREEN**

```bash
.venv/bin/pytest agents/analytics-agent/tests/test_thread_id_endpoint.py::TestChatEndpointThreadIdIsolation -v --no-cov
```
Expected: `2 passed`.

- [ ] **Step 6: Verify the wider analytics-agent suite is unaffected**

```bash
.venv/bin/pytest agents/analytics-agent/tests/ -q --no-cov 2>&1 | tail -3
```
Expected: `13 failed, 36 passed` (baseline 13 failed + 28 passed plus 6 helper tests + 2 chat-endpoint tests).

- [ ] **Step 7: Verify `make test-unit` still green**

```bash
make test-unit 2>&1 | tail -3
```
Expected: `60 passed, 0 failed`.

- [ ] **Step 8: Commit**

```bash
git add agents/analytics-agent/src/app.py agents/analytics-agent/tests/test_thread_id_endpoint.py
git commit -m "fix(analytics-agent): tenant-scope thread_id on POST /chat

Replace 'thread_id: session_id' with
'thread_id: make_thread_id(user_email, session_id)' so two distinct
users sharing a session UUID never collide on the LangGraph
checkpointer. Two endpoint tests assert the cross-user isolation
contract using a stub graph and FastAPI dependency_overrides.

P0 security fix per architecture review findings A4 / AA4."
```

---

## Task 3: Wire `/stream` endpoint (extract `X-User-Email`, use `make_thread_id`) (TDD)

**Files:**
- Modify: `agents/analytics-agent/src/app.py:207-237` (`/stream` endpoint)
- Modify: `agents/analytics-agent/tests/test_thread_id_endpoint.py` (append `TestStreamEndpointThreadIdIsolation`)

- [ ] **Step 1: Append the failing test for `/stream`**

Open `agents/analytics-agent/tests/test_thread_id_endpoint.py` and APPEND the following class to the end of the file:

```python


class TestStreamEndpointThreadIdIsolation:
    """Cross-user isolation contract for POST /api/v1/analytics/stream.

    The legacy SSE endpoint must mirror /chat's tenant-scoping. Today
    /stream does not even read X-User-Email — these tests assert that
    after Task 3 it does, and that thread_id is namespaced the same way.
    """

    def test_thread_id_includes_user_email(self, client, captured_configs):
        payload = {
            "session_id": "shared-session-uuid",
            "message": "hi",
        }
        client.post(
            "/api/v1/analytics/stream",
            json=payload,
            headers={
                "Authorization": "Bearer test-token",
                "X-User-Email": "alice@example.com",
                "X-User-Role": "manager",
            },
        )
        assert len(captured_configs) == 1
        thread_id = captured_configs[0]["configurable"]["thread_id"]
        assert "alice@example.com" in thread_id
        assert "shared-session-uuid" in thread_id

    def test_two_users_with_same_session_id_get_distinct_thread_ids(
        self, client, captured_configs
    ):
        payload = {
            "session_id": "shared-session-uuid",
            "message": "hi",
        }
        for email in ("alice@example.com", "bob@example.com"):
            client.post(
                "/api/v1/analytics/stream",
                json=payload,
                headers={
                    "Authorization": "Bearer test-token",
                    "X-User-Email": email,
                    "X-User-Role": "manager",
                },
            )

        assert len(captured_configs) == 2
        thread_ids = [c["configurable"]["thread_id"] for c in captured_configs]
        assert thread_ids[0] != thread_ids[1], (
            "Same session_id with different X-User-Email MUST get "
            "different thread_ids on /stream too — same contract as /chat."
        )
        assert "alice@example.com" in thread_ids[0]
        assert "bob@example.com" in thread_ids[1]
```

- [ ] **Step 2: Run; confirm RED**

```bash
.venv/bin/pytest agents/analytics-agent/tests/test_thread_id_endpoint.py::TestStreamEndpointThreadIdIsolation -v --no-cov
```
Expected: both tests FAIL — currently `/stream` does not extract `X-User-Email` and passes the raw `session_id` as the thread_id.

- [ ] **Step 3: Update the `/stream` endpoint signature and body**

In `agents/analytics-agent/src/app.py`, locate the `/stream` endpoint at line 207. Currently it is:
```python
@app.post("/api/v1/analytics/stream")
async def stream_analytics(
    request: ChatRequest,
    _token: str = Depends(verify_api_key),
    _rate: None = Depends(check_rate_limit),
):
```

Replace the signature with (note the new `raw_request: Request` parameter — `Request` is already imported on line 26):
```python
@app.post("/api/v1/analytics/stream")
async def stream_analytics(
    raw_request: Request,
    request: ChatRequest,
    _token: str = Depends(verify_api_key),
    _rate: None = Depends(check_rate_limit),
):
```

Then locate the body around line 226-238. Currently:
```python
    graph = app.state.graph

    async def event_generator():
        try:
            async for event in graph.astream_events(
                {
                    "messages": [{"role": "user", "content": request.message}],
                    "session_id": request.session_id,
                },
                config={
                    "configurable": {"thread_id": request.session_id},
                },
                version="v2",
            ):
```

Replace it with:
```python
    graph = app.state.graph

    # Extract authenticated user identity from headers (set by dashboard API
    # route, trusted because this endpoint requires INTERNAL_API_KEY).
    user_email = raw_request.headers.get("x-user-email", "anonymous")

    async def event_generator():
        try:
            async for event in graph.astream_events(
                {
                    "messages": [{"role": "user", "content": request.message}],
                    "session_id": request.session_id,
                },
                config={
                    "configurable": {
                        "thread_id": make_thread_id(user_email, request.session_id),
                    },
                },
                version="v2",
            ):
```

(The `make_thread_id` import was added in Task 2, Step 3 — no further import edit needed.)

- [ ] **Step 4: Run; confirm GREEN**

```bash
.venv/bin/pytest agents/analytics-agent/tests/test_thread_id_endpoint.py::TestStreamEndpointThreadIdIsolation -v --no-cov
```
Expected: `2 passed`.

- [ ] **Step 5: Verify the wider analytics-agent suite**

```bash
.venv/bin/pytest agents/analytics-agent/tests/ -q --no-cov 2>&1 | tail -3
```
Expected: `13 failed, 38 passed` (baseline 13 failed + 28 passed plus 6 helper + 2 chat-endpoint + 2 stream-endpoint tests).

- [ ] **Step 6: Verify `make test-unit` still green**

```bash
make test-unit 2>&1 | tail -3
```
Expected: `60 passed, 0 failed`.

- [ ] **Step 7: Commit**

```bash
git add agents/analytics-agent/src/app.py agents/analytics-agent/tests/test_thread_id_endpoint.py
git commit -m "fix(analytics-agent): tenant-scope thread_id on POST /stream

The legacy SSE endpoint did not extract X-User-Email at all and used
'thread_id: request.session_id' directly. This commit:

- Adds 'raw_request: Request' to the stream_analytics signature so the
  handler can read X-User-Email (mirrors the /chat endpoint).
- Wires make_thread_id(user_email, session_id) so /stream gets the
  same tenant-isolation guarantee as /chat.
- Adds two endpoint tests that assert the cross-user isolation
  contract on /stream.

P0 security fix per architecture review findings A4 / AA4."
```

---

## Task 4: Final repo-wide verification

**Files:** none (read-only)

- [ ] **Step 1: No stale `thread_id = session_id` patterns remain**

```bash
grep -nE 'thread_id["\x27]?\s*:\s*request\.session_id|thread_id["\x27]?\s*:\s*session_id\b' agents/analytics-agent/src/app.py
```
Expected: zero output. Both call sites must now go through `make_thread_id(...)`.

- [ ] **Step 2: Both endpoints reference the helper**

```bash
grep -n 'make_thread_id(' agents/analytics-agent/src/app.py
```
Expected: at least three matches — the import line plus one call site per endpoint.

- [ ] **Step 3: Helper is imported only once**

```bash
grep -c 'from .thread_id import make_thread_id' agents/analytics-agent/src/app.py
```
Expected: `1`.

- [ ] **Step 4: Test counts are at the expected post-task totals**

```bash
.venv/bin/pytest agents/analytics-agent/tests/ -q --no-cov 2>&1 | tail -3
```
Expected: `13 failed, 38 passed`. The 13 failed are pre-existing baseline; the 38 passed = 28 baseline + 10 new (6 helper unit tests + 2 chat-endpoint + 2 stream-endpoint).

- [ ] **Step 5: `make test-unit` is still at baseline**

```bash
make test-unit 2>&1 | tail -3
```
Expected: `60 passed, 0 failed`.

- [ ] **Step 6: Commit history shape**

```bash
git log --oneline 9f0aca6..HEAD
```
Expected (top to bottom = newest to oldest):
```
<sha> fix(analytics-agent): tenant-scope thread_id on POST /stream
<sha> fix(analytics-agent): tenant-scope thread_id on POST /chat
<sha> feat(analytics-agent): add tenant-scoped make_thread_id helper
<sha> refactor(tools/salesforce-mcp): rename service modules to PEP 8 snake_case
<sha> refactor(tools/news-search-mcp): rename service modules to PEP 8 snake_case
<sha> refactor(tools/payments-mcp): rename service modules to PEP 8 snake_case
<sha> refactor(tools/data-mcp): rename service modules to PEP 8 snake_case
<sha> refactor(agents): rename EnterpriseAgentService.py to enterprise_agent_service.py
<sha> refactor(platform-sdk): rename config/ modules to PEP 8 snake_case
<sha> refactor(platform-sdk): rename services/ modules to PEP 8 snake_case
<sha> refactor(platform-sdk): rename base/ modules to PEP 8 snake_case
```
The three new commits (Phase 0b) are on top; the eight rename commits (Phase 0a) are underneath; everything sits on top of `9f0aca6` (the plan-doc commit).

- [ ] **Step 7: Workspace clean**

```bash
git status --short
```
Expected: empty.

- [ ] **Step 8: Smoke-test the helper end-to-end**

```bash
.venv/bin/python3 -c "
from src.thread_id import make_thread_id
import sys
sys.path.insert(0, 'agents/analytics-agent')
# Re-import in case the path is needed
from src.thread_id import make_thread_id as fn
a = fn('alice@example.com', 'shared-uuid')
b = fn('bob@example.com', 'shared-uuid')
assert a != b, f'isolation broken: {a} == {b}'
assert 'alice' in a
assert 'bob' in b
print('smoke: tenant isolation OK')
"
```
Note: this command must run with `cwd` at `agents/analytics-agent/` for the `from src.thread_id import` form to resolve. If the engineer's shell is at the repo root, run instead:
```bash
cd agents/analytics-agent && .venv/bin/python3 -c "from src.thread_id import make_thread_id; a=make_thread_id('alice@x.com','u1'); b=make_thread_id('bob@x.com','u1'); assert a!=b; print('smoke: tenant isolation OK')" && cd -
```
The `.venv/bin/python3` path may need to be relative back: `../../.venv/bin/python3`.

Either form must print `smoke: tenant isolation OK`.

---

## Rollback plan

If any task fails its verification step, the engineer should:

1. `git status` — confirm only the current task's files are modified.
2. `git restore --staged --worktree agents/analytics-agent/` to drop any unstaged work.
3. If a commit was already made and a downstream task surfaces a missed reference, fix forward with a new commit. Do not amend or rebase published history.

---

## Out of scope (deliberately deferred)

- **Hashing the email out of the thread_id.** Today the `thread_id` literally contains `user_email`, which puts user identity into the LangGraph checkpoints table. PII concern. A future plan can swap to `f"{sha256(email)[:16]}:{session_id}"` if compliance requires it; the helper is the only place that needs to change, and the unit tests pin its contract.
- **SQL-layer tenant enforcement on the Postgres checkpointer.** The architecture review (finding A4) recommends "the Postgres checkpointer should also enforce tenant scope at the SQL layer." That is a SDK-level change (touches `setup_checkpointer` and the underlying schema) and belongs in the SoC/DI refactor, not this targeted P0 patch.
- **JWT-based identity (instead of trusting `X-User-Email`).** The current model trusts the dashboard's headers because the dashboard authenticates via Auth0 and the analytics-agent enforces a service-to-service `INTERNAL_API_KEY`. Moving identity into a signed token is a larger auth refactor.
- **Backfilling or migrating existing checkpoint rows.** New thread keys are a new namespace. Old `session_id`-only rows still exist but are no longer addressed by the new code path. They will age out naturally; if explicit cleanup is required, schedule a separate one-off plan.
- **CORS / `ALLOWED_ORIGINS` cleanup** (finding AA18) — separate plan.
- **Removing the legacy `/stream` endpoint** — separate decision, not a security blocker once both endpoints are tenant-scoped.

This plan changes **two endpoint code blocks and adds one helper module**. No SDK changes, no schema changes, no behavior beyond the thread_id derivation.
