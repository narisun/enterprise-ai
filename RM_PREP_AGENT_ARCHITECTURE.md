# RM Prep Agent — Architecture Assessment & Design

**Role:** Enterprise Software Architect + Lead Agentic AI Developer
**Scope:** Validate existing platform, identify gaps, and design the RM Prep Agent

---

## Table of Contents

1. [Current Platform Assessment](#1-current-platform-assessment)
2. [RM Prep Agent Requirements Analysis](#2-rm-prep-agent-requirements-analysis)
3. [Why the Current Pattern Is Not Enough](#3-why-the-current-pattern-is-not-enough)
4. [Recommended Architecture: Hierarchical Multi-Agent with Parallel Specialists](#4-recommended-architecture-hierarchical-multi-agent-with-parallel-specialists)
5. [New MCP Servers Required](#5-new-mcp-servers-required)
6. [Platform SDK Enhancements Required](#6-platform-sdk-enhancements-required)
7. [OPA Policy & Entitlement Enhancements](#7-opa-policy--entitlement-enhancements)
8. [Evidence Chain & Auditability Design](#8-evidence-chain--auditability-design)
9. [The Pre-Meeting Brief: Structured Output Design](#9-the-pre-meeting-brief-structured-output-design)
10. [Frontend Strategy: Streamlit + Future Embedding](#10-frontend-strategy-streamlit--future-embedding)
11. [Phased Delivery Plan](#11-phased-delivery-plan)
12. [Risk Register](#12-risk-register)

---

## 1. Current Platform Assessment

### What the platform does well

The existing platform is a solid foundation. Before designing the RM Prep Agent, it is worth being explicit about what already works, because the goal is to build on these strengths rather than work around them.

**Separation of concerns via platform-sdk** is the most valuable asset. Security (`OpaClient`), caching (`ToolResultCache`), configuration (`AgentConfig`, `MCPConfig`), compaction, and observability are all extracted from service code. A new agent or MCP server inherits all of these at zero marginal cost. This is the right foundation for a multi-service agentic system.

**The MCP pattern scales well.** FastMCP servers are independently deployable, independently testable, and independently versioned. The RM Prep Agent will need five or six new data-source servers — the platform is already wired to support this without architectural changes.

**OPA for tool-level authorization** is the correct pattern for a regulated bank. Policy is code, tested, and version-controlled. The current implementation is fail-closed and server-stamped.

**LiteLLM as the proxy layer** removes vendor lock-in from the agent code entirely. The RM Prep Agent can route different tasks to different models (GPT-4o for synthesis, GPT-4o-mini for fast lookups) by adding LiteLLM route names — no agent code changes.

**Redis for two independent caching tiers** (LiteLLM prompt cache + tool result cache) directly addresses the RM use case where the same client data will be requested repeatedly across multiple RM sessions in a day.

**OpenTelemetry distributed tracing** is already in every service. Compliance and audit teams will require end-to-end trace visibility for the RM Prep Agent — this is already wired.

### What is missing or insufficient for the RM Prep Agent

| Gap | Impact | Section |
|---|---|---|
| Flat `create_react_agent` only — no multi-agent orchestration | Cannot run five specialist agents in parallel | §3, §4 |
| No structured output with citation tracking | Brief cannot be evidence-backed or auditable | §8, §9 |
| Tool-level OPA only — no data-level / RM-to-client entitlements | A RM could request data for clients they do not cover | §7 |
| Single global TTL per `ToolResultCache` | Compliance data must never be cached; web data needs a different TTL than CRM data | §6 |
| No orchestration state — agents are stateless per turn | Multi-stage brief generation needs state across specialist calls | §4 |
| No brief template / structured output SDK module | Every agent would hand-roll JSON schemas for the brief | §6, §9 |
| Streamlit frontend does not exist | RMs need a purpose-built prep UI, not a general chat box | §10 |
| No RAG / vector retrieval integration | Relationship history, past briefs, and institutional memory require similarity search | §6 |

---

## 2. RM Prep Agent Requirements Analysis

### What the agent must produce

The RM Prep Agent is not a conversational chatbot. It is a **batch-style, document-generating agent** triggered by an upcoming meeting event. Its primary output is a structured pre-meeting brief containing:

- Relationship summary (who is this client, what is the full picture)
- Recent changes (last 30–90 days: balance movements, new facilities, incidents)
- Opportunities (pipeline signals, product gaps, life events)
- Risks (compliance flags, service deterioration, market signals)
- Talking points (suggested conversation openers, grounded in data)
- Recommended next actions (concrete, time-boxed, assigned)

Every point in the brief must be **traceable to a named data source** with a retrieval timestamp. A compliance officer must be able to open the brief six months later and reconstruct exactly what data was seen and when.

### The five information domains

```
┌──────────────────────────────────────────────────────────────────┐
│  Domain             Source            Sensitivity    Cache TTL   │
├──────────────────────────────────────────────────────────────────┤
│  CRM / Relationship  Salesforce        Medium         30 min      │
│  Core Banking        Deposits/Lending  High           5 min       │
│  Compliance          AML/Reg signals   Critical       0 (no cache)│
│  Service             Cases/Incidents   Medium         10 min      │
│  Public Intelligence Internet/News     Low            60 min      │
└──────────────────────────────────────────────────────────────────┘
```

These domains are independent — there is no natural ordering. They should be fetched **in parallel** to meet the target brief generation time of under 60 seconds.

### Entitlement dimensions

The RM Prep Agent must enforce entitlements at three distinct levels, none of which the current platform handles:

**RM-to-client assignment** — an RM may only request a brief for a client they are assigned to cover. This is a relationship fact in Salesforce, not an OPA role check.

**Domain-level clearance** — compliance signals (AML, SAR indicators) are visible only to RMs with specific clearance roles, regardless of client assignment. A junior RM covering a client should not see compliance flags even for their own client.

**Field-level redaction** — even within an authorised domain, certain fields must be masked based on role. Credit scores, internal risk ratings, and regulatory flags are examples. The brief must be rendered differently for different RM roles viewing the same client.

---

## 3. Why the Current Pattern Is Not Enough

The current agent pattern uses `create_react_agent(llm, tools)` — a flat ReAct loop where a single LLM decides which tool to call next, calls it, observes the result, and decides again. This is the right pattern for an interactive assistant where the conversation drives tool selection organically.

It is the wrong pattern for the RM Prep Agent for three reasons.

**Reason 1: Reliability.** The LLM is not guaranteed to call all five data sources. It may decide web intelligence is unnecessary after reading the Salesforce data, or forget to check compliance signals if the CRM data is rich. For an auditable brief, you need a deterministic guarantee that every domain was checked, not an LLM probability that it was.

**Reason 2: Speed.** Serial tool calls average 3–8 seconds each in a banking context (Salesforce API, core banking middleware, web search). Five serial calls = 15–40 seconds minimum, before LLM reasoning time. A 60-second target requires parallel execution. `create_react_agent` is inherently serial.

**Reason 3: Evidence chain integrity.** A flat ReAct loop mixes tool outputs into an undifferentiated message history. There is no natural structure that maps "this claim in the brief came from this specific Salesforce query returning these specific records." Building the evidence chain requires the intermediate outputs to remain structured and attributable, not dissolved into a chat transcript.

### The right pattern: LangGraph StateGraph with parallel specialist nodes

LangGraph's `StateGraph` (not `create_react_agent`) is designed for exactly this use case. It allows:
- Explicit graph topology with fan-out to parallel nodes
- Typed state passed between nodes
- Guaranteed execution of all nodes regardless of LLM decisions
- Conditional edges for entitlement-based routing
- Sub-graphs (each specialist can itself be a `create_react_agent`)

The current platform SDK's `build_agent()` wraps `create_react_agent` and should be kept for interactive agents. The RM Prep Agent requires a separate `build_orchestrated_workflow()` factory that uses `StateGraph`.

---

## 4. Recommended Architecture: Hierarchical Multi-Agent with Parallel Specialists

### The two-tier hierarchy

```
Tier 1: RM Prep Orchestrator
        LangGraph StateGraph (deterministic graph, not ReAct)
        Owns the brief assembly state machine
        Enforces RM-to-client entitlement before any data is fetched
        Fans out to all specialists in parallel
        Fans in their structured outputs into the brief synthesis

Tier 2: Domain Specialist Agents (×5)
        Each is a create_react_agent with its own MCP tools
        Returns a structured DomainEvidence package, not free text
        Independently auditable — each has its own OTel trace
        Each enforces its own domain-level entitlement via OPA
```

### The MoE-inspired element

Pure MoE selects experts probabilistically. In a regulated bank that is inappropriate — you need auditability of why an expert was or was not consulted. The design uses a **rule-based routing layer** that selects which specialists to activate based on:

- Meeting type (prospecting vs. review vs. credit discussion)
- Client tier (private banking vs. commercial vs. corporate)
- Available time (60-second brief vs. 5-minute deep dive)
- Domain clearance of the requesting RM

This gives you the performance benefit of MoE (only running relevant experts) with the auditability of deterministic rules (you can always explain why the compliance specialist was or was not invoked).

### Full system topology

```
                  RM triggers brief request
                  (meeting ID / client ID / RM ID)
                           │
                           ▼
              ┌────────────────────────────┐
              │  Entitlement Gateway       │
              │  OPA: is RM assigned to    │
              │  this client?              │
              │  OPA: what domains can     │
              │  this RM see?              │
              └────────────┬───────────────┘
                           │ Approved domains mask
                           ▼
              ┌────────────────────────────┐
              │  RM Prep Orchestrator      │  ← LangGraph StateGraph
              │  (rm-prep-agent/)          │
              │                            │
              │  1. Load context           │
              │  2. Route to specialists   │
              │  3. Await all results      │
              │  4. Synthesise brief       │
              │  5. Apply field redaction  │
              │  6. Persist + return       │
              └────┬────────────┬──────────┘
                   │ parallel   │
         ┌─────────┴──┐  ┌──┐  └─────────────┐
         ▼            ▼  ...▼                 ▼
   ┌───────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐
   │ CRM       │ │ Banking  │ │Compliance│ │ Web Intel    │
   │ Specialist│ │Specialist│ │Specialist│ │ Specialist   │
   │ Agent     │ │ Agent    │ │ Agent    │ │ Agent        │
   │           │ │          │ │          │ │              │
   │salesforce │ │core-bank │ │compliance│ │web-search    │
   │-mcp       │ │-mcp      │ │-mcp      │ │-mcp          │
   └─────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬───────┘
         │            │            │               │
         └────────────┴────────────┴───────────────┘
                           │
                           ▼ DomainEvidence[] — structured, cited
              ┌────────────────────────────┐
              │  Brief Synthesis Node      │
              │  LLM call with structured  │
              │  output schema             │
              │  Evidence citations bound  │
              └────────────┬───────────────┘
                           │
                           ▼
              ┌────────────────────────────┐
              │  Field Redaction Node      │
              │  Strips fields the RM      │
              │  is not cleared to see     │
              └────────────┬───────────────┘
                           │
                    PreMeetingBrief
                    (JSON + rendered MD)
                    Persisted to DB
                    Returned to frontend
```

### LangGraph StateGraph skeleton

```python
# agents/rm-prep/src/graph.py  (illustrative)

from typing import Annotated, TypedDict
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages

class RMPrepState(TypedDict):
    # Input
    client_id: str
    rm_id: str
    meeting_id: str
    approved_domains: list[str]        # set by entitlement gateway

    # Specialist outputs — keyed by domain
    crm_evidence: DomainEvidence | None
    banking_evidence: DomainEvidence | None
    compliance_evidence: DomainEvidence | None
    service_evidence: DomainEvidence | None
    web_evidence: DomainEvidence | None

    # Final output
    brief: PreMeetingBrief | None
    audit_log: list[AuditEntry]

def build_rm_prep_workflow(specialists: dict, synthesiser_llm):
    graph = StateGraph(RMPrepState)

    graph.add_node("check_entitlements",  entitlement_node)
    graph.add_node("crm_specialist",      make_specialist_node("crm",        specialists["crm"]))
    graph.add_node("banking_specialist",  make_specialist_node("banking",    specialists["banking"]))
    graph.add_node("compliance_specialist", make_specialist_node("compliance", specialists["compliance"]))
    graph.add_node("service_specialist",  make_specialist_node("service",    specialists["service"]))
    graph.add_node("web_specialist",      make_specialist_node("web",        specialists["web"]))
    graph.add_node("synthesise_brief",    make_synthesis_node(synthesiser_llm))
    graph.add_node("redact_fields",       field_redaction_node)
    graph.add_node("persist_brief",       persistence_node)

    # Fan-out: after entitlement check, all approved specialists run in parallel
    graph.add_conditional_edges(
        "check_entitlements",
        route_to_approved_specialists,   # returns list of node names
        {
            "crm_specialist": "crm_specialist",
            "banking_specialist": "banking_specialist",
            "compliance_specialist": "compliance_specialist",
            "service_specialist": "service_specialist",
            "web_specialist": "web_specialist",
            "synthesise_brief": "synthesise_brief",   # if all skipped
        }
    )

    # Fan-in: all specialists feed into synthesis
    for specialist in ["crm_specialist", "banking_specialist",
                       "compliance_specialist", "service_specialist", "web_specialist"]:
        graph.add_edge(specialist, "synthesise_brief")

    graph.add_edge("synthesise_brief", "redact_fields")
    graph.add_edge("redact_fields",    "persist_brief")
    graph.add_edge("persist_brief",    END)

    graph.set_entry_point("check_entitlements")
    return graph.compile()
```

---

## 5. New MCP Servers Required

Each specialist agent needs its own MCP server. These live in `tools/` following the existing `data-mcp` pattern, with the SDK wiring all cross-cutting concerns.

### `tools/salesforce-mcp/`

**Tools to expose:**
- `get_client_profile(client_id)` — account details, RM assignment, relationship tier, key contacts
- `get_relationship_history(client_id, days)` — recent activities, notes, meetings, emails
- `get_pipeline_opportunities(client_id)` — open deals, stage, value, close probability
- `get_tasks_and_reminders(client_id, rm_id)` — outstanding actions assigned to this RM

**Implementation notes:** Uses Salesforce REST API (OAuth2 client credentials flow). The `session_id` in the current MCP pattern maps to a Salesforce `Account.Id`. OPA entitlement check should verify the RM is in the account team (`AccountTeamMember`) before any data is returned. Cache TTL: 30 minutes (Salesforce data is relatively stable intra-day).

### `tools/core-banking-mcp/`

**Tools to expose:**
- `get_deposit_summary(client_id)` — balance snapshot, AUM, product mix
- `get_lending_summary(client_id)` — facilities, utilisations, upcoming maturities, covenants
- `get_payment_activity(client_id, days)` — transaction volumes, counterparties, unusual patterns
- `get_product_holdings(client_id)` — full product inventory across all banking products

**Implementation notes:** Connects to internal core banking APIs (typically via an internal ESB or API gateway). These APIs are often synchronous REST but may require polling patterns for large clients. Cache TTL: 5 minutes. Compliance requirement: raw account numbers must be masked in the brief — the MCP server should apply masking before returning data to the agent.

### `tools/compliance-mcp/`

**Tools to expose:**
- `get_compliance_alerts(client_id)` — active AML alerts, PEP/sanctions status, SAR indicators
- `get_regulatory_obligations(client_id)` — upcoming reviews, CDD status, outstanding remediation
- `get_credit_risk_signals(client_id)` — internal risk rating, recent rating changes, watchlist status

**Implementation notes:** This is the most sensitive domain. **Zero caching** — compliance data must always be live. OPA entitlement must enforce a separate `compliance_clearance` role requirement. The MCP server should not return raw alert IDs or case numbers in the tool result; instead return categorised signals ("elevated AML risk — active review in progress") to prevent the brief from containing information that must only be viewed in the compliance system. Domain-level entitlement is enforced at two layers: OPA policy AND the compliance-mcp server checking the RM's clearance independently.

### `tools/service-mcp/`

**Tools to expose:**
- `get_open_cases(client_id)` — service complaints, operational incidents, pending resolutions
- `get_service_metrics(client_id, days)` — NPS scores, complaint volumes, resolution times
- `get_recent_interactions(client_id, days)` — call centre logs, branch visits, digital interactions

**Implementation notes:** Connects to CRM/ticketing system (ServiceNow or Salesforce Service Cloud). Cache TTL: 10 minutes. Provides context on client sentiment that the RM must acknowledge in the meeting.

### `tools/web-intelligence-mcp/`

**Tools to expose:**
- `search_company_news(company_name, days)` — recent press coverage, announcements, leadership changes
- `get_public_filings(company_id, filing_type)` — Companies House / SEC filings, annual reports
- `search_industry_context(sector, topic)` — sector trends relevant to talking points

**Implementation notes:** Aggregates from multiple public sources: news API (Bing, Google News), Companies House API, SEC EDGAR. Cache TTL: 60 minutes. Results must be clearly labelled as public / unverified in the brief — they cannot carry the same evidential weight as internal bank data. The web intelligence node should also return source URLs for citation.

---

## 6. Platform SDK Enhancements Required

### Enhancement 1: Per-tool TTL in `ToolResultCache`

Currently the TTL is set once at cache construction and applies to all tools. The RM Prep Agent requires compliance data is never cached, CRM data cached for 30 minutes, and web data for 60 minutes.

```python
# platform_sdk/cache.py — add ttl_override to set()

async def set(self, key: str, value: str, ttl_override: int | None = None) -> None:
    ttl = ttl_override if ttl_override is not None else self._ttl
    await self._redis.setex(key, ttl, value)
```

The `cached_tool` decorator needs a corresponding `ttl` parameter:
```python
def cached_tool(cache, ttl: int | None = None):  # ttl=0 means "never cache"
    def decorator(fn):
        @wraps(fn)
        async def wrapper(**kwargs):
            if ttl == 0:   # compliance tools: always bypass cache
                return await fn(**kwargs)
            ...
```

### Enhancement 2: `orchestrator.py` — multi-agent workflow factory

New SDK module wrapping LangGraph `StateGraph` patterns. Provides:
- `build_orchestrated_workflow(nodes, edges, state_schema)` — factory for StateGraph workflows
- `parallel_node(node_fns)` — utility to fan-out to multiple nodes concurrently
- `WorkflowConfig` dataclass extending `AgentConfig` with orchestration-specific settings

```python
# platform_sdk/orchestrator.py (new)
@dataclass
class WorkflowConfig(AgentConfig):
    synthesis_model_route: str  = "complex-routing"   # for the synthesis LLM
    specialist_timeout_seconds: int = 30               # per-specialist timeout
    partial_brief_on_timeout: bool = True              # return brief with available data on timeout
```

### Enhancement 3: `evidence.py` — evidence chain tracking

New SDK module providing typed structures for the evidence chain. Every piece of data returned by a specialist must travel with its provenance.

```python
# platform_sdk/evidence.py (new)

@dataclass
class Citation:
    source_system: str        # "salesforce" | "core-banking" | "compliance" | "web"
    source_tool: str          # MCP tool name
    query_params: dict        # what was asked
    retrieved_at: datetime    # timestamp
    source_url: str | None    # for web citations
    confidence: str           # "verified" | "indicative" | "public-unverified"

@dataclass
class EvidenceItem:
    claim: str                # the factual statement
    value: Any                # the raw value
    citation: Citation

@dataclass
class DomainEvidence:
    domain: str               # "crm" | "banking" | "compliance" | "service" | "web"
    items: list[EvidenceItem]
    summary: str              # domain specialist's 2-3 sentence synthesis
    retrieved_at: datetime
    errors: list[str]         # partial failures — domain may have partial data
```

This replaces the current pattern where MCP tools return raw strings. The specialist agent wraps its tool results in `DomainEvidence` before returning to the orchestrator. The synthesis node then has full provenance for every claim it makes in the brief.

### Enhancement 4: `brief.py` — structured output schemas

New SDK module defining the canonical brief schema. Using Pydantic for validation and serialisation.

```python
# platform_sdk/brief.py (new)

class TalkingPoint(BaseModel):
    topic: str
    suggested_opening: str
    supporting_data: list[str]     # references to EvidenceItem claims
    sensitivity: str               # "public" | "internal" | "confidential"

class RecommendedAction(BaseModel):
    action: str
    rationale: str
    due_by: date | None
    owner: str                     # "RM" | "Product" | "Credit" | "Operations"

class PreMeetingBrief(BaseModel):
    brief_id: str                  # UUID — for audit trail
    client_id: str
    rm_id: str
    meeting_id: str
    generated_at: datetime
    approved_domains: list[str]    # which domains contributed to this brief
    relationship_summary: str
    recent_changes: list[str]
    opportunities: list[str]
    risks: list[str]
    talking_points: list[TalkingPoint]
    recommended_actions: list[RecommendedAction]
    evidence: list[DomainEvidence]  # full evidence chain
    redacted_fields: list[str]      # audit of what was withheld from this RM
    disclaimer: str                 # regulatory disclaimer text
```

Having this schema in the SDK means the Streamlit UI, Salesforce plugin, and Teams plugin all render from the same structure. The brief is generated once and consumed by many surfaces.

### Enhancement 5: RAG integration via pgvector

pgvector is already in the stack. The RM Prep Agent should use it for two purposes:

**Past brief retrieval** — "What did we prepare for the last meeting with this client?" Embed past briefs and retrieve semantically similar ones as context for the synthesis node.

**Relationship memory** — RMs often capture informal notes ("client mentioned they're planning an acquisition"). These should be embedded and retrievable when preparing the next brief.

The SDK needs a thin `retriever.py` module:

```python
# platform_sdk/retriever.py (new)
class VectorRetriever:
    async def retrieve(self, query: str, filter: dict, top_k: int) -> list[str]: ...
    async def store(self, text: str, metadata: dict) -> str: ...

    @classmethod
    def from_env(cls) -> "VectorRetriever": ...  # reads DATABASE_URL from env
```

---

## 7. OPA Policy & Entitlement Enhancements

### Current state

OPA currently enforces **tool-level authorization**: can this agent role call this MCP tool? It does not know about individual clients, individual RMs, or the relationship between them.

### Three new entitlement dimensions needed

**Dimension 1: RM-to-client assignment check**

The OPA input must be extended to include `rm_id` and `client_id`. A new policy rule queries a data document (loaded into OPA from Salesforce account team data) to verify the RM is assigned.

```rego
# tools/policies/opa/entitlements.rego

# RM must be in the account team to access any data for this client
rm_assigned_to_client if {
    input.rm_id in data.account_teams[input.client_id].members
}

# Exception: senior coverage officers can access any client
rm_assigned_to_client if {
    input.rm_role == "senior_coverage_officer"
}
```

OPA data documents (the `data.account_teams` above) are loaded at startup from a sync job that pulls current Salesforce account team assignments. This refresh should run every 15 minutes — OPA supports hot-reloading policy data without restart.

**Dimension 2: Domain clearance**

```rego
# Which domains is this RM cleared to see?
approved_domains[domain] if {
    some domain in standard_domains
    rm_assigned_to_client
}

approved_domains["compliance"] if {
    rm_assigned_to_client
    input.rm_role in {"senior_rm", "compliance_cleared_rm", "head_of_coverage"}
}

standard_domains := {"crm", "banking", "service", "web"}
```

The orchestrator calls OPA once at the start of each brief generation to get the `approved_domains` set. This set is then passed through the entire StateGraph, ensuring no specialist is invoked without clearance.

**Dimension 3: Field-level redaction instructions**

Rather than having the MCP servers perform redaction (they should not need to know about RM roles), the OPA policy returns a `redact_fields` list that the orchestrator's final redaction node uses:

```rego
redact_fields[field] if {
    field := "credit_risk_rating"
    not input.rm_role in {"senior_rm", "credit_officer"}
}

redact_fields[field] if {
    field := "internal_watchlist_status"
    not input.rm_role in {"compliance_cleared_rm", "head_of_coverage"}
}
```

The orchestrator sends one OPA request at the start and gets back both `approved_domains` and `redact_fields`. The `PreMeetingBrief` records which fields were redacted in the `redacted_fields` audit list.

---

## 8. Evidence Chain & Auditability Design

### The core principle

Every sentence in the brief that asserts a fact must map back to a specific tool call that returned specific data at a specific timestamp. This is not a nice-to-have — in a regulated bank, it is the difference between an AI assistant that can be used in client-facing work and one that cannot.

### Two-layer audit trail

**Layer 1: OpenTelemetry trace** — already in the platform. Each specialist agent run generates a trace. The `brief_id` should be set as a span attribute on the orchestrator's root span so all child spans (five specialist agents, the synthesis call, the OPA call) are linked under one trace ID. Compliance teams can pull a single trace ID from the brief and see every API call that contributed to it.

**Layer 2: Brief evidence record** — the `DomainEvidence[]` array in `PreMeetingBrief` is persisted to PostgreSQL alongside the brief itself. This is queryable, durable, and independent of the OTel backend. An auditor can retrieve brief ID `xyz`, read `evidence`, and see: "The claim about deposit balance was derived from a call to `get_deposit_summary(client_id=X)` at 09:14:32 UTC, returning £4.2M."

### Immutable brief storage

The existing `agent_audit_log` table should be extended (or a new `rm_briefs` table created) with the following columns: `brief_id`, `client_id`, `rm_id`, `meeting_id`, `generated_at`, `brief_json` (the full `PreMeetingBrief`), `otel_trace_id`. Briefs are **insert-only** — never updated or deleted. If an RM requests a refresh, a new brief is generated with a new `brief_id`.

---

## 9. The Pre-Meeting Brief: Structured Output Design

### Why structured output matters for embedding

The brief will eventually be rendered in Streamlit, Salesforce, Microsoft Teams, calendar apps, and potentially printed PDF. If the synthesis LLM returns free markdown text, each embedding surface must parse it differently — and will inevitably break when the LLM changes its output format.

The synthesis node must use **LLM structured output** (JSON mode / function calling) constrained to the `PreMeetingBrief` Pydantic schema. LangChain's `.with_structured_output()` method provides this:

```python
# In the synthesis node
llm_with_schema = llm.with_structured_output(PreMeetingBrief)
brief = await llm_with_schema.ainvoke(synthesis_prompt)
```

The LLM is instructed to populate only `relationship_summary`, `recent_changes`, `opportunities`, `risks`, `talking_points`, and `recommended_actions`. The orchestrator fills `brief_id`, `generated_at`, `evidence`, `approved_domains`, `redacted_fields`, and `disclaimer` programmatically — those fields must never come from LLM output.

### Synthesis prompt design

The synthesis prompt is critically important and should be in a versioned Jinja2 template (following the existing pattern). Key requirements for the template:

- Pass `DomainEvidence` summaries from all specialists as context — never raw tool outputs
- Explicitly instruct the LLM to only assert facts that appear in the provided evidence
- Instruct it to flag uncertainties ("Salesforce notes suggest X but this should be confirmed")
- Provide the `redact_fields` list so the synthesis does not mention redacted fields at all
- Include the meeting type and duration so the brief is appropriately scoped

---

## 10. Frontend Strategy: Streamlit + Future Embedding

### Why Streamlit for the RM use case

Chainlit is the right choice for a general chat assistant. The RM Prep Agent is not a chat interface — it is a **form-driven, document-generating workflow**. An RM should be able to:

1. Search for a client by name
2. Select an upcoming meeting or enter a meeting date
3. Click "Generate Brief"
4. Watch a progress indicator per domain (CRM ✓, Banking ✓, Compliance ✓...)
5. Read the structured brief with clearly separated sections
6. Expand any section to see the evidence citations
7. Add their own notes before exporting or sharing

Streamlit's form widgets, `st.status()` for streaming progress, and column layouts are well suited to this. Chainlit's chat paradigm is not.

The Streamlit app lives at `frontends/rm-prep-ui/` alongside the existing `frontends/chat-ui/`. It calls the RM Prep Agent REST API — it does not embed agent logic. The same architectural boundary applies: **frontends call agents, they do not contain agents**.

### Future embedding surfaces

The `PreMeetingBrief` JSON structure is the embedding contract. Any surface that can receive JSON can render the brief.

**Salesforce embedding:** A Salesforce Lightning Web Component that calls the RM Prep Agent API and renders the brief inline in the Account or Event page. The RM triggers this from their normal Salesforce workflow without leaving the CRM.

**Calendar-driven prep:** A scheduled job (using the existing `platform-sdk` scheduler pattern) that detects meetings in Outlook/Google Calendar 2 hours before start time and generates briefs automatically. The brief is emailed to the RM or posted to a Teams channel.

**Teams / M365 Copilot plugin:** An adaptive card in Teams that the RM can trigger via `@RM Prep prepare brief for [client]`. Built as `frontends/teams-plugin/` using Bot Framework. Same agent API.

**Internal banker desktop:** If the bank has a proprietary desktop tool, the brief can be embedded via an iframe pointing at the Streamlit UI, or a native component consuming the JSON API.

---

## 11. Phased Delivery Plan

### Phase 1 — Foundation (4–6 weeks)
Deliver the core brief generation pipeline for a single client type with three domains (CRM, Banking, Web Intelligence). No compliance domain yet. Entitlement is RM-to-client assignment only.

- SDK enhancements: `evidence.py`, `brief.py`, per-tool TTL in `cache.py`
- New MCP servers: `salesforce-mcp`, `core-banking-mcp`, `web-intelligence-mcp`
- RM Prep Orchestrator: StateGraph with three parallel specialist nodes + synthesis
- Streamlit UI: client search, generate button, brief display
- OPA extension: RM-to-client assignment policy + account team data loading

### Phase 2 — Compliance & Full Entitlements (4–6 weeks)
Add the compliance and service domains. Implement full three-tier entitlement (assignment + domain clearance + field redaction). Compliance audit log.

- New MCP servers: `compliance-mcp` (zero-cache), `service-mcp`
- SDK enhancements: `orchestrator.py`, `WorkflowConfig`
- OPA extension: domain clearance + field redaction policies
- Brief: `redacted_fields` audit trail, compliance disclaimer
- Streamlit: domain-by-domain progress indicator, evidence expansion

### Phase 3 — Memory & RAG (3–4 weeks)
Past brief retrieval. RM note capture. Semantic search for institutional memory.

- SDK enhancements: `retriever.py`
- Database: `rm_briefs` table, vector embedding schema
- Brief synthesis: retrieve past briefs as context before synthesis
- UI: "Previous briefs for this client" section

### Phase 4 — Embedding & Automation (4–6 weeks)
Salesforce Lightning Web Component, calendar-driven brief generation, Teams plugin.

- `frontends/salesforce-lwc/` — Salesforce embedding
- `frontends/teams-plugin/` — Teams / Copilot adaptive card
- Scheduled job for calendar-triggered prep (using existing scheduler SDK)

---

## 12. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Salesforce API rate limits hit under load | Medium | High | Cache aggressively (30 min TTL); bulk API for batch calendar jobs |
| Core banking API latency exceeds specialist timeout | High | Medium | `partial_brief_on_timeout=True` — return brief with available data and flag missing domains |
| LLM hallucination in brief synthesis | Medium | Critical | Structured output schema + system prompt instruction to cite only provided evidence + evidence chain audit |
| Compliance data inadvertently included in brief | Low | Critical | Zero-cache enforcement on compliance-mcp + field redaction node after synthesis + OPA domain clearance |
| RM-to-client entitlement data stale in OPA | Medium | High | 15-minute refresh cadence + OPA bundle with TTL enforcement + fail-closed on stale data |
| Brief generation time exceeds 60 seconds | Medium | Medium | Monitor per-specialist p95 latency; LiteLLM semantic cache for synthesis model; async pre-generation on calendar trigger |
| pgvector embedding drift as models change | Low | Low | Version embeddings with model name; re-embed on model change using a backfill job |

---

## Summary of Required Changes to the Codebase

```
enterprise-ai/
│
├── platform-sdk/platform_sdk/
│   ├── cache.py           MODIFY — add per-tool TTL override
│   ├── evidence.py        NEW — Citation, EvidenceItem, DomainEvidence
│   ├── brief.py           NEW — PreMeetingBrief, TalkingPoint, RecommendedAction
│   ├── orchestrator.py    NEW — build_orchestrated_workflow, WorkflowConfig
│   ├── retriever.py       NEW — VectorRetriever (pgvector RAG)
│   └── __init__.py        MODIFY — export new modules
│
├── tools/
│   ├── salesforce-mcp/    NEW — CRM specialist tools
│   ├── core-banking-mcp/  NEW — Deposits/Lending/Payments tools
│   ├── compliance-mcp/    NEW — Compliance signals (zero-cache)
│   ├── service-mcp/       NEW — Cases and service metrics
│   ├── web-intelligence-mcp/  NEW — News, filings, public data
│   └── policies/opa/
│       ├── tool_auth.rego      MODIFY — add rules for new tools
│       ├── entitlements.rego   NEW — RM-to-client, domain clearance, field redaction
│       └── entitlements_test.rego  NEW — policy unit tests
│
├── agents/
│   └── rm-prep/           NEW — RM Prep Orchestrator service
│       ├── src/
│       │   ├── graph.py   StateGraph workflow (NOT create_react_agent)
│       │   ├── server.py  FastAPI: POST /briefs, GET /briefs/{id}
│       │   ├── nodes/     One file per StateGraph node
│       │   └── prompts/   synthesis_prompt.j2, brief templates
│       ├── Dockerfile
│       └── requirements.txt
│
├── frontends/
│   ├── chat-ui/           UNCHANGED
│   └── rm-prep-ui/        NEW — Streamlit brief generation UI
│
└── platform/db/
    └── rm_briefs.sql      NEW — brief storage schema (insert-only)
```

The most important architectural decision in this design is using **LangGraph StateGraph** for the orchestrator rather than `create_react_agent`. This is not a limitation of the current platform — `build_agent()` in the SDK remains correct for interactive agents. The RM Prep Agent is a different class of system: a deterministic, document-generating workflow where auditability and parallel execution matter more than conversational flexibility. Both patterns coexist in the same platform, served by the same SDK, deploying through the same docker-compose and Helm infrastructure.
