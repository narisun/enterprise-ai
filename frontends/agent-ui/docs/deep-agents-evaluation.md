# Deep Agents + assistant-ui Evaluation

**Date:** March 22, 2026
**Package:** `deepagents` — [GitHub](https://github.com/langchain-ai/deepagents) · [Docs](https://docs.langchain.com/oss/python/deepagents/overview)
**Reference UI:** [deep-agents-ui](https://github.com/langchain-ai/deep-agents-ui)
**License:** MIT

---

## What are Deep Agents?

Deep Agents is a structured agent harness built on LangGraph that implements a plan → execute → review loop. Rather than a simple ReAct "think → act → observe" cycle, deep agents explicitly decompose complex tasks into plans, delegate subtasks to isolated subagents, and use a filesystem backend to manage working memory beyond the context window.

### Core built-in tools

| Tool | Purpose |
|------|---------|
| `write_todos` | Planning — breaks tasks into steps, tracks progress in `/todos.md` |
| `task` | Delegation — spawns a subagent with its own context, tools, and tool loop |
| `ls`, `read_file`, `write_file`, `edit_file` | Filesystem — offloads large data to storage instead of stuffing context |
| `glob`, `grep` | Search — find files and content across the workspace |
| `execute` | Shell — run commands in a sandboxed environment |
| `compact_conversation` | Memory — summarize and compress long conversations |

### Middleware stack

Deep agents ship with composable middleware that runs on every agent step:

1. **TodoListMiddleware** — maintains the plan in state
2. **FilesystemMiddleware** — manages file I/O
3. **SubAgentMiddleware** — handles subagent lifecycle and context isolation
4. **SummarizationMiddleware** — compresses long conversations to avoid context overflow
5. **AnthropicPromptCachingMiddleware** — optimizes token usage with Anthropic models
6. **PatchToolCallsMiddleware** — normalizes tool call formats across providers

### API surface

```python
from deepagents import create_deep_agent

graph = create_deep_agent(
    model="anthropic/claude-sonnet-4-5-20250514",
    tools=[...],               # Custom tools added alongside built-ins
    system_prompt="...",       # Domain-specific instructions
    subagents=[...],           # Specialized sub-agents for delegation
    middleware=[...],          # Additional middleware after defaults
    checkpointer=checkpointer, # LangGraph checkpointer for persistence
    interrupt_on=["task"],     # Human-in-the-loop breakpoints
)

# Returns a compiled LangGraph StateGraph — works with streaming, Studio, etc.
```

---

## How this relates to our current architecture

### What we have today

Our platform uses two hand-built LangGraph agents with custom graph topologies:

**RM Prep Agent:**
```
conversation_router → [route → gather_crm → gather_payments → gather_news → synthesize → format_brief]
                    → [conversational_responder]
                    → [refine_brief → format_brief]
                    → [clarify_intent]
```

**Portfolio Watch Agent:**
```
conversation_router → [gather_portfolio → gather_signals → generate_narrative → evaluate_narrative → format_report]
                    → [conversational_responder]
                    → [refine_report → evaluate_narrative → format_report]
                    → [clarify_intent]
```

Each node is a purpose-built function that calls specific MCP tools (Salesforce, payments, news, portfolio APIs) and produces structured output. The multi-turn conversation router we just implemented classifies turns into `new_task | follow_up | refinement | clarification`.

### What deep agents would change

Deep agents replace our hand-crafted graph topology with a **general-purpose agent loop** that plans, delegates, and reviews autonomously. Instead of hardcoded node sequences, the agent decides at runtime which tools to call and in what order.

| Aspect | Our current approach | Deep agents approach |
|--------|---------------------|---------------------|
| **Task decomposition** | Implicit in graph topology (fixed node sequence) | Explicit via `write_todos` (dynamic planning) |
| **Tool orchestration** | Hardcoded edges between nodes | Agent decides tool order at runtime |
| **Context management** | Full state dict passed through graph | Filesystem backend + subagent context isolation |
| **Multi-turn** | Custom conversation_router node with turn classification | Built-in via LangGraph checkpointer + conversation compaction |
| **Error handling** | Per-node try/catch with error state | Agent can retry, replan, or delegate to recovery subagent |
| **Fact-checking** | Portfolio Watch: evaluate_narrative → revision loop | Can be a subagent that reviews main agent's output |

---

## Fit assessment: should we build a new deep agent?

### Strong alignment

1. **It's still LangGraph underneath.** `create_deep_agent` returns a compiled `StateGraph` — it streams via `astream_events`, uses checkpointers, and works with LangGraph Studio. Our existing SSE infrastructure (sseStream.js → useAgentStream reducer) can consume it with minimal changes.

2. **Planning visibility maps to assistant-ui.** The `write_todos` tool produces structured plan updates that can be rendered as real-time progress in assistant-ui's `ToolUI` components. Users see the agent's plan form and execute step by step — far more transparent than our current "Gathering CRM data…" progress labels.

3. **Subagent delegation fits our multi-source pattern.** Instead of hardcoded `gather_crm → gather_payments → gather_news` edges, the agent can spawn parallel subagents: one for CRM research, one for payment analysis, one for news gathering. Each runs in isolation with its own context, and results are written to the filesystem for the main agent to synthesize.

4. **Human-in-the-loop is native.** `interrupt_on=["task"]` lets us pause before subagent execution for user approval — directly maps to assistant-ui's interrupt/resume pattern.

5. **Custom tools plug in cleanly.** Our MCP tool wrappers (Salesforce, payments, news, portfolio APIs) can be passed as `tools=[...]` to `create_deep_agent`. The agent decides when and how to use them based on its plan.

### Concerns and trade-offs

1. **Loss of deterministic pipelines.** Our current agents follow a predictable sequence — CRM first, then payments, then news, then synthesize. Deep agents choose their own order. For regulated enterprise use cases, this non-determinism may worry compliance teams. Mitigation: detailed system prompts + subagent constraints can guide behavior, and all tool calls are logged.

2. **Latency from planning overhead.** The plan → execute → review loop adds LLM calls. Our current RM Prep agent makes ~5 LLM calls (router, 3 gathers, synthesize). A deep agent might make 8–10 (plan, 3 subagent spawns, 3 gathers, synthesize, review). For a meeting prep brief where the RM needs it in 30 seconds, this matters.

3. **Harder to debug.** Fixed graph topology is easy to reason about — node X failed, fix node X. Deep agents make runtime decisions, so failures require inspecting the plan, the subagent that failed, and the context at that point. The deep-agents-ui debug mode helps, but it's an additional tool to learn.

4. **Migration cost for existing agents.** We just spent significant effort building the multi-turn conversation router, conversational responder, and refine brief nodes. Deep agents would replace all of this with a different architecture. We'd need to rewrite our MCP tool integrations as deep agent tools, restructure our prompts, and re-test.

5. **Filesystem backend adds complexity.** Our current agents pass data through the LangGraph state dict — clean, type-safe (Pydantic), and inspectable. Deep agents use a virtual filesystem for working memory. For structured data like CRM records and payment histories, files are less ergonomic than typed state fields.

---

## Recommended path: hybrid approach

Rather than migrating our existing agents to deep agents (high cost, questionable value for their focused use cases), we should **build a new "Enterprise Research Agent"** as a deep agent that sits alongside RM Prep and Portfolio Watch.

### The new agent: Enterprise Research Agent

A general-purpose deep agent for open-ended enterprise questions that don't fit a specific pipeline:

- "Compare our exposure to Acme Corp vs. Beta Inc across all data sources"
- "What happened with our top 5 clients in EMEA last quarter?"
- "Research this prospect and tell me everything we know"
- "Write a memo summarizing the key risks in our APAC portfolio"

This agent would:

1. **Plan** — use `write_todos` to decompose the research question
2. **Delegate** — spawn subagents for each data source (CRM, payments, news, portfolio)
3. **Synthesize** — combine results into a coherent analysis
4. **Review** — fact-check the synthesis against source data
5. **Deliver** — produce a structured document (markdown brief, PDF report)

### Architecture

```
┌─────────────────────────────────────────────────────┐
│  Frontend (assistant-ui)                             │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ Thread        │  │ Tool UI      │  │ Plan       │ │
│  │ (messages)    │  │ (approvals)  │  │ (todos)    │ │
│  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘ │
│         └──────────────────┴───────────────┘         │
│                        │ SSE stream                   │
├────────────────────────┼────────────────────────────┤
│  Backend               │                             │
│  ┌─────────────────────▼──────────────────────────┐ │
│  │  Intent Router (existing)                       │ │
│  │  ┌──────────┐ ┌──────────────┐ ┌─────────────┐ │ │
│  │  │ RM Prep  │ │ Portfolio    │ │ Enterprise  │ │ │
│  │  │ (custom  │ │ Watch        │ │ Research    │ │ │
│  │  │  graph)  │ │ (custom      │ │ (deep       │ │ │
│  │  │          │ │  graph)      │ │  agent)     │ │ │
│  │  └──────────┘ └──────────────┘ └─────────────┘ │ │
│  │       ▲              ▲               ▲          │ │
│  │       └──────────────┴───────────────┘          │ │
│  │                MCP Tools                        │ │
│  │  (Salesforce, Payments, News, Portfolio APIs)   │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### Why hybrid?

- **RM Prep stays as-is.** Its deterministic pipeline (always: CRM → payments → news → synthesize) is a feature, not a limitation. RMs need predictable, fast briefs before meetings. The multi-turn conversation router we just built handles follow-ups.

- **Portfolio Watch stays as-is.** Its evaluate → revise loop with fact-checking is already a review pattern. The fixed topology ensures every report is validated.

- **Enterprise Research is new.** It handles the open-ended questions that neither focused agent covers. Deep agents' planning + delegation pattern is ideal here because the tool sequence isn't known in advance.

### assistant-ui integration for all three

| Agent | assistant-ui rendering |
|-------|----------------------|
| RM Prep | `MessagePrimitive` for brief, custom `ToolUI` for ThinkingBlock steps |
| Portfolio Watch | `MessagePrimitive` for report, `ToolUI` for evaluation thoughts |
| Enterprise Research | Full deep agent UI: `ToolUI` for plan (todos), subagent status cards, approval interrupts, filesystem artifact cards |

The Enterprise Research agent is where assistant-ui's advanced features (human-in-the-loop, generative UI, branch picking) shine most — the user can watch the plan form, approve subagent delegation, and steer the research interactively.

---

## Implementation roadmap

### Phase 1: assistant-ui adoption (from previous evaluation)
Adopt assistant-ui across all existing agents — runtime bridge, message rendering, markdown. This gives us the UI infrastructure.

### Phase 2: Enterprise Research deep agent (1–2 weeks)
1. Install `deepagents` package
2. Wrap our MCP tools (Salesforce, payments, news, portfolio) as deep agent tools
3. Write the system prompt with enterprise domain knowledge
4. Configure subagents for each data domain
5. Set up `interrupt_on` for sensitive operations
6. Wire SSE streaming to assistant-ui via ExternalStoreRuntime

### Phase 3: Deep agent UI components (1 week)
1. Build `PlanViewer` ToolUI — renders `write_todos` output as a live checklist
2. Build `SubAgentCard` ToolUI — shows subagent status, context, and results
3. Build `FileArtifact` ToolUI — renders filesystem outputs (memos, reports) as downloadable cards
4. Wire `interrupt`/`resume` for human-in-the-loop approval on sensitive queries

### Phase 4: Intent router expansion
Update `intentRouter.js` to route open-ended research questions to the Enterprise Research agent while keeping focused queries (meeting prep, portfolio risk) on their specialized agents.

---

## Conclusion

Deep agents are a powerful addition to our platform, but they complement rather than replace our existing agents. The plan → execute → review loop is ideal for open-ended enterprise research where the tool sequence isn't predetermined. Combined with assistant-ui's composable primitives, this gives us a three-tier agent experience: focused pipelines (RM Prep, Portfolio Watch) for predictable tasks, and a deep agent (Enterprise Research) for exploratory analysis — all rendered through a consistent, industry-standard chat interface.
