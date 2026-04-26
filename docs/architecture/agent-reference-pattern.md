# Agent Reference Pattern

This document describes the layered architecture used by `agents/analytics-agent/`. New agents should follow the same structure.

## Directory layout

```
agents/<agent-name>/
├── src/
│   ├── app.py                  # create_app(deps: AppDependencies) factory + lifespan
│   ├── app_dependencies.py     # AppDependencies dataclass (the single wiring object)
│   ├── graph.py                # build_<agent>_graph(deps) — also accepts legacy kwargs
│   ├── graph_dependencies.py   # GraphDependencies dataclass
│   ├── state.py                # LangGraph state schema (TypedDict + reducers)
│   ├── thread_id.py            # tenant-scoped thread_id helper
│   ├── ports.py                # Protocol seams (consumer-owned)
│   ├── domain/
│   │   ├── types.py            # UserContext, ChatRequest, ChatResponse, Conversation
│   │   └── errors.py           # AnalyticsError hierarchy (domain exception tree)
│   ├── nodes/                  # Callable node classes (IntentRouterNode, etc.)
│   ├── services/               # ChatService, ConversationService
│   ├── routes/                 # Thin HTTP handlers; one APIRouter per file
│   │   ├── _auth.py            # _user_ctx_from(request) helper
│   │   ├── chat.py
│   │   ├── conversations.py
│   │   ├── health.py
│   │   └── stream.py           # legacy SSE (optional)
│   └── streaming/              # StreamEncoder implementations (DataStreamEncoder, etc.)
└── tests/
    ├── fakes/                  # Reusable doubles + build_test_dependencies()
    ├── unit/                   # Pure-logic tests; no I/O
    ├── component/              # Multiple classes wired; external systems faked
    ├── application/            # create_app(fake_deps) + httpx TestClient
    └── integration/            # @pytest.mark.integration — full Docker stack
```

## Rules

1. **Constructor injection everywhere.** No module-level state, no globals, no import-time I/O. Every class takes its dependencies via `__init__`.
2. **Protocols owned by the consumer.** `src/ports.py` defines the interfaces. SDK adapters in `platform-sdk/` structurally satisfy them — the SDK never imports from the agent.
3. **Pure factory.** `create_app(deps)` is a pure function — no env reads, no I/O. `lifespan(app)` is the only place that performs startup I/O.
4. **Class-based nodes.** `build_<agent>_graph(deps: GraphDependencies)` instantiates `IntentRouterNode`, `MCPToolCallerNode`, `SynthesisNode`, `ErrorHandlerNode` from `deps`.
5. **Explicit user identity.** `UserContext` flows via `config["configurable"]["user_ctx"]` through LangGraph; never via module-level `ContextVar`.
6. **Tenant-scoped checkpoints.** Server-derive `thread_id` from `(user_id, session_id)` via `make_thread_id(...)`. Never trust client-supplied IDs alone.
7. **Test-driven everywhere.** Red → green → refactor. Four test tiers (unit / component / application / integration); the default `pytest` run covers the first three.
8. **P0 regressions get red-first tests.** Every P0 fix lands with a test that would have caught the original bug.

## How requests flow

1. **Transport.** `routes/chat.py::chat_handler` parses the body into a `ChatRequest`, extracts `UserContext` via `_user_ctx_from(request)`, pulls `chat_service_factory` from `app.state.deps`.
2. **Service.** `chat_service_factory(user_ctx)` returns a per-request `ChatService` with `(graph, conversation_store, encoder, telemetry, config, user_ctx)` injected. `service.execute(req)` is an async generator yielding wire bytes.
3. **Domain.** LangGraph routes state through `intent_router → (mcp_tool_caller | error_handler) → synthesis`. Each node reads `user_ctx` from `config["configurable"]`. Nodes call their injected LLM / tools provider; no globals.
4. **Encoding.** Each event passes through the injected `StreamEncoder` (e.g. `DataStreamEncoder` for the Vercel AI SDK protocol).
5. **Persistence.** After the stream completes, `ChatService` writes user + assistant messages to `conversation_store` (only on success; errors don't persist).
6. **Cleanup.** `StreamingResponse` closes; the per-request span finalises.

## Composition root: `lifespan(app)` builds `AppDependencies`

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    config = AgentConfig.from_env()
    bridges = await connect_mcp_bridges(config)
    checkpointer = await setup_checkpointer(config)
    graph = build_<agent>_graph(bridges=bridges, config=config, checkpointer=checkpointer)
    conversation_store = make_conversation_store(config)

    encoder_factory = lambda: DataStreamEncoder()

    def chat_service_factory(user_ctx: UserContext) -> ChatService:
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
        encoder_factory=encoder_factory,
        chat_service_factory=chat_service_factory,
        # ...remaining ports
    )
    yield
    # teardown
```

## Test composition

`tests/fakes/build_test_dependencies()` is the single knob:

```python
from tests.fakes.build_test_deps import build_test_dependencies

def test_my_endpoint():
    deps = build_test_dependencies(
        graph=my_stub_graph,
        chat_service_factory=my_factory,
    )
    app = create_app(deps)
    client = TestClient(app)
    # ...
```

Tests never run lifespan, never need Docker, never read environment.

## Reference

See `docs/superpowers/specs/2026-04-16-analytics-agent-soc-di-refactor-design.md` for the design rationale, and `docs/superpowers/plans/2026-04-16-analytics-agent-soc-di-refactor.md` for the phased implementation plan that this codebase follows.
