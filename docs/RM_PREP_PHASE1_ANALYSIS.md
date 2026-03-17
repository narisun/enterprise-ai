# RM Prep Agent – Phase 1 Architecture Analysis & Recommendations

> **Author**: Enterprise Software Architect / Senior Agentic AI Developer
> **Date**: March 2026
> **Scope**: Phase 1 MVP Specification gap analysis, architectural fit assessment, and concrete implementation recommendations against the existing enterprise AI platform.

---

## 1. Executive Assessment

The Phase 1 specification is well-scoped and realistic. The core value proposition — reducing RM prep time from 20–30 minutes to under 2 minutes — is achievable with the existing platform SDK. However, the spec makes **seven architectural assumptions** that need to be resolved before implementation begins.

**Overall verdict**: The spec is buildable on top of the current platform with targeted additions. Two concerns require design decisions before writing a line of code: **output reliability** (the brief structure cannot be guaranteed by a plain ReAct agent) and **multi-MCP orchestration** (the current `build_agent()` is designed for a single MCP server, not three simultaneous ones).

---

## 2. Spec vs. Platform Reality — Gap Analysis

### 2.1 What the Platform Already Provides

| Spec Requirement | Platform Asset | Status |
|---|---|---|
| LangGraph ReAct agent | `build_agent()` in `platform_sdk/agent.py` | ✅ Ready |
| API authentication for agent | `make_api_key_verifier()` in `platform_sdk/security.py` | ✅ Ready |
| Tool result caching | `ToolResultCache` + `cached_tool()` in `platform_sdk/cache.py` | ✅ Ready |
| Context window management | `make_compaction_modifier()` in `platform_sdk/compaction.py` | ✅ Ready |
| Config from environment | `AgentConfig.from_env()`, `MCPConfig.from_env()` | ✅ Ready |
| MCP server pattern | FastMCP + SSE pattern in `tools/data-mcp/` | ✅ Ready |
| Structured logging + telemetry | `platform_sdk/logging.py`, `platform_sdk/telemetry.py` | ✅ Ready |
| Docker + Compose deployment | `docker-compose.yml`, existing services | ✅ Ready |
| OPA entitlement framework | `OpaClient` in `platform_sdk/security.py` | ✅ Ready |
| Audit table | `rm_prep_briefs` in `rm_prep_schema.sql` | ✅ Ready |
| Test data | `rm_prep_schema.sql` + `rm_prep_seed.sql` | ✅ Ready |

### 2.2 Gaps That Need Resolution

| # | Gap | Risk Level | Impact |
|---|---|---|---|
| G1 | `build_agent()` connects to one MCP server; spec requires 3 simultaneously | **High** | Won't compile / agent has no tools |
| G2 | ReAct agents are not guaranteed to call all 3 tools | **High** | Brief may silently omit a data source |
| G3 | Plain ReAct produces unstructured markdown, not a formatted 7-section brief | **High** | RM satisfaction target unachievable |
| G4 | Client name → `account_id` resolution must happen before the payments call | **Medium** | Payments tool returns empty results without `account_id` |
| G5 | No Tavily key in dev environment; news tool needs graceful mock fallback | **Medium** | Agent fails on startup or returns empty news section |
| G6 | Guardrails are prompt-only; hallucination rate target (<5%) is not enforced structurally | **Medium** | Metric unverifiable; no test harness |
| G7 | Spec says "Simple web page or Slack/Teams bot" but provides no front-end detail | **Low** | Streamlit is a safe choice; need to confirm auth pattern |

---

## 3. Design Decisions Required

### Decision 1: Agent Pattern — Flat ReAct vs. Structured Workflow

**The spec's flow diagram** shows a strictly sequential pipeline:
```
RM Prompt → Identify Client → Call Salesforce → Call Payments → Call News → Reason → Generate Brief
```

This looks like a `StateGraph`, not a `create_react_agent`. However, the spec also says "Agent Framework: LangGraph or ADK" without mandating one pattern.

**Option A — Flat ReAct (current `build_agent()`)**
The agent decides which tools to call and in what order. Simple, but:
- Not guaranteed to call all three tools (especially news if CRM is rich)
- Output format depends entirely on the prompt
- Harder to audit "which tools were called for this brief"

**Option B — Forced Sequential StateGraph**
Define nodes: `identify_client` → `fetch_crm` → `fetch_payments` → `fetch_news` → `synthesize` → `format_brief`. Guarantees all sources are consulted, natural audit trail, easier to test each node independently. More code upfront.

**Option C — ReAct with Structured Synthesis (Recommended for Phase 1)**
Use `create_react_agent` but give it a tool-calling instruction that forces it to invoke all three tools, then pass all raw tool outputs into a **second LLM call** that formats the structured brief using a Jinja2 template. This is the cheapest way to get structured output without building a full StateGraph.

```
ReAct agent (tool calls only, no final response)
    ↓
Structured synthesis prompt (takes raw tool outputs → Pydantic model)
    ↓
Jinja2 brief formatter
    ↓
RM Meeting Brief (guaranteed 7-section structure)
```

**Recommendation**: Option C for Phase 1. It reuses `build_agent()` unchanged, adds one synthesis step, and is upgradeable to Option B in Phase 2 by replacing the synthesis step with a proper StateGraph node.

---

### Decision 2: Multi-MCP Tool Assembly

The current `build_agent()` signature is:
```python
def build_agent(tools: list, config: AgentConfig, prompt: str, ...) -> CompiledGraph:
```

It takes a flat `tools` list. The MCP connections are made in the agent service's lifespan, **not inside `build_agent()`**. This means multi-MCP is already supported — the rm-prep `graph.py` just needs to open MCP connections to all three servers and merge their tool lists before calling `build_agent()`.

**Concrete change needed in `graph.py`**:
```python
# Current pattern (single MCP):
async with MCPClient(url) as client:
    tools = await client.get_tools()
    agent = build_agent(tools, config, prompt)

# New pattern (three MCPs merged):
async with (
    MCPClient(salesforce_mcp_url) as sf_client,
    MCPClient(payments_mcp_url) as pay_client,
    MCPClient(news_mcp_url) as news_client,
):
    tools = (
        await sf_client.get_tools()
        + await pay_client.get_tools()
        + await news_client.get_tools()
    )
    agent = build_agent(tools, config, prompt)
```

**No SDK change required.** The multi-MCP pattern is a `graph.py` concern, not a platform SDK concern. This is the correct separation of concerns.

---

### Decision 3: Output Reliability — Structured Brief

The spec's sample output has eight named sections with specific fields. A plain `agent.invoke()` call returns a LangChain message, not a Pydantic model. To guarantee structure, add a thin synthesis layer using Pydantic + `with_structured_output()`:

```python
class RMBrief(BaseModel):
    client_name: str
    meeting_date: str
    executive_summary: str
    recent_activity: str
    payment_activity: str
    latest_news: str
    talking_points: list[str]
    suggested_questions: list[str]
    watch_items: str
    sources: list[str]

# After all tool calls complete, pass accumulated data:
synthesis_llm = llm.with_structured_output(RMBrief)
brief = synthesis_llm.invoke(synthesis_prompt)
```

This is a **platform SDK addition** — a new function `synthesize_brief(tool_outputs, config, brief_schema)` in `platform_sdk/brief.py` (already identified in RM_PREP_AGENT_ARCHITECTURE.md).

---

### Decision 4: Client Identity Resolution

The spec defines:
- Salesforce tool input: `client_name` (string)
- Payments tool input: `client_id` + `date_range`

The `client_id` is not known to the RM — they type "Acme Manufacturing". The Salesforce tool must return the `account_id` in its response, and the agent must pass it to the payments tool.

**Two approaches:**

**Approach A (Tool Contract)**: Salesforce tool returns `account_id` as a field in its JSON response. The ReAct agent extracts it from the tool output and passes it to the payments tool. This requires the agent to reason about tool chaining.

**Approach B (Name-based Lookup)**: The payments tool also accepts `client_name` and performs its own CRM lookup internally to resolve the ID. Simpler for the agent, more coupling between tools.

**Recommendation**: Approach A — the tool contract approach. It keeps tools independent and lets the agent reason. The prompt instructs the agent to extract `account_id` from the Salesforce response before calling the payments tool. This is natural ReAct behavior.

---

### Decision 5: News Tool — Tavily vs. Mock

The spec recommends Tavily. For Phase 1 development and CI/CD, a mock fallback is essential.

**Implementation**: The news MCP server checks `TAVILY_API_KEY` at startup:
- If set → use Tavily client
- If not set → return deterministic mock news seeded per company name

This lets developers run the full stack locally without a paid API key, and ensures the test suite is deterministic.

---

## 4. Architecture Diagram — Phase 1 Target State

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  FRONTEND                                                                    │
│  frontends/rm-prep-ui/   (Streamlit :8502)                                  │
│  RM types: "Prepare me for meeting with Acme Manufacturing"                  │
└───────────────────────────┬─────────────────────────────────────────────────┘
                            │ HTTP POST /brief  {prompt: "..."}
                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  AGENT LAYER                                                                 │
│  agents/rm-prep/   (FastAPI :8003)                                           │
│                                                                              │
│  1. API key auth  (make_api_key_verifier)                                    │
│  2. Lifespan: connect to 3 MCP bridges, merge tool lists                     │
│  3. build_agent([sf_tools + pay_tools + news_tools], config, prompt)         │
│  4. agent.invoke({"messages": [HumanMessage(content=rm_prompt)]})            │
│  5. synthesize_brief(tool_outputs) → RMBrief (structured Pydantic)           │
│  6. Render Jinja2 brief template → markdown string                           │
│  7. INSERT INTO rm_prep_briefs (audit)                                       │
│  8. Return {brief: "...", sources: [...], metadata: {...}}                   │
└────┬───────────────────────┬───────────────────────┬────────────────────────┘
     │ MCP SSE               │ MCP SSE               │ MCP SSE
     ▼                       ▼                       ▼
┌──────────────┐    ┌─────────────────┐    ┌──────────────────────┐
│ salesforce-  │    │  payments-mcp   │    │  news-search-mcp     │
│ mcp  :8081   │    │  :8082          │    │  :8083               │
│              │    │                 │    │                      │
│ get_         │    │ get_payment_    │    │ search_company_      │
│ salesforce_  │    │ summary(        │    │ news(company_name)   │
│ summary(     │    │   client_id,    │    │                      │
│   client_    │    │   days=90)      │    │ Tavily or mock       │
│   name)      │    │                 │    │                      │
│              │    │ cached_tool     │    │ cached_tool          │
│ cached_tool  │    │ TTL: 3600s      │    │ TTL: 1800s           │
│ TTL: 1800s   │    │                 │    │                      │
└──────┬───────┘    └──────┬──────────┘    └──────────────────────┘
       │                   │
       ▼                   ▼
┌──────────────────────────────────┐    ┌──────────────────────────┐
│  PostgreSQL                      │    │  Redis                   │
│  platform/db/                    │    │  Tool result cache       │
│  • sf_accounts                   │    │  (salesforce + payments) │
│  • sf_contacts                   │    └──────────────────────────┘
│  • sf_activities                 │
│  • sf_opportunities              │
│  • sf_tasks                      │
│  • payment_transactions          │
│  • rm_prep_briefs (audit)        │
└──────────────────────────────────┘
```

---

## 5. Concrete Codebase Changes

### 5.1 New Files to Create

```
tools/
  salesforce-mcp/
    Dockerfile
    requirements.txt
    src/
      __init__.py
      server.py           ← get_salesforce_summary(client_name)

  payments-mcp/
    Dockerfile
    requirements.txt
    src/
      __init__.py
      server.py           ← get_payment_summary(client_id, days=90)

  news-search-mcp/
    Dockerfile
    requirements.txt
    src/
      __init__.py
      server.py           ← search_company_news(company_name)
                             └ TAVILY_API_KEY set → Tavily
                             └ not set → mock data

agents/
  rm-prep/
    Dockerfile
    requirements.txt
    src/
      __init__.py
      graph.py            ← multi-MCP lifespan, build_agent with 3 tool sources
      server.py           ← FastAPI, /brief endpoint, audit logging
      brief.py            ← RMBrief Pydantic model + synthesize_brief()
      prompts/
        rm_prep_system.j2 ← system prompt with output format instructions
        rm_prep_synthesis.j2 ← synthesis prompt for structured extraction

frontends/
  rm-prep-ui/
    Dockerfile
    requirements.txt
    app.py                ← Streamlit UI

platform/
  db/
    rm_prep_schema.sql    ✅ done
    rm_prep_seed.sql      ✅ done
```

### 5.2 Changes to Existing Files

| File | Change |
|---|---|
| `docker-compose.yml` | Add 5 new services: salesforce-mcp, payments-mcp, news-search-mcp, rm-prep-agent, rm-prep-ui |
| `tools/policies/opa/tool_auth.rego` | Add rules for 3 new tool names, `rm_prep_agent` role |
| `.env.example` | Add `TAVILY_API_KEY`, `RM_PREP_AGENT_URL`, `SALESFORCE_MCP_URL`, `PAYMENTS_MCP_URL`, `NEWS_MCP_URL` |

### 5.3 Platform SDK Additions (Recommended, Not Blocking)

These are optional for Phase 1 but should be added as part of Phase 1 delivery to avoid accruing technical debt:

**`platform_sdk/brief.py`** (new)
```python
# Structured brief synthesis using with_structured_output()
class RMBrief(BaseModel): ...
async def synthesize_brief(tool_outputs: dict, llm, synthesis_prompt: str) -> RMBrief: ...
```

This keeps structured output logic in the SDK so the next agent (e.g., a Credit Review Agent) can reuse the pattern.

---

## 6. Tool Contract Specifications

### Tool 1: `get_salesforce_summary`

**Input**: `client_name: str`
**Output** (JSON string):
```json
{
  "account_id": "0015f00001ACME001",
  "account_name": "Acme Manufacturing",
  "industry": "Manufacturing",
  "segment": "enterprise",
  "account_owner": "Sarah Chen",
  "annual_revenue": 500000000,
  "key_contacts": [
    {"name": "Robert Harrington", "title": "CFO", "last_contacted": "2026-02-25"}
  ],
  "recent_activities": [
    {"date": "2026-02-25", "type": "meeting", "subject": "...", "notes": "..."}
  ],
  "open_opportunities": [
    {"name": "Treasury Services", "stage": "Proposal", "amount": 1200000, "next_steps": "..."}
  ],
  "open_tasks": [
    {"subject": "Send treasury proposal", "due_date": "2026-03-20", "priority": "High"}
  ],
  "retrieved_at": "2026-03-16T10:00:00Z"
}
```

**Cache TTL**: 1800 seconds (30 minutes)

---

### Tool 2: `get_payment_summary`

**Input**: `client_id: str`, `days: int = 90`
**Output** (JSON string):
```json
{
  "account_id": "0015f00001ACME001",
  "period_days": 90,
  "total_outbound_usd": 8450000.00,
  "total_inbound_usd": 6950000.00,
  "by_type": {
    "wire": {"count": 12, "total_usd": 5600000},
    "ach":  {"count": 18, "total_usd": 3460000},
    "swift":{"count": 0,  "total_usd": 0}
  },
  "international_corridors": ["Germany", "Netherlands", "Japan", "South Korea"],
  "new_corridors_vs_prior_period": ["South Korea"],
  "volume_trend_pct": 15.2,
  "trend_label": "INCREASING",
  "top_counterparties": [
    {"name": "Schultz Precision GmbH", "country": "Germany", "total_usd": 2120000}
  ],
  "retrieved_at": "2026-03-16T10:00:00Z"
}
```

**Cache TTL**: 3600 seconds (1 hour — payments data is updated in batch)

**Important**: The agent must extract `account_id` from the Salesforce tool output and pass it as `client_id` to this tool. The system prompt must explicitly instruct this.

---

### Tool 3: `search_company_news`

**Input**: `company_name: str`
**Output** (JSON string):
```json
{
  "company": "Acme Manufacturing",
  "articles": [
    {
      "title": "Acme Manufacturing announces European expansion",
      "source": "Reuters",
      "published_date": "2026-03-12",
      "url": "https://reuters.com/...",
      "summary": "Acme Manufacturing plans to open two distribution centers in Germany...",
      "sentiment": "positive",
      "signal_type": "expansion"
    }
  ],
  "signal_summary": "Expansion into European markets. No negative news detected.",
  "searched_at": "2026-03-16T10:00:00Z"
}
```

**Cache TTL**: 1800 seconds (30 minutes)

---

## 7. System Prompt Design

The spec's system prompt is too brief for production. The actual prompt must:

1. **Force all three tools** — the agent must not skip any
2. **Define the tool-chaining order** — Salesforce first (to get account_id), then Payments, then News
3. **Define exact output sections** — prevents format drift between LLM invocations
4. **Enforce guardrails** — label facts vs. insights, never invent payment figures
5. **Handle missing data gracefully** — if a tool returns an error, note it in the relevant section

The system prompt template (Jinja2) structure:

```
You are a preparation assistant for bank Relationship Managers.

INSTRUCTIONS:
1. ALWAYS call all three tools in this order:
   a. get_salesforce_summary(client_name) — use the exact client name from the RM's request
   b. get_payment_summary(client_id, days=90) — use the account_id returned by the Salesforce tool
   c. search_company_news(company_name) — use the account_name returned by the Salesforce tool

2. DO NOT skip any tool. Even if the client is well-known, always fetch fresh data.

3. After collecting all tool outputs, produce a structured RM Meeting Brief with exactly
   these 7 sections: Executive Summary, Recent Relationship Activity, Payment Activity,
   Latest News, Suggested Talking Points, Suggested Questions, Watch Items.

GUARDRAILS:
- Never invent payment figures. If payment data is missing, say "Payment data unavailable."
- Label every insight with its source: [CRM], [Payments], [News]
- Distinguish FACT (from tool output) from INSIGHT (your interpretation)
- Never provide financial advice. Use language like "may indicate", "worth discussing"
- If the client is not found in Salesforce, say so explicitly and halt

Today's date: {{ today }}
Preparing for: {{ rm_name }}
```

---

## 8. Critical Risk: Hallucination Rate Target

The spec sets a hallucination rate target of **<5%**. This is a measurable production metric, but there is no test harness for it in the Phase 1 spec.

**Recommended approach for Phase 1**:

1. **Structured synthesis** (Decision 3 above) eliminates narrative hallucination — the LLM cannot invent section headings it wasn't given.
2. **Source labelling** — every material claim in the brief cites `[CRM]`, `[Payments]`, or `[News]`. An evaluator can spot-check these.
3. **Deterministic test cases** — the four seed data companies (Acme, ABC Logistics, GlobalTech, Meridian) have known ground truth. Add a `tests/` directory with expected brief assertions:
   - Acme brief must contain "treasury" and "Germany" and "15%" trend
   - GlobalTech brief must contain "CFO departure" and "declining" and "banking review"
   - Meridian brief must contain "Canada" and "FX"
4. **Add `tests/test_rm_prep_briefs.py`** as part of the Phase 1 delivery.

---

## 9. Caching Architecture

Caching strategy is critical for the <2 minute SLA and for protecting the database from concurrent RM requests.

```
Tool              Cache TTL   Rationale
──────────────────────────────────────────────────────────────
salesforce-mcp    1800s       CRM notes updated by RMs, not real-time; 30min stale is fine
payments-mcp      3600s       Payment data is batch-loaded nightly in most bank systems
news-search-mcp   1800s       News cycle; 30min reuse acceptable
rm_prep_briefs    NO CACHE    Each brief is unique per RM + client + time; insert-only
```

The existing `cached_tool()` decorator in `platform_sdk/cache.py` handles all of this. Each MCP server sets its TTL via `MCPConfig.from_env()`:
```bash
# salesforce-mcp
TOOL_CACHE_TTL=1800

# payments-mcp
TOOL_CACHE_TTL=3600

# news-search-mcp
TOOL_CACHE_TTL=1800
```

---

## 10. Error Handling Strategy

The spec does not address partial failures. For production-readiness, the agent must handle:

| Failure Scenario | Expected Behaviour |
|---|---|
| Client not in Salesforce | Return error: "Client 'X' not found in CRM. Please verify the name." |
| Payments DB connection down | Brief includes "[Payments data unavailable — system error]" |
| Tavily API down or rate-limited | Fall back to mock news or "[News search unavailable]" |
| All three tools succeed but client has no activity | Brief notes sparse data: "No recent activities logged in the past 90 days." |
| LLM timeout on synthesis | Return partial brief with tool data as JSON, flagged as unformatted |

This error handling lives in the rm-prep agent's `server.py`, not in the MCP servers or the SDK.

---

## 11. Phase 1 Delivery Checklist

### Database
- [x] `platform/db/rm_prep_schema.sql` — schema
- [x] `platform/db/rm_prep_seed.sql` — 4 test companies

### MCP Servers (tools)
- [ ] `tools/salesforce-mcp/` — Salesforce summary tool
- [ ] `tools/payments-mcp/` — Payments summary tool
- [ ] `tools/news-search-mcp/` — News search tool (Tavily + mock)

### Agent
- [ ] `agents/rm-prep/src/graph.py` — multi-MCP lifespan, `build_agent`
- [ ] `agents/rm-prep/src/server.py` — `/brief` endpoint, audit logging
- [ ] `agents/rm-prep/src/brief.py` — `RMBrief` Pydantic model + synthesis
- [ ] `agents/rm-prep/src/prompts/rm_prep_system.j2` — system prompt
- [ ] `agents/rm-prep/src/prompts/rm_prep_synthesis.j2` — synthesis prompt

### Frontend
- [ ] `frontends/rm-prep-ui/app.py` — Streamlit UI

### Infrastructure
- [ ] `docker-compose.yml` — 5 new services
- [ ] `tools/policies/opa/tool_auth.rego` — new tool permissions
- [ ] `.env.example` — new env vars

### Tests
- [ ] `tests/test_rm_prep_briefs.py` — ground-truth brief assertions

### Platform SDK (Phase 1 addition)
- [ ] `platform-sdk/platform_sdk/brief.py` — `RMBrief` model + `synthesize_brief()`

---

## 12. What Is Deliberately Deferred to Phase 2

The following items from the full RM_PREP_AGENT_ARCHITECTURE.md are **not** in scope for Phase 1:

| Feature | Rationale for Deferral |
|---|---|
| Hierarchical StateGraph orchestrator | Phase 1 can prove value with flat ReAct; add complexity when warranted |
| Five specialist sub-agents (CRM, Banking, Compliance, etc.) | Over-engineered for 3-tool MVP |
| Three-tier OPA entitlement (RM-client assignment, domain clearance, field redaction) | Phase 1 auth is API key per RM; OPA enforcement is Phase 2 |
| Real Salesforce REST API integration | Phase 1 uses mock PostgreSQL database |
| Per-field evidence chain (`DomainEvidence`, `Citation`) | Phase 1 source labelling via prompt is sufficient |
| Parallel tool execution | Sequential is sufficient for <2min target at Phase 1 scale |
| Salesforce/calendar/banker desktop embedding | Phase 1 is Streamlit standalone |
| Streaming brief generation | Synchronous is fine for Phase 1 |
| Teams/Copilot plugin | Phase 3 |

---

## 13. Implementation Order

Given the above analysis, the recommended build order is:

```
1. platform/db/  ← already done (schema + seed)
2. tools/salesforce-mcp/   ← foundation; other tools depend on account_id pattern
3. tools/payments-mcp/     ← depends on account_id from Salesforce output
4. tools/news-search-mcp/  ← independent; build with mock-first approach
5. agents/rm-prep/         ← consumes all three; build last in agent layer
6. frontends/rm-prep-ui/   ← consumes the agent /brief endpoint
7. docker-compose.yml      ← wire everything together
8. OPA + .env updates      ← security and config
9. tests/                  ← validate ground-truth with seed data
```

This order minimises integration surprises — each layer is tested before the next depends on it.
