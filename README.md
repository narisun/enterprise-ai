# Meridian — Enterprise Agentic AI Platform

![Meridian Intelligence Team](meridian.png)

**Meridian** is a production-grade enterprise agentic AI platform built for regulated financial services. It ships two production agents — a generic secure chat assistant and the **RM Prep Agent** — along with the shared `platform-sdk` that makes every new agent and MCP server inherently secure, observable, and policy-governed from day one.

> _"AI workers embedded in your workflows — each with a defined role, data access, and specialist skills."_

---

## Core Concepts

### 1. Separation of Concerns via Platform SDK

All cross-cutting concerns — security, caching, context compaction, configuration, logging, and observability — live in a single shared package (`platform-sdk/`) that every service installs as a dependency. Service code never handles API key verification, OPA calls, Redis connection management, or token budget management directly. It simply imports what it needs.

The result is that a new MCP tool server needs roughly 80 lines of code to be fully production-ready: authenticated, policy-governed, cached, traced, and observable. There is no boilerplate to copy and no risk of a new service forgetting a cross-cutting concern.

```
platform-sdk/platform_sdk/
├── auth.py        AgentContext — JWT decode, identity, row/column filter builders
├── config.py      AgentConfig, MCPConfig — typed dataclasses with from_env()
├── security.py    OpaClient, make_api_key_verifier()
├── cache.py       ToolResultCache, @cached_tool decorator
├── compaction.py  make_compaction_modifier() — context window trimming
├── agent.py       build_agent(), build_specialist_agent() — LangGraph factories
├── logging.py     configure_logging(), get_logger() — structured JSON logs
└── telemetry.py   setup_telemetry() — OpenTelemetry auto-instrumentation
```

### 2. MCP (Model Context Protocol) Tool Servers

Every data source is wrapped as an independent MCP server. Agents discover tools dynamically via Server-Sent Events — no hardcoded tool lists in agent code. MCP servers are independently deployable, independently versioned, and independently testable. Adding a new data source means shipping a new MCP server; nothing else in the platform changes.

```
tools/
├── data-mcp/        Generic secure SQL — used by the chat agent
├── salesforce-mcp/  CRM summary — 7-query client profile
├── payments-mcp/    Bank payment analytics — volumes, trends, AML signals
└── news-search-mcp/ Company news via Tavily (mock fallback for dev)
```

Each MCP server validates the caller identity via an HMAC-signed `X-Agent-Context` header, calls OPA to authorise the tool invocation, applies row-level and column-level filters, and returns only what the calling user's role is cleared to see.

### 3. OPA (Open Policy Agent) — Policy as Code

Authorization is never inline. Every access decision is delegated to OPA, which runs as a sidecar service. Policies are written in Rego, version-controlled alongside the application code, and covered by their own unit test suite (`tool_auth_test.rego`).

This means:
- An audit trail of exactly what policy was in effect for any given request
- Policy changes go through the same code-review and CI pipeline as application changes
- Zero risk of authorization logic diverging across services — there is one authoritative policy source

The platform enforces authorization at three distinct levels, each addressed by a dedicated Rego policy:

```
Level 1 — Tool-level:   Can this agent role call this MCP tool at all?
Level 2 — Row-level:    Which client records can this RM access?
Level 3 — Column-level: Which fields within a record can this clearance level see?
```

The `rm_prep_authz.rego` policy governs the RM Prep Agent with three clearance tiers:

| Clearance | AML columns | Compliance columns | Payment volumes | Notes |
|---|---|---|---|---|
| `standard` (RM) | masked | masked | visible | Default for all RMs |
| `aml_view` | visible | masked | visible | Senior RMs with AML clearance |
| `compliance_full` | visible | visible | visible | Compliance officers only |

### 4. Multi-Agent Orchestration with LangGraph

The platform distinguishes between two fundamentally different agent architectures, each appropriate for a different class of problem:

**ReAct loop** (`build_agent()`) — used by the generic chat agent. An LLM drives a flexible tool-calling loop. The user's conversation drives tool selection organically. Best for interactive, open-ended assistance.

**LangGraph StateGraph** — used by the RM Prep Agent. A deterministic graph guarantees that every domain specialist runs, runs in parallel, and completes before synthesis. The LLM never decides whether to check compliance signals — the graph always does. Best for auditable, document-generating workflows in regulated contexts.

The RM Prep Agent's graph runs three specialists in parallel and synthesises a structured brief:

```
parse_intent → route
                 ├── gather_crm ──────┐
                 ├── gather_payments  ├── synthesize → format_brief
                 └── gather_news ─────┘
```

Each specialist node is itself a `create_react_agent` sub-agent with its own MCP tools, its own OTel trace, and its own independent authorization check. The orchestrator fans out, awaits all three, then hands the structured outputs to the synthesis node.

### 5. Multi-Cloud via LiteLLM

The LiteLLM proxy decouples model selection from agent code entirely. Agents make OpenAI-format calls to `http://litellm:4000`. LiteLLM routes to Azure OpenAI, AWS Bedrock, or any other provider based on YAML configuration — without any agent code changes.

LiteLLM also provides the first caching tier: **semantic prompt caching** in Redis. If two RMs generate briefs for the same client within the cache TTL, the second LLM call is served from cache with no latency or token cost.

### 6. Two-Tier Caching

```
Tier 1 — LiteLLM semantic cache (Redis)
          LLM completions — deduplicated by prompt hash
          TTL: configurable per model route
          Benefit: zero-cost repeated synthesis for the same client

Tier 2 — Tool result cache (Redis, via platform-sdk ToolResultCache)
          MCP tool outputs — deduplicated by tool + params + role
          TTL: per-tool (CRM: 30 min, news: 60 min, payments: 5 min)
          Benefit: parallel specialists share cached tool results
```

Compliance tools are **never cached** — they always hit the source system to guarantee freshness. The `@cached_tool` decorator accepts `ttl=0` to express this.

### 7. Identity & Context Propagation

Authentication happens once — at the API boundary. The RM Prep Agent verifies the JWT and constructs an `AgentContext` object containing the RM's identity, role, clearance level, and assigned account IDs. This context is HMAC-signed and forwarded to every downstream MCP call as the `X-Agent-Context` header.

MCP servers never re-verify the JWT. They trust the signed context from the upstream agent, verify the HMAC, and apply the row/column filters it specifies. This design means:
- A single point of authentication
- No JWT secret distribution to MCP servers
- Tamper-evident context (the HMAC prevents privilege escalation by a compromised agent)

---

## Architecture

### System Overview

```
 RM (browser)
      │
      │  HTTPS + Bearer JWT
      ▼
┌──────────────────────────────────────────────────────┐
│  Meridian UI  :8502 (Streamlit)                       │
│  frontends/rm-prep-ui/                               │
│  · JWT login + persona selector                      │
└──────────────────┬───────────────────────────────────┘
                   │  POST /brief/persona
                   │  Bearer INTERNAL_API_KEY
                   ▼
┌──────────────────────────────────────────────────────┐
│  RM Prep Agent  :8003  (FastAPI + LangGraph)          │
│  agents/rm-prep/src/                                 │
│  · AgentContext.from_jwt(token)                      │
│  · OPA: is this RM cleared for this client?          │
│  · StateGraph: parallel specialist fan-out           │
│  · Synthesis: structured Pydantic brief output       │
└────────┬─────────────────┬──────────────────┬────────┘
         │ SSE + X-Agent-Context header        │
         ▼                 ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
│ SF MCP :8081 │  │ Pay MCP:8082 │  │ News MCP :8083   │
│ salesforce.* │  │ bankdw.*     │  │ Tavily / mock    │
│ 7-query CRM  │  │ vol + trend  │  │                  │
│ profile      │  │ + AML cols   │  │                  │
└──────┬───────┘  └──────┬───────┘  └──────────────────┘
       │                 │
       └────────┬────────┘
                ▼
┌───────────────────────────┐   ┌────────────────────┐
│  PostgreSQL  :5432        │   │  OPA  :8181         │
│  · salesforce.* (CRM)     │   │  rm_prep_authz.rego │
│  · bankdw.* (Payments)    │   │  · row filters      │
│  · rm_prep (sessions)     │   │  · column masks     │
└───────────────────────────┘   └────────────────────┘

┌───────────────────────────┐   ┌────────────────────┐
│  Redis  :6379             │   │  LiteLLM  :4000     │
│  · LLM semantic cache     │   │  · Azure OpenAI     │
│  · Tool result cache      │   │  · AWS Bedrock      │
└───────────────────────────┘   └────────────────────┘
```

### RM Prep Agent — LangGraph StateGraph

The RM Prep Agent uses a deterministic `StateGraph` rather than a ReAct loop. This is a deliberate architectural choice for a regulated environment:

- **Reliability**: every domain is always checked — the LLM cannot "decide" to skip compliance signals
- **Speed**: all three specialists run in parallel (LangGraph fan-out)
- **Auditability**: the brief's structured output records exactly which data sources contributed each claim

```
           ┌─────────────────────────────────────────┐
           │  RMPrepState                             │
           │  client_name, persona, clearance level   │
           └──────────────────┬──────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │   parse_intent    │  ← extract client name
                    └─────────┬─────────┘
                              │
                    ┌─────────▼─────────┐
                    │      route        │  ← dispatch to specialists
                    └──┬──────┬──────┬──┘
                       │      │      │    (parallel fan-out)
               ┌───────▼─┐ ┌──▼──┐ ┌▼────────┐
               │gather_crm│ │pay  │ │  news   │
               │ SF MCP   │ │ MCP │ │  MCP    │
               └───────┬──┘ └──┬──┘ └────┬────┘
                       │       │          │
                       └───────┴────┬─────┘
                                    │
                          ┌─────────▼─────────┐
                          │    synthesize      │  ← LLM call, structured output
                          └─────────┬─────────┘
                                    │
                          ┌─────────▼─────────┐
                          │   format_brief     │  ← RMBrief → Markdown
                          └───────────────────┘
```

### Generic Chat Agent

```
  Chat UI :8501 (Chainlit)
       │  Bearer INTERNAL_API_KEY
       ▼
┌────────────────────────────┐
│  Chat Agent  :8000         │
│  LangGraph ReAct loop      │
│  · Bearer auth (SDK)       │
│  · build_agent() factory   │
└──────────┬─────────────────┘
           │ MCP SSE
           ▼
┌────────────────────────────┐   ┌──────────────┐
│  Data MCP  :8080           │   │  OPA :8181   │
│  Secure read-only SQL      │◄──┤  tool_auth   │
│  · @cached_tool (SDK)      │   │  .rego       │
│  · OpaClient (SDK)         │   └──────────────┘
└────────────┬───────────────┘
             ▼
   PostgreSQL :5432
```

---

## Security Design

### Authorization Chain

```
HTTP request
    │
    ├─ 1. API key verified (make_api_key_verifier, timing-safe compare)
    ├─ 2. JWT decoded → AgentContext (role, clearance, assigned_accounts)
    ├─ 3. OPA called: can this role call this tool for this session?
    ├─ 4. AgentContext HMAC-signed → X-Agent-Context header
    ├─ 5. MCP server: HMAC verified, context decoded
    ├─ 6. OPA called (MCP-side): row filter + column mask returned
    └─ 7. SQL query applies WHERE clause + NULL-cast for masked columns
```

### Why HMAC-signed Context (not JWT forwarding)

Forwarding the user's JWT to MCP servers would require distributing the JWT secret to every MCP server. Instead, the agent signs the `AgentContext` with a separate `AGENT_CONTEXT_SECRET` (shared only between agents and MCPs). MCP servers cannot forge a context claiming higher clearance — the HMAC would not verify.

### OPA Policy Testing

OPA policies have their own unit test suite (`tool_auth_test.rego`), run in CI on every push. This means policy changes cannot be merged without the tests passing — the same guarantee the application code has.

```bash
make test-policies   # opa test tools/policies/opa/ -v
```

---

## Layered Testing & Evals

The test architecture mirrors the authorization and observability separation of concerns: each layer tests only what it owns, with no dependencies on layers above or below it.

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 3 — LLM-in-the-loop Evals                               │
│  tests/evals/                                                   │
│  Requires: full stack + LLM credentials                        │
│                                                                  │
│  ┌─────────────────────────┐  ┌────────────────────────────┐   │
│  │  Synthesis Quality      │  │  RAGAS Faithfulness        │   │
│  │  test_synthesis_quality │  │  test_faithfulness         │   │
│  │  LLM judge: 20+ rubric  │  │  Hallucination detection   │   │
│  │  criteria per case      │  │  Claim grounding score     │   │
│  │  Access control checks  │  │  0.85 threshold (full data)│   │
│  └─────────────────────────┘  └────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Specialist Fidelity                                    │   │
│  │  test_specialist_fidelity                               │   │
│  │  Mocked tools — verify correct tool called, verbatim    │   │
│  │  JSON returned, errors forwarded unchanged              │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2 — Integration Tests                                   │
│  tests/integration/                                             │
│  Requires: Docker Compose test stack                           │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────┐  ┌───────────────┐    │
│  │ OPA Policies     │  │ Payments SQL │  │ RM Prep API   │    │
│  │ test_opa_policies│  │ test_payments│  │ test_rm_prep  │    │
│  │ Full authz matrix│  │ _sql         │  │ _server       │    │
│  │ Row/col filters  │  │ Column alias │  │ JWT issuance  │    │
│  │ Deny baseline    │  │ regression   │  │ Persona check │    │
│  └──────────────────┘  └──────────────┘  └───────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│  Layer 1 — Unit Tests                                          │
│  tests/unit/                                                    │
│  No network, no database, no LLM                               │
│                                                                  │
│  ┌──────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │ Auth         │  │ Cache Keys      │  │ Brief Rendering  │  │
│  │ test_auth    │  │ test_cache_key  │  │ test_brief_render│  │
│  │ HMAC round   │  │ Key stability   │  │ 7 sections       │  │
│  │ trip, tamper │  │ Order-indep.    │  │ Markdown output  │  │
│  │ JWT encode/  │  │ Clearance iso.  │  │ Missing date     │  │
│  │ decode, expiry│  │ Never-cache-err │  │ fallback         │  │
│  └──────────────┘  └─────────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Layer 1 — Unit Tests

Pure Python tests with no external dependencies. Run in under 5 seconds. These are the CI hard gate on every push and PR.

```bash
make test-unit
# python -m pytest tests/unit/ -m unit -v
```

What is covered:
- HMAC round-trip, tamper detection, missing separator
- JWT encode/decode, expiry, wrong secret
- `anonymous()` minimum privilege construction
- Column masking for all three clearance levels (parametrised over each column individually)
- Row filters per role for both CRM and payments schemas
- `can_access_account`, `has_clearance`, role rank ordering
- Cache key stability across argument order permutations
- Cache key isolation between clearance levels (standard ≠ aml_view ≠ compliance_full)
- `@cached_tool` decorator — errors are never cached
- `RMBrief` model validation — all 7 markdown sections present
- Source joining and missing meeting date fallback

### Layer 2 — Integration Tests

Tests that require a running Docker Compose stack. Run against real PostgreSQL, OPA, and the RM Prep API server. Used as a CI gate on PRs and pushes to `main`.

```bash
make dev-test-up          # start the stack
make test-integration     # python -m pytest tests/integration/
```

What is covered:

**OPA authorization matrix** (`test_opa_policies.py`) — every combination of authorized agent, unauthorized agent, session UUID validation, and default-deny baseline. A regression if any combination of role × tool ever returns the wrong allow/deny decision.

**Payments SQL** (`test_payments_sql.py`) — direct asyncpg queries against the seeded `bankdw` schema. Includes a regression test for the column alias bug (`"Status" AS status`): if the alias is ever removed, this test fails with `KeyError: 'status'` before the bug can reach production.

**RM Prep API** (`test_rm_prep_server.py`) — health check, persona listing, JWT issuance for all four test personas, token payload field verification, and request validation — all without making any real LLM calls.

### Layer 3 — LLM-in-the-loop Evals

Eval tests require a live LLM (via the LiteLLM proxy) and a running full stack. They are `continue-on-error` on PRs (advisory) and a hard gate on `main`. Two complementary evaluation approaches are used:

```bash
make test-evals                  # all evals
make test-evals-fidelity         # specialist fidelity only (faster)
make test-evals-synthesis        # synthesis quality only
make test-evals-faithfulness     # RAGAS faithfulness only
```

#### Custom LLM Judge (Primary)

`tests/evals/judge.py` implements a rubric-based LLM judge using the OpenAI SDK against the LiteLLM proxy. Each rubric criterion is evaluated as an independent yes/no question — a single composite score would hide which dimension regressed.

The rubric covers three dimensions:

**Data accuracy** — Does the brief cite specific payment volumes? Does it name real counterparties? Does it surface open CRM opportunities?

**Access control** — Does a restricted-clearance brief omit compliance fields? Does an access-denied case avoid inventing data it was not given?

**Format** — Are all seven sections present? Are no figures fabricated?

#### RAGAS Faithfulness (Complementary)

`tests/evals/test_faithfulness.py` uses the RAGAS 0.2.x `Faithfulness` metric to measure hallucination risk independently of the rubric judge. RAGAS decomposes the brief into atomic claims and classifies each as supported or unsupported by the retrieved CRM, payments, and news contexts.

| Case | Scenario | Threshold | Key extra check |
|---|---|---|---|
| Case 001 | Microsoft Manager — full access | ≥ 0.85 | No unsupported financial figures |
| Case 002 | Ford RM — compliance columns masked | ≥ 0.80 | No fabricated AML/KYC claims from null fields |
| Case 003 | Unknown client — no data | ≥ 0.70 | No invented dollar amounts or percentages |
| Case 004 | Readonly — CRM+payments denied | ≥ 0.70 | No invented CRM contacts or payment volumes |

The two eval approaches are deliberately complementary: the custom judge assesses access-control correctness (which RAGAS cannot), while RAGAS provides an objective, reproducible hallucination score that enterprise architects can track over model and prompt changes.

### CI Workflows

Three GitHub Actions workflows enforce the layered gates:

```
ci-unit.yml        — every push, every branch
                     • Unit tests (Python 3.11 + 3.12)
                     • OPA policy tests
                     • ruff lint
                     → Hard gate: blocks merge if any step fails

ci-integration.yml — push to main/develop + all PRs
                     • Starts Docker Compose test stack
                     • Runs integration test suite
                     • Collects service logs on failure
                     → Hard gate: blocks merge if any step fails

ci-evals.yml       — manual dispatch + push to main + PRs labelled run-evals
                     • Specialist fidelity (per-agent step)
                     • Synthesis quality (per-fixture step)
                     • RAGAS faithfulness (per-fixture step)
                     → Advisory on PRs, hard gate on main
```

The per-case step design in `ci-evals.yml` is intentional: when Case 002 fails, you see "Ford RM — synthesis quality failed" in the GitHub Actions UI without having to parse test output.

---

## Repository Structure

```
enterprise-ai/
├── agents/                       Generic chat agent service (LangGraph + FastAPI)
│   └── src/
│       ├── server.py             FastAPI server — auth, /chat endpoint
│       ├── graph.py              LangGraph ReAct agent builder
│       ├── mcp_bridge.py         MCP SSE client + LangChain tool adapter
│       └── prompts/              Jinja2 system prompt templates
│
├── agents/rm-prep/               RM Prep orchestrator — brief-writing agent
│   └── src/
│       ├── server.py             FastAPI — JWT auth, /brief endpoint
│       ├── graph.py              LangGraph StateGraph (parse → route → gather × 3 → synthesize)
│       ├── state.py              RMPrepState TypedDict
│       ├── brief.py              RMBrief Pydantic model + Markdown renderer
│       └── prompts/              Jinja2 templates per specialist node
│
├── frontends/
│   ├── chat-ui/                  Chainlit web chat UI (generic agent)
│   └── rm-prep-ui/               Streamlit brief-writing UI (RM Prep agent)
│
├── tools/                        MCP backend tool servers
│   ├── data-mcp/                 Secure read-only SQL (generic agent)
│   ├── salesforce-mcp/           Salesforce CRM — 7-query client profile
│   ├── payments-mcp/             Bank payment analytics + AML signals
│   ├── news-search-mcp/          Company news via Tavily (mock in dev)
│   ├── shared/mcp_auth.py        Starlette middleware + ContextVar for AgentContext
│   └── policies/opa/
│       ├── tool_auth.rego        Generic data-mcp policy
│       ├── tool_auth_test.rego   OPA unit tests
│       └── rm_prep_authz.rego    RM Prep policy — row/column security
│
├── platform-sdk/                 Shared Python package — installed into every service
│   └── platform_sdk/
│       ├── auth.py               AgentContext, HMAC signing, permission helpers
│       ├── config.py             AgentConfig, MCPConfig
│       ├── security.py           OpaClient, make_api_key_verifier
│       ├── cache.py              ToolResultCache, @cached_tool
│       ├── compaction.py         Context window trimming
│       ├── agent.py              build_agent(), build_specialist_agent()
│       ├── logging.py            Structured JSON logging
│       └── telemetry.py          OpenTelemetry setup
│
├── tests/
│   ├── unit/                     Layer 1 — pure Python, no external deps
│   │   ├── test_auth.py          HMAC, JWT, column masks, row filters
│   │   ├── test_cache_key.py     Key stability and clearance isolation
│   │   └── test_brief_render.py  RMBrief Markdown rendering
│   ├── integration/              Layer 2 — requires Docker Compose stack
│   │   ├── test_opa_policies.py  Full OPA authorization matrix
│   │   ├── test_payments_sql.py  Direct SQL + column alias regression
│   │   └── test_rm_prep_server.py  API health, JWT, persona validation
│   └── evals/                    Layer 3 — requires live LLM
│       ├── judge.py              LLM judge + RagasFaithfulnessScorer
│       ├── fixtures/             4 JSON test cases (full access → denied)
│       ├── test_synthesis_quality.py   Rubric-based quality evals
│       ├── test_specialist_fidelity.py  Tool call verification (mocked)
│       └── test_faithfulness.py  RAGAS hallucination detection
│
├── platform/
│   ├── config/                   LiteLLM YAML configs (local + prod)
│   └── db/                       PostgreSQL init scripts + seed data
│
├── testdata/                     Synthetic CSV fixtures
│   ├── sfcrm/                    15 Salesforce object CSVs (45 Fortune 500 accounts)
│   └── bankdw/                   5 bank DW CSVs (1,000 payment transactions)
│
├── .github/workflows/
│   ├── ci-unit.yml               Hard gate — every push
│   ├── ci-integration.yml        Hard gate — PRs + main
│   └── ci-evals.yml              Advisory on PRs, hard gate on main
│
├── docker-compose.yml            Base stack (23 services)
├── docker-compose.test.yml       Test overlay — adds CRM + payments schemas
├── Makefile                      Developer workflow automation
└── pytest.ini                    Pytest markers: unit, integration, eval, slow
```

---

## Quick Start

### Prerequisites

| Tool | Version | macOS | Linux / WSL |
|---|---|---|---|
| Docker Desktop | Latest | [docker.com](https://docker.com) | [docker.com](https://docker.com) |
| Python | 3.11+ | `brew install python@3.11` | `apt install python3-full` |
| Make | Any | pre-installed | `apt install make` |
| OPA CLI | 0.65+ | `brew install opa` | see below |

```bash
# OPA CLI on Linux / WSL
curl -L -o opa https://github.com/open-policy-agent/opa/releases/download/v0.65.0/opa_linux_amd64_static \
  && chmod +x opa && sudo mv opa /usr/local/bin/opa
```

### First-time setup

```bash
# Install the shared SDK in editable mode
make sdk-install

# Configure environment
cp .env.example .env
# Edit .env — fill in:
#   AZURE_API_KEY, AZURE_API_BASE   (or AWS_* equivalents)
#   POSTGRES_PASSWORD
#   REDIS_PASSWORD
#   INTERNAL_API_KEY — generate with:
#     python -c "import secrets; print('sk-ent-' + secrets.token_hex(24))"
#   JWT_SECRET       — generate with:
#     python -c "import secrets; print(secrets.token_hex(32))"
```

### Start the stack

```bash
# Full stack WITH CRM + payments test data (recommended):
make dev-test-up

# Generic chat agent only (no CRM/payments):
make dev-up
```

### Service endpoints

| Interface | URL | Auth |
|---|---|---|
| Meridian RM Prep UI | http://localhost:8502 | Persona selector (SHOW_TEST_LOGIN=true) |
| Chat UI | http://localhost:8501 | Any username / INTERNAL_API_KEY |
| RM Prep Agent API | http://localhost:8003 | Bearer JWT (from test_tokens.py) |
| Generic Agent API | http://localhost:8000 | Bearer INTERNAL_API_KEY |
| LiteLLM Proxy | http://localhost:4000 | |
| OPA | http://localhost:8181 | |
| Salesforce MCP | http://localhost:8081 | |
| Payments MCP | http://localhost:8082 | |
| News MCP | http://localhost:8083 | |

---

## Common Commands

| Command | What it does |
|---|---|
| `make dev-test-up` | Full stack with CRM + payments test data |
| `make dev-up` | Stack without test fixtures |
| `make dev-down` | Stop all containers |
| `make dev-reset` | Wipe pgdata volume and restart (run after switching from dev-up to dev-test-up) |
| `make dev-logs` | Follow all container logs |
| `make test` | Unit tests + OPA policy tests (no Docker required) |
| `make test-unit` | Layer 1 unit tests only |
| `make test-integration` | Layer 2 integration tests (requires dev-test-up) |
| `make test-evals` | Layer 3 LLM evals (requires full stack + LLM creds) |
| `make test-evals-faithfulness` | RAGAS faithfulness evals only |
| `make test-policies` | OPA policy unit tests only |
| `make lint` | ruff linter across all Python services |
| `make sdk-install` | Create venv and install platform-sdk |
| `make k8s-dev` | Deploy to dev Kubernetes cluster |
| `make k8s-prod` | Deploy to production |
| `make clean` | Remove caches, build artifacts, and .venv |

---

## Why This Architecture

### For enterprise architects

**OPA as the authorization layer** means the platform is auditable by design. Every access decision is a Rego evaluation with a deterministic, testable, version-controlled outcome. There is no authorization logic buried in application code that a code reviewer might miss.

**The MCP pattern** means data source integrations are independently deployable and independently revokable. If the payments team needs to change their API, they update `payments-mcp` — no agent redeploys required. If a data source needs to be taken offline for maintenance, its MCP server is stopped — agents get a clean error, not a timeout.

**LangGraph StateGraph for the RM Prep Agent** provides compliance-grade guarantees: every domain specialist always runs, parallel execution meets latency requirements, and the structured `RMBrief` output is a contract that downstream consumers (Salesforce Lightning Component, Teams plugin, PDF export) can rely on without parsing free text.

**RAGAS faithfulness scoring** provides an objective, reproducible hallucination metric that can be tracked over time as models and prompts evolve. The 0.85 threshold on full-data cases is a measurable quality bar, not a qualitative judgement.

### For engineering teams

**The platform-sdk pattern** eliminates security and observability boilerplate from service code. A new MCP server is a thin FastAPI + FastMCP wrapper that focuses entirely on its data domain. The SDK handles everything else.

**The test pyramid** follows the standard separation of concerns: unit tests run in seconds with no external dependencies, integration tests verify the real system behaviour, and evals catch LLM-specific regressions that unit and integration tests structurally cannot detect.

**The synthetic test data** (`testdata/sfcrm/`, `testdata/bankdw/`) uses realistic Fortune 500 company names and plausible financial figures but contains no real data. The same data set is used in local development, CI integration tests, and eval fixtures — ensuring consistency across all testing contexts.

---

## Further Reading

- [RM Prep Agent Architecture](RM_PREP_AGENT_ARCHITECTURE.md) — detailed design rationale, MoE-inspired routing, evidence chain design, and phased delivery plan
- [Developer Guide](DEVELOPER_GUIDE.md) — step-by-step guides for adding new agents and MCP servers
- [Troubleshooting](TROUBLESHOOTING.md) — common issues and diagnostic commands
