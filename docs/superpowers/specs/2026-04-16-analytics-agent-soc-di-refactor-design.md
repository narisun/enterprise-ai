# Analytics-Agent & Platform-SDK: Separation-of-Concerns + DI Refactor

**Date:** 2026-04-16
**Scope:** `agents/analytics-agent/` and `platform-sdk/`
**Status:** Design approved; pending user review before plan generation.

## 1. Purpose and scope

Refactor `agents/analytics-agent/` and `platform-sdk/` to a clean four-layer architecture with constructor-based dependency injection, Protocol-defined seams, and a testable composition root. Fix a curated set of P0 bugs that intersect the refactor surface. Produce a reference pattern that later work can apply to the other in-repo agents.

### In scope

- `agents/analytics-agent/` — full restructure into Transport / Service / Domain / Infrastructure layers with constructor injection and Protocol ports.
- `platform-sdk/platform_sdk/` — remove module-level state, make adapters constructor-injected, narrow the public API, align with consumer-owned Protocols.
- Four P0 bug fixes listed in CODE_REVIEW.md that cannot be cleanly avoided while refactoring the affected code:
  1. Postgres checkpointer `setup()` never called.
  2. Intent router output not validated.
  3. MCP tool schema parsing silently degrades on `$ref`/`allOf`/`anyOf`.
  4. `get_langchain_tools()` crashes startup when any MCP server is unreachable.
- Full test pyramid: unit, component, application, integration.
- TDD discipline via `superpowers:test-driven-development`.
- SDK is treated as internal code; API breakage allowed with in-repo consumers updated in the same PR sweep (Phase 9).
- In-flight uncommitted refactor on `agents/analytics-agent/` is reviewed in Phase 0 and merged/reworked as appropriate.

### Out of scope

- Other agents under `agents/` — architectural migration to the reference pattern is a follow-up spec. However, their imports of `platform-sdk` are updated mechanically in Phase 9 to keep them compiling against the new SDK API.
- `tools/` (MCP servers) — no architectural changes beyond the minimum needed to test analytics-agent. Import-level updates in Phase 9 only.
- `services/continuous_embedding_pipeline/` — keeps its existing `dependency-injector` architecture. Phase 9 touches it only to update SDK imports.
- Frontend (`frontends/analytics-dashboard/`).
- P1/P2/P3 bugs from CODE_REVIEW.md:
  - Prompt-injection surface in tool-catalog interpolation.
  - System prompt ordering in compaction modifier.
  - Synthesis structured-output retry.
  - State schema version validation.
  - Full-DB-schema-in-router-prompt token cost.

### Key decisions (locked in during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Scope | analytics-agent + platform-sdk | SDK-level state leaks into every consumer; fix now. |
| DI approach | Constructor injection + `typing.Protocol` | Small object graph, no new library, matches in-flight direction. |
| SDK API stability | Break freely; update consumers in same PRs | SDK is internal, not published. |
| Behavior changes | Refactor + P0 fixes only | P0s squarely overlap refactor surface; P1s stay separate. |
| Test discipline | Strict TDD via `superpowers:test-driven-development` | Protects the refactor from regressions; produces reviewable commit-per-green history. |
| In-flight work | Review-then-accept as Phase 0 | Salvages work without copy-pasting shortcuts into the reference pattern. |
| End-state shape | Layered (Transport / Service / Domain / Infrastructure) | Names match in-flight structure; hex-style is overkill given LangGraph type pervasiveness. |
| Application-test tier | In-process primary + Docker integration opt-in | Fast inner loop; real-system coverage preserved. |

---

## 2. Target architecture

### 2.1 Four layers

| Layer | Lives in | Depends on | Forbidden from |
|---|---|---|---|
| Transport | `agents/analytics-agent/src/routes/*.py` | Services, FastAPI | LangChain, MCP, LLM clients, stores |
| Service | `agents/analytics-agent/src/services/*.py` | Domain, port Protocols | FastAPI, HTTP types, concrete vendor adapters |
| Domain | `agents/analytics-agent/src/graph.py`, `src/nodes/*.py`, `src/state.py`, `src/domain/*.py` | Port Protocols, abstract LangChain/LangGraph base types (`BaseChatModel`, `BaseTool`, `BaseMessage`, `CompiledGraph`) | FastAPI, concrete vendor LLM/MCP/store clients (`ChatOpenAI`, `AnthropicChat`, `asyncpg`, etc.) |
| Infrastructure | `platform-sdk/platform_sdk/*` | External systems (LangChain, MCP, Postgres, Redis, OPA) | Domain code, analytics-agent code |

**Hard rule:** dependencies point inward. Transport → Service → Domain → Ports. Infrastructure implements ports but does not import domain.

**Pragmatic exception:** Domain uses LangChain/LangGraph *abstract* types (`BaseChatModel`, `BaseTool`, `BaseMessage`, `CompiledGraph`, `RunnableConfig`) because they are the graph's interface. Domain must not import concrete vendor clients — those belong in Infrastructure adapters behind `LLMFactory` / `MCPToolsProvider`.

### 2.2 Protocol ownership (Dependency Inversion)

The *consumer* owns the interface. Protocols for `ConversationStore`, `MCPToolsProvider`, `LLMFactory`, `StreamEncoder`, `CompactionModifier`, `TelemetryScope` live in `agents/analytics-agent/src/ports.py`. Adapters in `platform-sdk` *structurally satisfy* those Protocols; the SDK does not import from the agent.

This lets the agent swap infrastructure without touching domain and prevents the SDK from dictating consumer shape.

### 2.3 Composition root

Two layers of composition:

1. **`AppDependencies` dataclass** — holds the fully-wired singletons a request needs (`config`, `graph`, `conversation_store`, `mcp_tools_provider`, `llm_factory`, `telemetry`, `encoder_factory`, `compaction`) plus per-request factories (`chat_service_factory`).
2. **`create_app(deps: AppDependencies) -> FastAPI`** — pure; registers routes, attaches `deps` to `app.state`, returns app. No `os.environ`, no I/O.
3. **`lifespan(app)` async context manager** — reads environment, builds concrete `AppDependencies`, attaches to `app.state`, yields, tears down on shutdown. The *only* place that instantiates real infrastructure.

Production path: uvicorn → `app = create_app(<deps built via lifespan>)`.
Test path: `create_app(build_test_dependencies())` — no lifespan, no Docker.

---

## 3. Components

### 3.1 Transport layer — `src/routes/`

| File | Purpose |
|---|---|
| `routes/chat.py` | `POST /chat` — parse body, build `UserContext`, pull `ChatService` via factory, return `StreamingResponse`. |
| `routes/conversations.py` | Conversation CRUD, thin wrapper around `ConversationService`. |
| `routes/health.py` | `GET /healthz`, `GET /readyz`. |

**Constraint:** each route function ≤20 lines, no orchestration, no LangChain/LangGraph/MCP imports.

### 3.2 Service layer — `src/services/`

```
class ChatService:
    def __init__(
        self,
        graph: CompiledGraph,
        store: ConversationStore,
        encoder: StreamEncoder,
        telemetry: TelemetryScope,
        config: AgentConfig,
        user_ctx: UserContext,
    ): ...
    async def execute(self, req: ChatRequest) -> AsyncIterator[bytes]: ...
```

```
class ConversationService:
    def __init__(self, store: ConversationStore): ...
    async def list(self, user_ctx: UserContext) -> list[ConversationSummary]: ...
    async def get(self, conversation_id: str, user_ctx: UserContext) -> Conversation: ...
    async def delete(self, conversation_id: str, user_ctx: UserContext) -> None: ...
```

Both enforce tenant scoping via `UserContext` rather than reading global state.

### 3.3 Domain layer

**Nodes as callable classes** (`src/nodes/*.py`). One class per file:

```
class IntentRouterNode:
    def __init__(
        self,
        llm: BaseChatModel,
        tools_provider: MCPToolsProvider,
        prompts: IntentPrompts,
        compaction: CompactionModifier,
    ): ...
    async def __call__(self, state: AnalyticsState, config: RunnableConfig) -> dict: ...
```

Same pattern for `MCPToolCallerNode`, `SynthesisNode`, `ErrorHandlerNode`.

**Graph builder** (`src/graph.py`):

```
@dataclass
class GraphDependencies:
    llm_factory: LLMFactory
    tools_provider: MCPToolsProvider
    compaction: CompactionModifier
    config: AgentConfig
    prompts: Prompts

def build_analytics_graph(
    deps: GraphDependencies,
    checkpointer: BaseCheckpointSaver | None = None,
) -> CompiledGraph: ...
```

Replaces today's six-keyword-argument function.

### 3.4 Port Protocols — `src/ports.py`

```
class ConversationStore(Protocol):
    async def save(self, convo: Conversation, user_ctx: UserContext) -> None: ...
    async def load(self, convo_id: str, user_ctx: UserContext) -> Conversation | None: ...
    async def list(self, user_ctx: UserContext) -> list[ConversationSummary]: ...
    async def delete(self, convo_id: str, user_ctx: UserContext) -> None: ...

class MCPToolsProvider(Protocol):
    async def get_langchain_tools(self, user_ctx: UserContext) -> list[BaseTool]: ...

class LLMFactory(Protocol):
    def make_router_llm(self) -> BaseChatModel: ...
    def make_synthesis_llm(self) -> BaseChatModel: ...

class StreamEncoder(Protocol):
    def encode_event(self, event: dict) -> bytes: ...
    def encode_error(self, err: Exception, *, error_id: str) -> bytes: ...
    def finalize(self) -> bytes: ...

class CompactionModifier(Protocol):
    def apply(self, messages: list[BaseMessage]) -> list[BaseMessage]: ...

class TelemetryScope(Protocol):
    @contextmanager
    def start_span(self, name: str) -> Iterator[Span]: ...
    def record_event(self, name: str, **attrs: Any) -> None: ...
```

### 3.5 Shared value types — `src/domain/types.py`

```
@dataclass(frozen=True)
class UserContext:
    user_id: str
    tenant_id: str
    auth_token: str           # redacted in logs
    # optional: groups, scopes, request_id

class ChatRequest(BaseModel): ...
class ChatResponse(BaseModel): ...
class Conversation(BaseModel): ...
class ConversationSummary(BaseModel): ...
```

### 3.6 Domain errors — `src/domain/errors.py`

```
AnalyticsError (base)
├── AuthError
├── IntentError
│   └── UnknownIntent             # P0: unknown intent from router LLM
├── ToolsError
│   ├── ToolsUnavailable          # all MCP bridges unreachable
│   └── UnsupportedSchemaError    # P0: $ref/allOf/anyOf in MCP tool schema
├── LLMError
│   ├── LLMUnavailable
│   └── LLMStructuredOutputError
└── StoreError
    ├── StoreUnavailable
    └── ConversationNotFound
```

### 3.7 Composition root — `src/app.py` + `src/lifespan.py`

```
@dataclass
class AppDependencies:
    config: AgentConfig
    graph: CompiledGraph
    conversation_store: ConversationStore
    mcp_tools_provider: MCPToolsProvider
    llm_factory: LLMFactory
    telemetry: TelemetryScope
    encoder_factory: Callable[[], StreamEncoder]
    compaction: CompactionModifier
    chat_service_factory: Callable[[UserContext], ChatService]

def create_app(deps: AppDependencies) -> FastAPI: ...

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]: ...
```

---

## 4. Platform-SDK changes

### 4.1 Module-level state removal

- **`mcp_bridge.py`** — remove `_user_auth_ctx: ContextVar`, `set_user_auth_token`, `reset_user_auth_token`. `MCPToolBridge.get_langchain_tools(user_ctx)` takes the scope as an explicit parameter and stamps outgoing MCP calls with headers built from it.
- **`compaction.py`** — remove top-level `_token_counter = _make_token_counter()`. Introduce `TokenAwareCompactionModifier(token_limit: int, encoding: str = "cl100k_base")` with tiktoken loaded in `__init__`.
- **`__init__.py`** — narrow public surface; stop re-exporting internal-only symbols. Concrete export list is authored during Phase 3.

### 4.2 Adapter shapes (constructor-injected)

- `MCPToolBridge` — implements `MCPToolsProvider`.
- `PostgresConversationStore`, `InMemoryConversationStore` — implement `ConversationStore`.
- `ChatLLMFactory` — implements `LLMFactory`; no module-level caches.
- `LangfuseTelemetry` / `OtelTelemetry` — implement `TelemetryScope`.
- `DataStreamEncoder`, `SSEEncoder` — implement `StreamEncoder`.
- `TokenAwareCompactionModifier` — implements `CompactionModifier`.

### 4.3 P0 fixes embedded in the refactor

1. **Postgres checkpointer `setup()`** — introduce `setup_checkpointer(config)` async helper called from `lifespan()` before graph build; returns a saver whose tables exist.
2. **Intent router output validation** — `IntentRouterNode.__call__` validates the returned intent against a known set; unknown → route to `ErrorHandlerNode` with a clarification message.
3. **MCP tool schema parsing** — `MCPToolBridge._convert_schema()` raises `UnsupportedSchemaError(tool_name, keyword)` on `$ref`/`allOf`/`anyOf` instead of silently producing partial schemas.
4. **Startup resilience** — `MCPToolBridge.get_langchain_tools()` returns the union of currently reachable servers; an unreachable server at startup logs a warning and is retried by the existing background reconnect loop. Startup succeeds with a reduced tool set.

### 4.4 Resilience (preserved, not rewritten)

- Circuit breaker in `platform_sdk/resilience.py` becomes a constructor-injected dependency of `MCPToolBridge`. No behavior change.
- LLM retries continue to be handled by the LiteLLM proxy.

---

## 5. Data flow

### 5.1 `POST /chat` happy path

1. **Transport** — `routes/chat.py::chat_handler` parses body → `ChatRequest`; reads auth headers → `UserContext`; `chat_service = deps.chat_service_factory(user_ctx)`; returns `StreamingResponse(chat_service.execute(req))`.
2. **Service** — `ChatService.execute`:
   - Opens telemetry span `chat.execute`.
   - If `req.conversation_id` present, loads prior conversation from `self.store`.
   - Builds initial `AnalyticsState` and LangGraph `run_config`:
     ```
     run_config = {"configurable": {"user_ctx": self.user_ctx, "thread_id": ..., "session_id": ...}}
     ```
   - `async for event in self.graph.astream_events(initial_state, config=run_config, version="v2"): yield self.encoder.encode_event(event)`.
   - On completion → `self.store.save(final_state, self.user_ctx)`; yield `self.encoder.finalize()`.
3. **Domain** — LangGraph routes state through `intent_router` → (`mcp_tool_caller` or `error_handler`) → `synthesis`. Each node reads `user_ctx` from `config["configurable"]`. Nodes call their injected LLM / tools-provider; no globals.
4. **Transport teardown** — `StreamingResponse` closes; span is finalized.

### 5.2 Where `UserContext` lives per request

- Today: a module-level `ContextVar` populated at request start.
- New: `ChatService.user_ctx` on the instance + inside LangGraph's `config["configurable"]`. Read explicitly by nodes via their `config` argument. Never stored in `AnalyticsState` (avoids serializing secrets into checkpoints).

### 5.3 Cold-start (lifespan) sequence

1. `config = AgentConfig.from_env()`
2. `mcp_registry = McpRegistry.from_env(); mcp_bridges = await mcp_registry.connect_all()`
3. `mcp_tools_provider = MCPBridgeToolsProvider(mcp_bridges)`
4. `llm_factory = ChatLLMFactory(config)`
5. `conversation_store = build_conversation_store(config)`
6. `checkpointer = await setup_checkpointer(config)` *(P0 fix — calls `.setup()`)*
7. `compaction = TokenAwareCompactionModifier(config.context_token_limit)`
8. `graph_deps = GraphDependencies(llm_factory, mcp_tools_provider, compaction, config, prompts)`
9. `graph = build_analytics_graph(graph_deps, checkpointer=checkpointer)`
10. `telemetry = build_telemetry(config)`
11. `encoder_factory = lambda: DataStreamEncoder()` (or SSE per config)
12. `chat_service_factory = lambda user_ctx: ChatService(graph, conversation_store, encoder_factory(), telemetry, config, user_ctx)`
13. `deps = AppDependencies(...)`
14. `app.state.deps = deps; yield`
15. Teardown: flush telemetry → close Postgres pool → disconnect bridges.

---

## 6. Error handling

### 6.1 Layer responsibilities

| Layer | Catches | Raises | Translates to |
|---|---|---|---|
| Infrastructure | Vendor exceptions (`openai.APIError`, `asyncpg.Error`, MCP timeouts) | Typed `AnalyticsError` subclasses | — |
| Domain | Nothing (propagates); node validation raises `IntentError` only | — |
| Service | All `AnalyticsError` subclasses | Never raises during streaming | `StreamEncoder.encode_error` events |
| Transport | Pre-stream errors only (bad body, auth, missing conversation) | `HTTPException` with status | HTTP 4xx/5xx response |

### 6.2 Pre-stream vs. mid-stream semantics

- **Pre-stream** (parsing, auth failure, building `ChatService`, loading prior conversation): `HTTPException` → FastAPI returns 4xx/5xx with JSON body. Stream has not started.
- **Mid-stream** (inside `graph.astream_events`): HTTP status is already 200. `ChatService` catches, calls `self.encoder.encode_error(err, error_id=...)`, yields the bytes, closes the stream cleanly.

Both paths are tested explicitly at the application tier.

### 6.3 FastAPI exception handlers

Registered by `create_app(deps)`:
- `AnalyticsError` → 500 `{"error_id": ..., "type": "internal"}` (details to logs, not to users).
- `AuthError` → 401/403.
- `ConversationNotFound` → 404.
- Pydantic validation errors → 422 (FastAPI default).

### 6.4 Telemetry & correlation

Every error path records on the active span (`span.record_exception(err)`, `span.set_status(ERROR)`) and surfaces a UUID `error_id` in:
- the HTTP response body or the encoded error event
- the structured log line
- the span attributes

User-reported IDs trace back to one specific request.

### 6.5 What the user sees

- Pre-stream: JSON with `error_id` and sanitized message.
- Mid-stream: final encoded error event with the same shape.
- Never: stack traces, vendor SDK messages, tool names the user lacks access to.

### 6.6 Secrets in logs

SDK's logging config redacts `auth_token` and any LLM prompt field tagged as sensitive. Verified by a unit test.

---

## 7. Testing strategy

### 7.1 Tier layout

```
agents/analytics-agent/tests/
├── conftest.py
├── fakes/
│   ├── fake_llm.py
│   ├── fake_llm_factory.py
│   ├── fake_mcp_tools_provider.py
│   ├── fake_conversation_store.py
│   ├── fake_stream_encoder.py
│   ├── fake_telemetry.py
│   ├── fake_compaction.py
│   └── build_test_deps.py
├── unit/
├── component/
├── application/
└── integration/       # @pytest.mark.integration — opt-in
```

The repo-level `tests/platform_sdk/` mirrors the structure for SDK-internal tests.

### 7.2 Tier semantics

| Tier | Target | Fakes | Speed budget | Runs in |
|---|---|---|---|---|
| unit | one class / pure function | all collaborators | <10 ms each | default `pytest` |
| component | multiple classes wired, one layer | external systems only | <100 ms each | default `pytest` |
| application | full app via `create_app(fake_deps)` | all infrastructure | <500 ms each | default `pytest` |
| integration | full Docker stack | nothing | seconds | `pytest -m integration` |

Default `pytest` run in CI (on every PR) covers unit + component + application. Integration is opt-in (`make test-integration` or nightly).

### 7.3 `build_test_dependencies`

Single function parameterized with all ports; returns a fully wired `AppDependencies` with fakes. Tests override whichever piece they care about:

```
def build_test_dependencies(
    *,
    llm_factory: LLMFactory | None = None,
    mcp_tools_provider: MCPToolsProvider | None = None,
    conversation_store: ConversationStore | None = None,
    telemetry: TelemetryScope | None = None,
    config: AgentConfig | None = None,
    encoder_factory: Callable[[], StreamEncoder] | None = None,
    compaction: CompactionModifier | None = None,
) -> AppDependencies: ...
```

### 7.4 TDD cadence (per `superpowers:test-driven-development`)

For each new piece:
1. Pick the lowest tier that expresses the contract.
2. Write a red test at that tier. Commit.
3. Minimum code to green. Commit.
4. Refactor if warranted; tests stay green. Commit.

Higher-tier tests exist only when lower tiers cannot cover the behavior.

### 7.5 Coverage targets (guidance, not CI gates initially)

- Domain (`src/nodes/`, `src/domain/`, `src/state.py`): ≥90%.
- Services (`src/services/`): ≥85%.
- Routes (`src/routes/`): ≥80%.
- SDK adapters: ≥70% (integration tests cover real-system behavior).

Gates are not enforced in CI until after the refactor lands.

### 7.6 P0 regression tests (red-first before fix)

1. `test_unknown_intent_routes_to_error_handler` — unit, `test_intent_router_node.py`. Fake LLM returns `"bogus_intent"` → node routes to error handler.
2. `test_unsupported_schema_raises_clearly` — unit, `test_mcp_bridge_adapter.py`. Schema with `$ref` → `UnsupportedSchemaError(tool_name, keyword)`.
3. `test_partial_mcp_connectivity_starts_up` — component, `test_lifespan_wiring.py`. One healthy + one unreachable fake MCP → lifespan succeeds with reduced tool set.
4. `test_postgres_checkpointer_bootstrap_empty_db` — integration. Empty DB → first graph run does not crash.

---

## 8. Phasing

Each phase is independently mergeable. `main` stays green at every phase boundary.

### Phase 0 — Triage the in-flight work *(blocks everything)*

- Run `superpowers:receiving-code-review` against uncommitted changes in `agents/analytics-agent/src/{app.py, graph.py, lifespan.py, routes/, services/, streaming/}` and the new test files.
- Produce disposition list: accept / rework / discard.
- Commit accepted work as a baseline, one focused commit per area (services, routes, streaming, lifespan, tests).
- Carry forward rework/discard decisions as TODOs against later phases.

### Phase 1 — Ports and shared types

- `src/domain/types.py` — `UserContext`, `ChatRequest`, `ChatResponse`, `Conversation`, `ConversationSummary`.
- `src/domain/errors.py` — exception hierarchy.
- `src/ports.py` — `ConversationStore`, `MCPToolsProvider`, `LLMFactory`, `StreamEncoder`, `CompactionModifier`, `TelemetryScope`.
- Unit tests for value types and errors.
- No production behavior changes.

### Phase 2 — Test scaffolding

- `tests/fakes/` with all doubles.
- `tests/fakes/build_test_deps.py::build_test_dependencies`.
- Reorganize existing tests into `unit/`, `component/`, `application/`, `integration/`. Existing passing tests continue to pass.

### Phase 3 — Platform-SDK cleanups

- `TokenAwareCompactionModifier` class; remove module-level tiktoken init.
- Remove `_user_auth_ctx` ContextVar and helpers from `mcp_bridge.py`; `get_langchain_tools(user_ctx)` takes scope as a parameter.
- `ChatLLMFactory` becomes stateless at module level.
- Narrow `platform_sdk/__init__.py` public surface.
- Red-first tests: `test_token_aware_compaction.py` (unit); `test_mcp_bridge_adapter.py` (component).

### Phase 4 — Composition root

- `AppDependencies` dataclass.
- `create_app(deps)` made pure.
- `lifespan(app)` rewritten to build `AppDependencies`.
- Red-first test: `test_app_factory.py` (application) — `create_app(build_test_dependencies())` returns a usable app.

### Phase 5 — Service layer

- `ChatService` constructor-injected against Protocols; holds per-request `user_ctx`.
- `ConversationService` extracted if Phase 0 triage indicates.
- `chat_service_factory` added to `AppDependencies`.
- Red-first component tests: `test_chat_service.py` (orchestration, pre/mid-stream errors, auth scope plumbing, save-on-success).

### Phase 6 — Domain layer: nodes as classes

- Convert `IntentRouterNode`, `MCPToolCallerNode`, `SynthesisNode`, `ErrorHandlerNode` to callable classes with constructor injection.
- `GraphDependencies` dataclass; `build_analytics_graph(deps)` rewritten.
- **P0 fix:** `IntentRouterNode` validates intent → routes to `ErrorHandlerNode` on unknown.
- **P0 fix:** `MCPToolBridge._convert_schema()` raises `UnsupportedSchemaError` on `$ref`/`allOf`/`anyOf`.
- Red-first unit tests per node + the two P0 regressions.

### Phase 7 — Transport layer cleanup

- Route handlers thinned to ≤20 lines each.
- Application-tier tests for every HTTP contract: `test_chat_endpoint.py`, `test_conversations_endpoint.py`, `test_health_endpoint.py`, `test_error_contracts.py`, `test_auth_scoping.py`.
- FastAPI exception handlers registered in `create_app(deps)`.

### Phase 8 — Remaining P0 fixes + resilience

- **P0:** `setup_checkpointer()` called from `lifespan()`. Integration regression test against empty DB.
- **P0:** `MCPToolBridge.get_langchain_tools()` returns partial set when some servers are unreachable; reconnect loop preserved. Component test with healthy + unreachable fakes.

### Phase 9 — Consumer migration + cleanup

- Update other in-repo SDK consumers (other agents under `agents/`, `services/continuous_embedding_pipeline/`, `tools/`) to match new SDK APIs.
- Delete dead code (old factory functions, old `make_checkpointer()`, etc.).
- Move `test_e2e_streaming.py` into `integration/`; verify it still passes.

### Phase properties

- Every phase boundary: `main` green, default `pytest` run passes.
- Phases 1–2 add no production behavior.
- Phases 3–8 are the refactor proper; each has at least one red-first test for every behavior moved or fixed.
- Phase 9 is closeout.
- TDD discipline (red → green → refactor → commit per green step) applies inside every phase.

---

## 9. Success criteria

The refactor is done when:

1. Every class in `agents/analytics-agent/src/` and `platform-sdk/platform_sdk/` takes its dependencies via `__init__`.
2. No module-level `ContextVar`, singleton, or import-time initialization in either package.
3. Port Protocols in `agents/analytics-agent/src/ports.py` are the contract; SDK adapters structurally satisfy them without importing the agent.
4. `create_app(deps)` is pure and tests use it directly without Docker.
5. `build_test_dependencies` is the single knob for test composition.
6. All four P0 regression tests are green.
7. Default `pytest` run (unit + component + application) is <60 s total and green on every PR.
8. Integration suite (`pytest -m integration`) runs and passes on the Docker stack.
9. In-repo consumers of the SDK compile and pass their own tests against the new API.
10. A short reference doc at `docs/architecture/agent-reference-pattern.md` describes the pattern so follow-up agents can copy it.

---

## 10. Open items (for the implementation plan to resolve)

These are implementation details that `writing-plans` will pin down, not design questions:

- Exact public export list for `platform_sdk/__init__.py` after narrowing.
- Whether to ship a lightweight Postgres-in-Docker fixture for component-tier tests (currently in integration tier only).
- Whether to adopt `pytest-anyio` vs. `pytest-asyncio` consistently across tiers.
- Concrete Protocol method signatures for `TelemetryScope` (align with OTel and Langfuse shared subset).
- Whether `prompts` belongs inside `GraphDependencies` or as a separate argument to `build_analytics_graph`.

---

## 11. Follow-ups (explicitly not in this spec)

- Apply the reference pattern to other agents under `agents/`.
- Address P1/P2/P3 bugs in CODE_REVIEW.md.
- Convert `tools/` (MCP servers) to the same DI pattern.
- Re-evaluate whether `services/continuous_embedding_pipeline/`'s `dependency-injector` usage should align with the agent pattern or stay library-based.
