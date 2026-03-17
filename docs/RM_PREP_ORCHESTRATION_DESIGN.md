# RM Prep — Multi-Agent Orchestration Design

> **Pattern**: Streamlit Chat UI → LangGraph Orchestrator → Parallel Specialist Agents → Synthesizer
> **Author**: Enterprise Software Architect / Senior Agentic AI Developer
> **Date**: March 2026

---

## 1. Design Overview

The design follows a **hierarchical multi-agent pattern** built entirely on LangGraph `StateGraph`. The orchestrator is a state machine — not a ReAct loop. It uses a **small model (Haiku) for routing and specialist extraction**, and a **complex model (Sonnet) only for final synthesis**. This minimises cost and latency while producing reliable, high-quality output.

```
┌────────────────────────────────────────────────────────────────────┐
│  Streamlit Chat UI  (frontends/rm-prep-ui/app.py)                  │
│                                                                     │
│  RM types: "Prepare me for my meeting with Acme Manufacturing"     │
│                                                                     │
│  Shows: 🔍 CRM... | 💰 Payments... | 📰 News... | ✍️ Generating…   │
│  Renders final brief as formatted markdown                          │
│  Maintains full conversation history (follow-up questions work)     │
└───────────────────────────┬────────────────────────────────────────┘
                            │ POST /brief  (SSE streaming)
                            ▼
┌────────────────────────────────────────────────────────────────────┐
│  RM Prep Orchestrator  (agents/rm-prep/)                           │
│  LangGraph StateGraph  — the "brain"                               │
│                                                                     │
│  ┌──────────────┐     ┌──────────────┐     ┌────────────────────┐ │
│  │ parse_intent │────▶│    route     │────▶│   parallel fan-out │ │
│  │              │     │              │     │                    │ │
│  │ model: Haiku │     │ model: Haiku │     │  ┌─────────────┐  │ │
│  │              │     │              │     │  │  crm_agent  │  │ │
│  │ Extracts:    │     │ Returns:     │     │  │  (Haiku)    │  │ │
│  │ • client_name│     │ agents_to_   │     │  ├─────────────┤  │ │
│  │ • intent_type│     │ invoke list  │     │  │pay_agent    │  │ │
│  │ • rm_id      │     │              │     │  │ (Haiku)     │  │ │
│  └──────────────┘     └──────────────┘     │  ├─────────────┤  │ │
│                                            │  │news_agent   │  │ │
│                                            │  │ (Haiku)     │  │ │
│                                            │  └─────────────┘  │ │
│                                            └────────┬───────────┘ │
│                                                     │             │
│                                            ┌────────▼───────────┐ │
│                                            │    synthesize      │ │
│                                            │    model: Sonnet   │ │
│                                            │                    │ │
│                                            │  Reads all outputs │ │
│                                            │  → RMBrief Pydantic│ │
│                                            │  → Jinja2 markdown │ │
│                                            └────────────────────┘ │
│                                                                     │
│  Shared state (TypedDict): client_name, account_id, intent,        │
│    crm_output, payments_output, news_output, session_id, errors    │
│                                                                     │
│  Checkpointer: PostgreSQL (prod) / MemorySaver (dev)               │
│  → enables multi-turn: "What changed since last time?"             │
└────────────────────────────────────────────────────────────────────┘
          │                    │                    │
          │ MCP SSE            │ MCP SSE            │ MCP SSE
          ▼                    ▼                    ▼
   salesforce-mcp        payments-mcp         news-search-mcp
   :8081                 :8082                :8083
```

---

## 2. State Machine — Node by Node

The orchestrator is a `StateGraph[RMPrepState]`. Every piece of data flows through a single shared state object, so no node needs to pass arguments explicitly.

### Node 1: `parse_intent`

**Model**: Haiku (fast, cheap)
**Purpose**: Extract structured intent from the RM's free-text prompt.

Input: `state.messages` (the RM's chat message)
Output: writes `client_name`, `intent_type`, `meeting_date` into shared state

```python
# Intent types the router understands
class IntentType(str, Enum):
    FULL_BRIEF     = "full_brief"        # "prepare me for Acme meeting"
    QUICK_UPDATE   = "quick_update"      # "what's new with Acme?"
    NEWS_ONLY      = "news_check"        # "any news about Acme today?"
    PAYMENTS_ONLY  = "payment_check"     # "show me Acme payment trends"
    FOLLOW_UP      = "follow_up"         # follow-up in an existing session
```

For Phase 1, all intents route to all three agents. In Phase 2, `news_check` skips CRM and payments.

---

### Node 2: `route`

**Model**: Haiku
**Purpose**: Map intent → list of agent names to invoke in parallel.

```python
def route_node(state: RMPrepState) -> dict:
    routing_map = {
        IntentType.FULL_BRIEF:    ["crm", "payments", "news"],
        IntentType.QUICK_UPDATE:  ["crm", "payments", "news"],
        IntentType.NEWS_ONLY:     ["news"],
        IntentType.PAYMENTS_ONLY: ["payments"],
        IntentType.FOLLOW_UP:     ["crm"],  # only refresh CRM for follow-ups
    }
    agents = routing_map.get(state["intent_type"], ["crm", "payments", "news"])
    return {"agents_to_invoke": agents}
```

This is where conditional edges branch the graph.

---

### Nodes 3a/3b/3c: `gather_crm`, `gather_payments`, `gather_news`

**Model**: Haiku (each)
**Pattern**: Each is a `create_react_agent` built by `build_specialist_agent()`
**Execution**: **Parallel** via LangGraph's `Send()` API

Each specialist:
- Receives only the context it needs (client_name, account_id for payments)
- Calls its own MCP tool(s)
- Returns a structured JSON string into shared state
- Runs **concurrently** — combined latency = slowest single agent, not sum

```
Without parallelism:  CRM(4s) + Payments(3s) + News(5s) = 12 seconds
With parallel Send(): max(4s, 3s, 5s) = 5 seconds
```

**Critical design**: The CRM agent runs first (not in parallel with payments) because the payments agent needs `account_id` from the CRM response. Two options:

- **Option A**: CRM runs first → then payments and news run in parallel
- **Option B**: Payments tool also accepts `client_name` (with internal name resolution)

Recommendation: **Option A** — it keeps tool contracts clean and reflects the natural dependency.

```
parse_intent → route → gather_crm → [gather_payments ‖ gather_news] → synthesize
```

---

### Node 4: `synthesize`

**Model**: Sonnet (complex, authoritative)
**Purpose**: Read all tool outputs from shared state → produce structured `RMBrief`

Uses `with_structured_output(RMBrief)` to guarantee the exact section structure the spec requires. The synthesis model **never calls tools** — it only reads data already in state. This is the "mixture of experts" pattern: cheap specialists gather raw data, one expert model interprets and writes.

---

### Node 5: `format_brief` (lightweight, no LLM)

Renders the `RMBrief` Pydantic model through a Jinja2 template into the final markdown string. No model needed — pure string formatting.

---

## 3. Platform SDK Changes

### 3.1 `platform_sdk/config.py` — Add model tiering to `AgentConfig`

```python
@dataclass
class AgentConfig:
    # ---- existing fields ----
    model_route: str          = "complex-routing"   # primary (kept for backward compat)
    summary_model_route: str  = "fast-routing"

    # ---- NEW: multi-agent model tiering ----
    router_model_route: str      = "fast-routing"    # Haiku — intent parsing, routing
    specialist_model_route: str  = "fast-routing"    # Haiku — CRM, payments, news agents
    synthesis_model_route: str   = "complex-routing" # Sonnet — final brief generation

    # ---- NEW: session / checkpointer ----
    checkpointer_type: str       = "memory"          # "memory" | "postgres"
    checkpointer_db_url: str     = ""                # postgres://... (prod only)

    # ---- existing fields continue ----
    enable_compaction: bool      = True
    ...

    @classmethod
    def from_env(cls) -> "AgentConfig":
        return cls(
            ...
            router_model_route=os.environ.get("ROUTER_MODEL_ROUTE",      cls.router_model_route),
            specialist_model_route=os.environ.get("SPECIALIST_MODEL_ROUTE", cls.specialist_model_route),
            synthesis_model_route=os.environ.get("SYNTHESIS_MODEL_ROUTE",  cls.synthesis_model_route),
            checkpointer_type=os.environ.get("CHECKPOINTER_TYPE",          cls.checkpointer_type),
            checkpointer_db_url=os.environ.get("CHECKPOINTER_DB_URL",      cls.checkpointer_db_url),
        )
```

**Backward compatible**: `model_route` keeps its existing meaning for the existing `build_agent()`. New agents use the tiered fields.

---

### 3.2 `platform_sdk/state.py` — NEW file

Shared state schema that flows through the orchestrator and into every sub-agent.

```python
from typing import Annotated, Optional
from typing_extensions import TypedDict
from langgraph.graph.message import add_messages

class RMPrepState(TypedDict):
    # Conversation (append-only via add_messages reducer)
    messages: Annotated[list, add_messages]

    # Identity — populated by parse_intent
    rm_id: str
    client_name: str
    account_id: Optional[str]       # populated by crm_agent; used by payments_agent
    meeting_date: Optional[str]
    intent_type: str                 # full_brief | quick_update | news_check | ...
    agents_to_invoke: list[str]     # ["crm", "payments", "news"]

    # Specialist outputs — each agent writes its own key
    crm_output: Optional[str]
    payments_output: Optional[str]
    news_output: Optional[str]

    # Synthesis
    brief_markdown: Optional[str]

    # Error tracking — specialist writes here if its tool call fails
    error_states: dict              # {"crm": "Connection timeout", ...}

    # Session
    session_id: str                 # LangGraph thread_id for checkpointing
```

The `add_messages` reducer on `messages` means conversation history accumulates across turns automatically. All other fields are simple last-write-wins.

---

### 3.3 `platform_sdk/agent.py` — Add `build_specialist_agent()`

A thin variant of `build_agent()` that accepts a `model_override` parameter, so each specialist can be wired to a different LLM without changing the surrounding config.

```python
def build_specialist_agent(
    tools: list,
    config: AgentConfig,
    prompt: str,
    model_override: Optional[str] = None,  # ← NEW param
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
) -> CompiledGraph:
    """
    Same as build_agent() but allows a per-specialist model override.
    Used by the orchestrator to wire Haiku to specialist agents and
    Sonnet to the synthesis agent without separate AgentConfig objects.
    """
    effective_model = model_override or config.model_route
    # ... same body as build_agent() but uses effective_model
```

`build_agent()` itself is unchanged — fully backward compatible.

---

### 3.4 `platform_sdk/orchestrator.py` — NEW file

The orchestrator factory. This is the key new SDK primitive — it builds a `StateGraph` from specialist agents and wires in routing, parallel fan-out, synthesis, and the checkpointer.

```python
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

def build_orchestrator(
    state_schema: type,
    specialist_agents: dict,        # {"crm": compiled_graph, "payments": ..., "news": ...}
    router_llm,                     # Haiku model instance
    synthesis_llm,                  # Sonnet model instance
    synthesis_prompt: str,
    brief_schema: type,             # Pydantic model (RMBrief)
    brief_template: str,            # Jinja2 template string
    config: AgentConfig,
) -> CompiledGraph:

    builder = StateGraph(state_schema)

    # ── Nodes ──────────────────────────────────────────────────────
    builder.add_node("parse_intent", make_parse_intent_node(router_llm))
    builder.add_node("route",        make_route_node())
    builder.add_node("gather_crm",   make_specialist_node("crm", specialist_agents["crm"]))
    builder.add_node("gather_payments", make_specialist_node("payments", specialist_agents["payments"]))
    builder.add_node("gather_news",  make_specialist_node("news", specialist_agents["news"]))
    builder.add_node("synthesize",   make_synthesis_node(synthesis_llm, synthesis_prompt, brief_schema))
    builder.add_node("format_brief", make_format_node(brief_template))

    # ── Edges ──────────────────────────────────────────────────────
    builder.set_entry_point("parse_intent")
    builder.add_edge("parse_intent", "route")

    # CRM always runs first (payments needs account_id from CRM output)
    builder.add_conditional_edges("route", should_gather_crm, {
        True: "gather_crm",
        False: "gather_news",     # skip CRM for news-only intent
    })

    # After CRM, payments and news run in parallel via Send()
    builder.add_conditional_edges("gather_crm", fan_out_after_crm, ["gather_payments", "gather_news", "synthesize"])

    # Both parallel branches converge at synthesize
    builder.add_edge("gather_payments", "synthesize")
    builder.add_edge("gather_news",     "synthesize")
    builder.add_edge("synthesize",      "format_brief")
    builder.add_edge("format_brief",    END)

    # ── Checkpointer ───────────────────────────────────────────────
    checkpointer = _make_checkpointer(config)

    return builder.compile(checkpointer=checkpointer)


def _make_checkpointer(config: AgentConfig):
    if config.checkpointer_type == "postgres" and config.checkpointer_db_url:
        from langgraph.checkpoint.postgres import PostgresSaver
        return PostgresSaver.from_conn_string(config.checkpointer_db_url)
    return MemorySaver()
```

---

### 3.5 `platform_sdk/brief.py` — NEW file

```python
from pydantic import BaseModel, Field
from typing import Optional
from langchain_core.language_models import BaseChatModel

class RMBrief(BaseModel):
    client_name: str
    meeting_date: Optional[str]
    executive_summary: str
    recent_activity: str          = Field(description="CRM relationship history, last interactions, open tasks")
    payment_activity: str         = Field(description="90-day payment trends, volume, corridors")
    latest_news: str              = Field(description="Recent news headlines, summaries, sources")
    talking_points: list[str]     = Field(description="3-5 suggested discussion topics")
    suggested_questions: list[str]= Field(description="3-4 questions to ask the client")
    watch_items: str              = Field(description="Risks, opportunities, or items needing attention")
    sources: list[str]            = Field(description="Data sources used: [CRM], [Payments], [News]")


async def synthesize_brief(
    crm_output: Optional[str],
    payments_output: Optional[str],
    news_output: Optional[str],
    synthesis_llm: BaseChatModel,
    synthesis_prompt_template: str,
    client_name: str,
    meeting_date: Optional[str] = None,
) -> RMBrief:
    """
    Given raw tool outputs, use a structured LLM call to produce
    a guaranteed-schema RMBrief. Uses with_structured_output() so
    the output is always parseable — no markdown parsing needed.
    """
    structured_llm = synthesis_llm.with_structured_output(RMBrief)
    prompt = synthesis_prompt_template.format(
        client_name=client_name,
        meeting_date=meeting_date or "upcoming meeting",
        crm_data=crm_output or "[CRM data unavailable]",
        payments_data=payments_output or "[Payments data unavailable]",
        news_data=news_output or "[News search unavailable]",
    )
    return await structured_llm.ainvoke(prompt)
```

---

### 3.6 `platform_sdk/__init__.py` — Export new symbols

```python
# ADD to existing imports:
from .brief import RMBrief, synthesize_brief
from .orchestrator import build_orchestrator
from .state import RMPrepState  # or keep domain-specific state in the agent package

__all__ = [
    ...existing exports...
    "RMBrief",
    "synthesize_brief",
    "build_orchestrator",
]
```

Note: `RMPrepState` is intentionally NOT exported from the SDK — it belongs in `agents/rm-prep/src/` because it is domain-specific to the RM Prep Agent. Future agents will define their own state schemas.

---

## 4. Agent Layer Changes

### `agents/rm-prep/src/graph.py` — REWRITE as orchestrator

```python
"""
RM Prep Orchestrator — LangGraph StateGraph.

This module builds the full multi-agent pipeline:
  parse_intent → route → gather_crm → [gather_payments ‖ gather_news] → synthesize → format_brief

Each specialist agent (CRM, Payments, News) is a build_specialist_agent()
running Haiku. The synthesizer node runs Sonnet. The router runs Haiku.
All session state persists via a LangGraph checkpointer so follow-up
questions ("what changed since last time?") work across turns.
"""
from contextlib import asynccontextmanager
from langchain_mcp_adapters.client import MultiServerMCPClient

from platform_sdk import AgentConfig, build_specialist_agent, build_orchestrator
from platform_sdk.config import AgentConfig
from .state import RMPrepState
from .brief import RMBrief
from .prompts import load_prompt

_orchestrator = None

@asynccontextmanager
async def orchestrator_lifespan():
    global _orchestrator
    config = AgentConfig.from_env()

    # ── Open MCP connections ─────────────────────────────────────
    async with MultiServerMCPClient({
        "salesforce": {"url": config.salesforce_mcp_url, "transport": "sse"},
        "payments":   {"url": config.payments_mcp_url,   "transport": "sse"},
        "news":       {"url": config.news_mcp_url,        "transport": "sse"},
    }) as mcp_client:

        sf_tools  = mcp_client.get_tools(server_name="salesforce")
        pay_tools = mcp_client.get_tools(server_name="payments")
        news_tools = mcp_client.get_tools(server_name="news")

        # ── Build specialist agents (Haiku) ──────────────────────
        crm_agent  = build_specialist_agent(sf_tools,   config, load_prompt("crm_specialist.j2"),   model_override=config.specialist_model_route)
        pay_agent  = build_specialist_agent(pay_tools,  config, load_prompt("pay_specialist.j2"),   model_override=config.specialist_model_route)
        news_agent = build_specialist_agent(news_tools, config, load_prompt("news_specialist.j2"),  model_override=config.specialist_model_route)

        # ── Build orchestrator ────────────────────────────────────
        _orchestrator = build_orchestrator(
            state_schema=RMPrepState,
            specialist_agents={"crm": crm_agent, "payments": pay_agent, "news": news_agent},
            router_model_route=config.router_model_route,
            synthesis_model_route=config.synthesis_model_route,
            synthesis_prompt=load_prompt("rm_prep_synthesis.j2"),
            brief_schema=RMBrief,
            brief_template=load_prompt("rm_prep_brief.j2"),
            config=config,
        )

        yield


def get_orchestrator():
    if _orchestrator is None:
        raise RuntimeError("Orchestrator not initialised — call within lifespan context")
    return _orchestrator
```

---

### `agents/rm-prep/src/server.py` — Streaming `/brief` endpoint

```python
from fastapi import FastAPI, Depends, Security
from sse_starlette.sse import EventSourceResponse
from platform_sdk import make_api_key_verifier, get_logger
from .graph import orchestrator_lifespan, get_orchestrator
from .state import RMPrepState

log = get_logger(__name__)
verify_api_key = make_api_key_verifier()
app = FastAPI(lifespan=orchestrator_lifespan)

@app.post("/brief")
async def get_brief(
    request: BriefRequest,
    _: str = Security(verify_api_key),
):
    """
    Stream a meeting brief for the RM.

    Streams LangGraph events so the UI can show:
    - 🔍 Fetching CRM data...
    - 💰 Analysing payments...
    - 📰 Searching news...
    - ✍️ Generating brief...
    - ✅ Brief ready
    """
    orchestrator = get_orchestrator()

    async def event_stream():
        async for event in orchestrator.astream_events(
            {
                "messages": [HumanMessage(content=request.prompt)],
                "rm_id": request.rm_id,
                "session_id": request.session_id,
            },
            config={"configurable": {"thread_id": request.session_id}},
            version="v2",
        ):
            event_type = event.get("event")
            node_name  = event.get("metadata", {}).get("langgraph_node", "")

            # Emit progress events the UI can render
            if event_type == "on_chain_start" and node_name in _PROGRESS_LABELS:
                yield {"event": "progress", "data": _PROGRESS_LABELS[node_name]}

            # Emit the final brief when format_brief completes
            elif event_type == "on_chain_end" and node_name == "format_brief":
                brief_md = event["data"]["output"].get("brief_markdown", "")
                yield {"event": "brief", "data": brief_md}

            # Emit errors
            elif event_type == "on_chain_error":
                yield {"event": "error", "data": str(event.get("data", {}).get("error"))}

        # Log to audit table after streaming completes
        await _log_brief_to_db(request)

    return EventSourceResponse(event_stream())


_PROGRESS_LABELS = {
    "gather_crm":      "🔍 Fetching relationship data...",
    "gather_payments": "💰 Analysing payment trends...",
    "gather_news":     "📰 Searching latest news...",
    "synthesize":      "✍️ Generating your brief...",
    "format_brief":    "✅ Brief ready",
}
```

---

## 5. Prompts — Specialist Separation

Each specialist agent gets a narrow, focused prompt. This is the key quality driver — a specialist that only does one thing produces far cleaner tool outputs than a generalist juggling all three domains.

### `agents/rm-prep/src/prompts/crm_specialist.j2`
```
You are a CRM data specialist for a bank's relationship management team.
Your ONLY job is to call get_salesforce_summary with the client name
provided and return the raw JSON result. Do not interpret or summarize.
Extract account_id from the result — it will be needed for payments lookup.
If the client is not found, return: {"error": "client_not_found", "searched_name": "<name>"}
```

### `agents/rm-prep/src/prompts/pay_specialist.j2`
```
You are a payments data analyst.
Call get_payment_summary(client_id=<account_id from CRM>, days=90).
Focus on: total volumes, trend (increasing/decreasing %),
new payment corridors, unusual spikes or drops.
Return structured JSON. Do not invent any numbers.
```

### `agents/rm-prep/src/prompts/news_specialist.j2`
```
You are a financial news analyst.
Call search_company_news for the client.
Classify each article: expansion | risk | regulatory | financial_stress | neutral.
Return up to 5 relevant articles with title, source, date, url, summary, classification.
If no relevant news, return: {"articles": [], "signal": "no_recent_news"}
```

### `agents/rm-prep/src/prompts/rm_prep_synthesis.j2`
```
You are a senior banker preparing a Relationship Manager for a client meeting.

CONTEXT PROVIDED:
- CRM data: {{ crm_data }}
- Payment data: {{ payments_data }}
- News data: {{ news_data }}

RULES:
1. Every factual claim must cite its source: [CRM], [Payments], or [News]
2. Distinguish FACTS (from data) from INSIGHTS (your interpretation) — label both
3. Never invent payment figures. Use exact numbers from the data.
4. Do not provide financial advice. Use "may indicate", "worth discussing"
5. If data is missing for a section, state it explicitly rather than omitting the section
6. Recency: weight recent events more heavily than older ones
7. Change detection: highlight what is DIFFERENT since the last interaction

Generate a structured RM Meeting Brief for {{ client_name }} (meeting: {{ meeting_date }}).
```

---

## 6. Streamlit Chat UI — Pattern Change

The existing `frontends/rm-prep-ui/` needs to shift from a form-submit pattern to a **chat interface** with streaming and session persistence.

```python
# frontends/rm-prep-ui/app.py  — key pattern sketch

import streamlit as st
import httpx
import json

st.title("RM Meeting Prep")
st.caption("Ask about any client to generate a meeting brief")

# Session state — persists across Streamlit re-renders
if "messages" not in st.session_state:
    st.session_state.messages = []
if "session_id" not in st.session_state:
    st.session_state.session_id = str(uuid.uuid4())

# Render chat history
for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])

# Chat input
if prompt := st.chat_input("Ask about a client (e.g. 'Prepare me for Acme Manufacturing')"):

    # Show RM message immediately
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    # Stream the brief
    with st.chat_message("assistant"):
        status_placeholder = st.empty()
        brief_placeholder  = st.empty()
        brief_content = ""

        with httpx.Client(timeout=120) as client:
            with client.stream("POST", f"{RM_AGENT_URL}/brief", json={
                "prompt": prompt,
                "rm_id": st.session_state.rm_id,
                "session_id": st.session_state.session_id,
            }) as response:
                for line in response.iter_lines():
                    if line.startswith("data:"):
                        event = json.loads(line[5:])

                        if event["event"] == "progress":
                            status_placeholder.info(event["data"])

                        elif event["event"] == "brief":
                            brief_content = event["data"]
                            status_placeholder.empty()
                            brief_placeholder.markdown(brief_content)

                        elif event["event"] == "error":
                            status_placeholder.error(f"Error: {event['data']}")

    # Save to history (enables follow-up questions in next turn)
    st.session_state.messages.append({"role": "assistant", "content": brief_content})
```

**Key capability this unlocks**: Because the LangGraph checkpointer persists session state with `thread_id = session_id`, the RM can ask:

- Turn 1: *"Prepare me for Acme Manufacturing."*
- Turn 2: *"What about the German expansion — should I bring the FX hedging deck?"*
- Turn 3: *"Remind me what the treasury opportunity value is."*

Each follow-up is understood in context. No re-fetching of data already in session.

---

## 7. Model Tiering — Cost and Latency Impact

```
Node             Model            Why
─────────────────────────────────────────────────────────────────
parse_intent     Haiku            Extract: client_name, intent — simple structured extraction
route            (no LLM)         Pure Python dict lookup — deterministic, zero cost
gather_crm       Haiku            SQL result → JSON formatting, simple task
gather_payments  Haiku            Arithmetic, trend calculation — no creativity needed
gather_news      Haiku            Summarize headlines, classify sentiment — simple task
synthesize       Sonnet           Requires coherent reasoning, nuanced writing, insight
format_brief     (no LLM)         Jinja2 template render — zero cost
```

### Estimated cost per brief (Claude API, approximate)

```
parse_intent:  ~500 tokens  × Haiku rate  = ~$0.0003
gather_crm:    ~2000 tokens × Haiku rate  = ~$0.001
gather_pay:    ~1500 tokens × Haiku rate  = ~$0.0008
gather_news:   ~2000 tokens × Haiku rate  = ~$0.001
synthesize:    ~6000 tokens × Sonnet rate = ~$0.018
─────────────────────────────────────────────────────
Total per brief:                          ≈ $0.022

vs. Sonnet-only flat ReAct:
  ~12000 tokens × Sonnet rate             ≈ $0.036  (1.6× more expensive)
```

The tiered model is ~40% cheaper per brief and ~50% faster (parallel specialists + Haiku speed) while producing *higher quality output* because the synthesis model receives clean, pre-structured data rather than raw interleaved tool calls.

---

## 8. Session and Context Management

### LangGraph Checkpointer

The checkpointer is set when `build_orchestrator()` compiles the graph. It stores the full `RMPrepState` after each node run, indexed by `thread_id` (the session_id from the UI).

```
Dev  / CI:  MemorySaver        — in-process, no external deps
Prod:        PostgresSaver      — durable, survives restarts, queryable for audit
```

The `rm_prep_briefs` table (already in schema) stores each generated brief for compliance. The LangGraph checkpointer stores the conversation state for continuity. **These are separate concerns** — the checkpointer is transient UX state; the audit table is immutable compliance record.

### Compaction in the Orchestrator

The orchestrator's `messages` field grows across multi-turn conversations. Apply `make_compaction_modifier()` inside the `parse_intent` node — not at the `build_orchestrator()` level — so compaction happens once per turn, before the specialists are invoked.

```python
async def parse_intent_node(state: RMPrepState, config) -> dict:
    # Apply compaction to the message list before parsing
    compaction_modifier = make_compaction_modifier(agent_config)
    compacted_messages = compaction_modifier(state)
    # Now parse intent from (potentially trimmed) message history
    ...
```

### Caching (Multi-Layer)

```
Layer 1: MCP tool result cache (Redis, per-tool TTL)
  — prevents re-fetching CRM/payments data if the same client is queried
    twice within the TTL window (e.g. two RMs prepping for the same client)

Layer 2: LangGraph checkpointer (PostgreSQL)
  — persists full conversation state between turns
  — if RM asks a follow-up, the orchestrator reads existing crm_output
    from state instead of re-calling the CRM agent

Layer 3: LiteLLM semantic cache (if enabled on proxy)
  — deduplicate identical synthesis prompts at the LLM level
```

---

## 9. Complete Change List

### Platform SDK (`platform-sdk/platform_sdk/`)

| File | Change | Impact |
|---|---|---|
| `config.py` | Add `router_model_route`, `specialist_model_route`, `synthesis_model_route`, `checkpointer_type`, `checkpointer_db_url` to `AgentConfig` | Backward compatible — existing agents unaffected |
| `agent.py` | Add `build_specialist_agent(tools, config, prompt, model_override=None)` | Additive — `build_agent()` unchanged |
| `orchestrator.py` | **NEW** — `build_orchestrator()` factory for StateGraph pipelines | New SDK primitive |
| `state.py` | **NEW** — generic `BaseOrchestratorState` TypedDict (no domain fields) | New SDK primitive |
| `brief.py` | **NEW** — `RMBrief` Pydantic model + `synthesize_brief()` | New SDK primitive |
| `__init__.py` | Export: `build_specialist_agent`, `build_orchestrator`, `RMBrief`, `synthesize_brief` | Additive |
| `pyproject.toml` | Add: `langgraph-checkpoint-postgres>=2.0`, `sse-starlette>=2.0`, `pydantic>=2.0` | New dependencies |

### Agent Layer (`agents/rm-prep/`)

| File | Change |
|---|---|
| `src/state.py` | **NEW** — `RMPrepState` TypedDict (domain-specific, not in SDK) |
| `src/graph.py` | **REWRITE** — orchestrator StateGraph with multi-MCP lifespan |
| `src/server.py` | **REWRITE** — streaming `/brief` SSE endpoint, audit logging |
| `src/brief.py` | **NEW** — local `RMBrief` usage + brief rendering logic |
| `src/prompts/crm_specialist.j2` | **NEW** — narrow CRM-only specialist prompt |
| `src/prompts/pay_specialist.j2` | **NEW** — payments-only specialist prompt |
| `src/prompts/news_specialist.j2` | **NEW** — news-only specialist prompt |
| `src/prompts/rm_prep_synthesis.j2` | **NEW** — synthesis prompt for Sonnet |
| `src/prompts/rm_prep_brief.j2` | **NEW** — Jinja2 brief markdown template |
| `requirements.txt` | Add: `sse-starlette`, `langgraph-checkpoint-postgres`, `pydantic>=2.0` |

### Frontend (`frontends/rm-prep-ui/`)

| File | Change |
|---|---|
| `app.py` | **REWRITE** — chat interface with SSE streaming, session persistence |
| `requirements.txt` | Add: `httpx[http2]`, `streamlit>=1.35` |

### Infrastructure

| File | Change |
|---|---|
| `docker-compose.yml` | Add `ROUTER_MODEL_ROUTE`, `SPECIALIST_MODEL_ROUTE`, `SYNTHESIS_MODEL_ROUTE`, `CHECKPOINTER_TYPE`, `CHECKPOINTER_DB_URL` to rm-prep-agent service |
| `.env.example` | Add model tiering env vars, checkpointer config |
| `tools/policies/opa/tool_auth.rego` | Add `rm_prep_agent` role with access to all 3 new tool names |

---

## 10. What This Pattern Enables Beyond Phase 1

The `build_orchestrator()` pattern is not RM-prep-specific. Every future agent in the platform can be built this way:

```
Credit Review Agent:
  Orchestrator → [financial_statements_agent ‖ risk_rating_agent ‖ covenant_agent] → credit_memo_synthesizer

Trade Finance Agent:
  Orchestrator → [LC_status_agent ‖ compliance_check_agent ‖ FX_rate_agent] → trade_brief_synthesizer

Onboarding Agent:
  Orchestrator → [KYC_agent ‖ credit_bureau_agent ‖ sanctions_agent] → onboarding_recommendation
```

The platform SDK provides the scaffolding (`build_orchestrator`, `build_specialist_agent`, `synthesize_brief`). Each new agent only needs to define its state schema, its tool set, and its prompts.

---

## 11. Phase 1 vs. This Design

The Phase 1 analysis document recommended "flat ReAct with structured synthesis" as the simplest path to a working MVP. This orchestration design is the **direct upgrade path** — the same MCP servers, same tool contracts, same `RMBrief` Pydantic model — but with the flat ReAct replaced by the StateGraph.

**Recommendation**: Build Phase 1 with the orchestrator architecture from day one. The extra complexity over flat ReAct is:
- One additional SDK file (`orchestrator.py`)
- Four additional prompt files
- One state schema file

The parallel execution, model tiering, and session persistence you get in return are **not retrofittable** to a flat ReAct without a full rewrite. Building it right the first time is the correct architectural decision.
