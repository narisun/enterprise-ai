# Multi-Turn Conversational Backend — Architecture Proposal

**Date:** March 22, 2026
**Status:** Proposal
**Scope:** Backend changes to support natural multi-turn conversations for enterprise RM users

---

## 1. Problem Statement

Today each specialist agent (RM Prep, Portfolio Watch) runs as a **pipeline** — every message triggers the full workflow from scratch:

```
parse_intent → route → gather_crm → gather_payments → gather_news → synthesize → format_brief
```

When an RM asks a follow-up like *"What about their payment trends from last quarter?"*, the system re-runs the entire pipeline instead of conversationally building on what it already gathered. The `parse_intent` node tries to extract a client name from every message, which fails for conversational follow-ups that don't repeat the company name.

The checkpointer preserves LangGraph state across turns, but the graph topology doesn't distinguish between *"start a new brief"* and *"ask a follow-up about the brief you just generated"*.

---

## 2. Root Cause Analysis

Three structural gaps prevent natural multi-turn:

**Gap 1 — No turn-type classification.** The `parse_intent` node only recognizes task intents (`full_brief`, `quick_update`, `news_check`, `payment_check`). It has no concept of a follow-up, refinement, or general question that should use existing context rather than re-gathering data.

**Gap 2 — No conversational node.** Every path through the graph ends at `format_brief` which renders a full structured document. There is no node that can answer a natural language question using the data already in state (crm_output, payments_output, news_output, brief_data).

**Gap 3 — Synthesize is stateless.** The synthesis prompt receives only the raw specialist outputs — not the conversation history or the previous brief. It cannot produce a response that references what was discussed before.

---

## 3. Proposed Architecture

Add a **Conversation Router** at the entry point of the graph that classifies each turn and branches to either the existing pipeline or a new **Conversational Responder** node.

### 3.1 Updated Graph Topology

```
                                    ┌─────────────────────────────────────────┐
                                    │        EXISTING PIPELINE                │
                                    │  route → gather_* → synthesize → format │
                                    └────────────────▲────────────────────────┘
                                                     │
                                              [new_task]
                                                     │
  User Message ──► conversation_router ──────────────┤
                                                     │
                                             [follow_up]
                                                     │
                                    ┌────────────────▼────────────────────────┐
                                    │       NEW: CONVERSATIONAL RESPONDER     │
                                    │  Uses existing state + conversation     │
                                    │  history to answer naturally            │
                                    └─────────────────────────────────────────┘
```

### 3.2 New Node: `conversation_router`

Replaces the current `parse_intent` as the entry point. Uses a fast model (Haiku) with structured output to classify the turn:

```python
class TurnClassification(BaseModel):
    turn_type: Literal["new_task", "follow_up", "refinement", "clarification"]
    # Only populated for new_task turns:
    client_name: Optional[str] = None
    intent_type: Optional[str] = None  # full_brief | quick_update | news_check | payment_check
    meeting_date: Optional[str] = None
```

Classification logic for the LLM:

| Turn Type | Description | Example |
|-----------|-------------|---------|
| `new_task` | New client or explicit new request | *"Prepare me for a meeting with Acme Corp"* |
| `follow_up` | Question about data already gathered | *"What were their largest payments?"* |
| `refinement` | Modify or regenerate the previous output | *"Make the talking points more specific to their Q4 revenue drop"* |
| `clarification` | Ambiguous or missing info | *"Which Microsoft entity?"* |

The key insight: **the router sees the full message history** via `state["messages"]` plus the existing `brief_data`, `crm_output`, etc. This gives it enough context to distinguish *"Tell me about Microsoft"* (new task — no prior context) from *"Tell me more about their payments"* (follow-up — brief already exists in state).

### 3.3 New Node: `conversational_responder`

A synthesis-tier LLM (Sonnet) that answers using everything already in state:

```python
async def conversational_responder(state: RMPrepState) -> dict:
    prompt = _load_prompt(
        "conversational_responder.j2",
        conversation=state["messages"],       # Full history
        crm_data=state.get("crm_output"),
        payments_data=state.get("payments_output"),
        news_data=state.get("news_output"),
        previous_brief=state.get("brief_markdown"),
    )
    response = await synthesis_llm.ainvoke([HumanMessage(content=prompt)])
    return {
        "messages": [AIMessage(content=response.content)],
        "brief_markdown": response.content,   # Update the displayed output
    }
```

The prompt template (`conversational_responder.j2`) instructs the LLM to:

- Answer using ONLY data present in state (no hallucination)
- Cite sources with [CRM], [Payments], [News] tags
- Reference the previous brief when appropriate
- Be conversational, not re-generate a full structured brief
- For refinement requests, produce an updated brief incorporating the feedback

### 3.4 Refinement Path (Re-synthesis with Feedback)

When the turn type is `refinement`, we route to a modified synthesize path that includes the user's feedback:

```python
async def refine_brief(state: RMPrepState) -> dict:
    # Get the most recent user message (the refinement request)
    last_user_msg = [m for m in state["messages"] if isinstance(m, HumanMessage)][-1]

    prompt = _load_prompt(
        "refine_synthesis.j2",
        previous_brief=state.get("brief_markdown"),
        feedback=last_user_msg.content,
        crm_data=state.get("crm_output"),
        payments_data=state.get("payments_output"),
        news_data=state.get("news_output"),
    )
    brief = await structured.ainvoke([HumanMessage(content=prompt)])
    return {"brief_data": brief.model_dump()}
```

This re-runs synthesis with the original data **plus** the user's feedback, then flows through `format_brief` as before.

### 3.5 Updated Conditional Edges

```python
builder.set_entry_point("conversation_router")

builder.add_conditional_edges(
    "conversation_router",
    _route_after_classification,
    {
        "new_task":       "route",              # Existing pipeline
        "follow_up":      "conversational_responder",  # New node
        "refinement":     "refine_brief",       # New node → format_brief
        "clarification":  "clarify_intent",     # Existing node
    }
)

# New edges
builder.add_edge("conversational_responder", END)
builder.add_edge("refine_brief", "format_brief")
```

### 3.6 State Schema Changes

Minimal additions to `RMPrepState`:

```python
class RMPrepState(TypedDict):
    # ... existing fields unchanged ...

    # NEW: Track turn metadata for the conversational router
    turn_type: Optional[str]       # new_task | follow_up | refinement | clarification
    turn_count: int                # Incremented each turn (for compaction decisions)
```

The `messages` field with `add_messages` reducer already accumulates conversation history across turns via the checkpointer — no changes needed there.

---

## 4. SSE Streaming Updates

The server.py SSE handler needs minimal changes:

```python
# New progress labels
_PROGRESS_LABELS = {
    # ... existing labels ...
    "conversation_router":       "Understanding your request...",
    "conversational_responder":  "Analyzing available data...",
    "refine_brief":              "Refining the brief with your feedback...",
}
```

The `conversational_responder` node uses a standard LLM call (not structured output), so its tokens will flow through the existing `on_chat_model_stream` handler and appear as `llm_token` SSE events — streaming works automatically.

For `refine_brief`, the flow is identical to the existing `synthesize → format_brief` path, so the SSE events (`thinking`, `token`, `brief`) all work unchanged.

---

## 5. Frontend Integration

The frontend needs one change: **send the full prompt text, not a pre-formatted command**. Currently `agentClients.js` builds the request body — this stays the same since `body.prompt` is already the raw user message.

The key difference is behavioural: the backend now decides whether to pipeline or converse, so the frontend doesn't need separate handling for follow-ups vs new tasks.

The SSE event types remain identical. The `ChatMessage` component already renders both streaming markdown and structured briefs. A follow-up response from `conversational_responder` will arrive as `llm_token` events (streaming text) without a final `brief` event — the frontend already handles this case via `streamingText` in the live stream object.

---

## 6. Implementation Plan

### Phase 1: Conversation Router (2-3 days)

1. Create `TurnClassification` Pydantic model
2. Write `conversation_router` node with structured output
3. Write the classification prompt template
4. Replace `parse_intent` as the entry point
5. Wire conditional edges: `new_task → route`, `clarification → clarify_intent`
6. For `follow_up` and `refinement`, temporarily route to existing pipeline (no behaviour change yet)
7. Add unit tests for turn classification

### Phase 2: Conversational Responder (2-3 days)

1. Create `conversational_responder.j2` prompt template
2. Implement `conversational_responder` node
3. Wire `follow_up → conversational_responder → END`
4. Update SSE handler with new progress labels
5. Test multi-turn: new brief → follow-up question → follow-up answer
6. Verify conversation history accumulates correctly via checkpointer

### Phase 3: Refinement Path (1-2 days)

1. Create `refine_synthesis.j2` prompt template
2. Implement `refine_brief` node
3. Wire `refinement → refine_brief → format_brief → END`
4. Test: generate brief → "make talking points more specific" → refined brief

### Phase 4: Portfolio Watch Agent (2-3 days)

Apply the same pattern to the Portfolio Watch agent:

1. Add `conversation_router` as entry point
2. Add `conversational_responder` for follow-ups about portfolio data
3. Add `refine_report` for report modification requests
4. The generator-evaluator loop remains unchanged for new tasks

---

## 7. Model Cost Implications

| Node | Model | When Called | Cost Impact |
|------|-------|-------------|-------------|
| `conversation_router` | Haiku (fast) | Every turn | ~same as current `parse_intent` |
| `conversational_responder` | Sonnet (complex) | Follow-up turns only | New cost, but skips the 3 specialist agents + synthesis — **net cheaper** than re-running the pipeline |
| `refine_brief` | Sonnet (complex) | Refinement turns only | Same as single synthesis call |

Follow-up turns should actually be **cheaper** than today because they skip the gather phase entirely.

---

## 8. Migration Path

This is **backward compatible**. The `conversation_router` classifies existing single-turn requests as `new_task` and routes them through the unchanged pipeline. No API contract changes, no database migrations, no breaking changes.

The `session_id → thread_id` mapping and checkpointer infrastructure are already in place. The only new data flowing through the checkpointer is the `turn_type` and `turn_count` fields, which have safe defaults (`None` and `0`).

---

## 9. Future Enhancements

**Cross-agent follow-ups.** Today each agent has its own graph and checkpointer state. A future supervisor agent could maintain a shared conversation and dispatch to the right specialist graph:

```
User: "Prepare me for a meeting with Acme" → RM Prep pipeline
User: "Now show me their portfolio risk"   → Portfolio Watch pipeline (same session)
```

This requires a thin **supervisor graph** that wraps both specialist graphs as subgraphs, with a shared message history and a router that dispatches based on intent. The `conversation_router` pattern proposed here is the building block for that supervisor.

**Selective re-gathering.** For follow-ups like *"Get me fresh news on this client"*, the router could classify as `partial_refresh` and re-run only the `gather_news` specialist, merging the result into existing state before responding.

**User memory across sessions.** Using LangGraph's `Store` API alongside the checkpointer, the system could remember RM preferences ("I always want payment trends as a chart") across sessions.
