# Guided UX Experience — Implementation Plan

**Status:** Draft for review
**Scope:** Analytics Dashboard (`frontends/analytics-dashboard`)
**Goal:** Build progressive context from user inputs through data-grounded suggestions, intentional interaction patterns, and AI-generated follow-up guidance.

---

## Overview

Three self-contained features ship in sequence. Each can be reviewed and merged independently.

| # | Feature | Effort | Files changed |
|---|---------|--------|---------------|
| 1 | Data-grounded welcome suggestions | Small — frontend only | 2 |
| 2 | Click-to-populate (no auto-submit) | Trivial — 3-line change | 1 |
| 3 | Follow-up suggestions after responses | Medium — full-stack | 7 |

---

## Feature 1 — Data-Grounded Welcome Screen Suggestions

### Problem

The current `SuggestionChips.tsx` ships six generic, hardcoded strings that do not reflect the actual data in the system:

```
"Revenue by account"
"Salesforce pipeline"
"Payment trends for Microsoft"
"Top accounts by annual revenue"
"Show opportunity stages breakdown"
"Recent news about Tesla"
```

Only one of these ("Payment trends for Microsoft") references a real company in the testdata. The rest are abstract and give the user no mental model of what data is available or how to ask for it.

### Approach

Replace the flat list with **categorized, data-grounded suggestions** that:

- Reference real entities from `testdata/` (company names, products, opportunity stages)
- Use `[placeholder]` syntax to signal where users should substitute their own values
- Are organized by the four MCP tool domains the agent actually has access to

### Suggestion Content (informed by testdata)

**Payments & Banking** (`bankdw`: fact_payments, dim_party, dim_bank, dim_product)

Real party names from testdata: Microsoft Corp., Ford Motor Company, Delta Air Lines, Deutsche Bank AG, Citibank N.A., JPMorgan Chase, Goldman Sachs

```
"Show payment trends for [company name]"
"Compare inbound vs outbound payments for Microsoft Corp."
"Which banks processed the most volume for Ford Motor Company last quarter?"
"Break down payment activity by product type"
```

**CRM & Pipeline** (`sfcrm`: Account, Opportunity, Contact, Case)

Real account names from testdata: Acme Corp, TechNova Solutions, Global Retail Inc, Meridian Healthcare, Apex Financial Services, NexGen Manufacturing

```
"What's the current pipeline value and stage breakdown?"
"Show open opportunities for [account name]"
"Which accounts have the highest annual revenue?"
"List cases opened this month by priority"
```

**News & Market Intelligence** (`news-search-mcp`)

```
"Recent news about [company name]"
"What are analysts saying about Goldman Sachs this week?"
"Summarize recent regulatory news in financial services"
```

**Cross-domain**

```
"Combine payment data and CRM risk signals for Delta Air Lines"
"Which top CRM accounts have declining payment volume?"
```

### Selected Defaults (8 shown on welcome screen, 2 per category)

```typescript
const SUGGESTIONS = [
  // Payments
  { label: "Payment trends for [company name]",         query: "Show payment trends for [company name] over the last 90 days" },
  { label: "Top payment volume by bank",                query: "Which banks processed the highest payment volume last quarter?" },

  // CRM
  { label: "Pipeline stage breakdown",                  query: "Show current opportunity pipeline broken down by stage and value" },
  { label: "Top accounts by annual revenue",            query: "List the top 10 accounts ranked by annual revenue" },

  // Cross-domain
  { label: "Combined risk view for [company name]",     query: "Show payment activity and open CRM cases for [company name]" },
  { label: "Accounts with declining payment volume",    query: "Which CRM accounts have shown declining inbound payment volume in the last 60 days?" },

  // News
  { label: "Recent news about [company name]",          query: "Search for recent news and analyst coverage about [company name]" },
  { label: "Financial sector regulatory news",          query: "Summarize recent regulatory and compliance news in financial services" },
];
```

The `[placeholder]` tokens are intentional — they signal to the user that they need to supply a value, which naturally leads them to read the query before submitting (reinforcing Feature 2).

### Files Changed

**`frontends/analytics-dashboard/components/chat/SuggestionChips.tsx`**

- Replace the hardcoded `queries` array with the `SUGGESTIONS` array above
- Update the chip rendering to show `label` as the chip text and pass `query` to `onSelect`
- Optional: show chips in a 2-column grid (4 rows) rather than a horizontal scroll, for better scanability on desktop

**`frontends/analytics-dashboard/components/chat/EmptyState.tsx`**

- Update the subtitle from "Try asking about your data" to something like: "Ask about payments, CRM pipeline, and market news. Click any suggestion to start — you can edit before sending."
- This primes users for the click-to-populate behavior introduced in Feature 2.

### No Backend Changes Required

---

## Feature 2 — Click-to-Populate (No Auto-Submit)

### Problem

In `ChatContainer.tsx`, clicking a suggestion chip immediately submits the query without giving the user a chance to review or edit it:

```typescript
// ChatContainer.tsx ~line 158
const handleSuggestionSelect = useCallback(
  (query: string) => {
    setInput(query);
    setTimeout(() => formRef.current?.requestSubmit(), 50);  // ← submits automatically
  },
  [setInput]
);
```

This is particularly problematic for suggestions containing `[placeholder]` tokens — the user would submit a literal `[company name]` string to the agent.

### Fix

Remove the auto-submit. Populate the input and move focus to it so the user can immediately edit and press Enter (or click Send) when ready:

```typescript
const handleSuggestionSelect = useCallback(
  (query: string) => {
    setInput(query);
    // Focus the textarea so the user can edit before submitting
    inputRef.current?.focus();
  },
  [setInput]
);
```

`inputRef` is already available in `ChatContainer` via the `ChatInput` child — if it isn't forwarded yet, add a `useRef` and pass it down.

### UX Outcome

1. User clicks "Payment trends for [company name]"
2. Text box fills with "Show payment trends for [company name] over the last 90 days"
3. Cursor lands in the text box
4. User replaces `[company name]` with "Microsoft Corp." and presses Enter
5. Agent receives a well-formed, specific query

### Files Changed

**`frontends/analytics-dashboard/components/chat/ChatContainer.tsx`**

- Remove `setTimeout(() => formRef.current?.requestSubmit(), 50)`
- Add `inputRef.current?.focus()` after `setInput(query)`
- Ensure `inputRef` is forwarded from `ChatInput` (add if missing)

---

## Feature 3 — Follow-Up Suggestions After Agent Responses

### Problem

After the agent responds, the conversation goes silent. The user must know what to ask next entirely on their own. There is no guidance, no contextual note explaining what was shown, and no suggestions to continue the investigation.

### Approach

The agent's synthesis node — which already understands what data was fetched and what was displayed — generates three follow-up suggestions tailored to the response. These are streamed back alongside the narrative and displayed below the assistant message as clickable chips. A short contextual note ("Want to go deeper?") is rendered above the chips.

This is a full-stack change: backend schema → state → synthesis prompt → streaming → frontend types → new component → message list.

---

### Backend Changes

#### 1. `agents/analytics-agent/src/schemas/ui_components.py`

Add `follow_up_suggestions` to `AnalyticsResponse`:

```python
class AnalyticsResponse(BaseModel):
    narrative: str = Field(description="Natural language summary of the analysis")
    components: list[UIComponent] = Field(default_factory=list)
    follow_up_suggestions: list[str] = Field(
        default_factory=list,
        description=(
            "3 short follow-up questions the user might want to ask next, "
            "based on what was just shown. Each should be a complete, "
            "submittable query. Maximum 3 items."
        ),
    )
```

#### 2. `agents/analytics-agent/src/state.py`

Add the field to `AnalyticsState`:

```python
class AnalyticsState(TypedDict):
    # ... existing fields ...
    follow_up_suggestions: list[str]   # populated by synthesis node
```

#### 3. `agents/analytics-agent/src/nodes/synthesis.py`

Extend `_SYNTHESIS_SYSTEM_PROMPT` with a section instructing the LLM to generate follow-ups that are contextual and progressively deeper:

```
## Follow-Up Suggestions

After generating the narrative and components, produce exactly 3 follow_up_suggestions.

Rules:
- Each suggestion must be a complete, self-contained query the user can submit as-is
- Each must build on what was just shown — not generic restarts
- Vary the angle: one drill-down (more detail on a specific entity), one comparison
  (benchmark against another entity or time period), one cross-domain (connect to a
  different data source — CRM if you just queried payments, news if you just showed CRM)
- Keep them under 15 words
- Do not use placeholder tokens — use specific entity names from the data you retrieved

Example (after showing payment trends for Microsoft Corp.):
  follow_up_suggestions: [
    "Compare Microsoft Corp. payment volume with Ford Motor Company last quarter",
    "Show open CRM opportunities for Microsoft Corp. over $1M",
    "Search for recent news about Microsoft Corp. and financial services"
  ]
```

Update the return statement to pass the field into state:

```python
return {
    "narrative": response.narrative,
    "ui_components": response.components,
    "follow_up_suggestions": response.follow_up_suggestions,
    "messages": [AIMessage(content=response.narrative)],
}
```

#### 4. `agents/analytics-agent/src/app.py`

The `AnalyticsResponse` is already serialized and streamed as a custom data event (`2:` prefix in the Vercel AI SDK Data Stream Protocol). Extend the streaming payload to include `follow_up_suggestions`:

```python
# In the SSE emit block, where ui_components are streamed:
await data_stream.write_data({
    "type": "analytics_response",
    "narrative": state["narrative"],
    "components": [c.model_dump() for c in state.get("ui_components", [])],
    "follow_up_suggestions": state.get("follow_up_suggestions", []),
})
```

No change to the streaming protocol version — this is additive; old frontends will simply ignore the new field.

---

### Frontend Changes

#### 5. `frontends/analytics-dashboard/lib/types.ts`

Add the field to the `AnalyticsData` type that the frontend uses to represent a parsed custom data event:

```typescript
export interface AnalyticsData {
  type: "analytics_response";
  narrative: string;
  components: UIComponent[];
  follow_up_suggestions?: string[];   // optional — safe for older payloads
}
```

#### 6. New file: `frontends/analytics-dashboard/components/chat/FollowUpChips.tsx`

A new component that renders follow-up chips below an assistant message. Visually distinct from welcome-screen chips (smaller, outlined style vs. filled) to signal that these are contextual rather than starting points:

```typescript
interface FollowUpChipsProps {
  suggestions: string[];
  onSelect: (query: string) => void;
}

export function FollowUpChips({ suggestions, onSelect }: FollowUpChipsProps) {
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs text-muted-foreground">Want to go deeper?</p>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((s, i) => (
          <button
            key={i}
            onClick={() => onSelect(s)}
            className="text-xs px-3 py-1.5 rounded-full border border-border
                       hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
```

These chips also use click-to-populate behavior (Feature 2) — clicking calls `onSelect` which populates the input without submitting.

#### 7. `frontends/analytics-dashboard/components/chat/MessageList.tsx`

Render `FollowUpChips` below the **last assistant message only**, using the `follow_up_suggestions` from the parsed analytics data:

```typescript
import { FollowUpChips } from "./FollowUpChips";

// Inside the message map:
{message.role === "assistant" && isLastAssistantMessage && (
  analyticsData?.follow_up_suggestions?.length > 0
) && (
  <FollowUpChips
    suggestions={analyticsData.follow_up_suggestions}
    onSelect={onSuggestionSelect}  // same handler as welcome screen chips
  />
)}
```

`onSuggestionSelect` is already passed down from `ChatContainer` — wire it through `MessageList`'s props if not already there.

---

## Implementation Order

These should be implemented and merged in order, as each builds on the last:

```
Feature 2 (trivial)  →  Feature 1 (welcome suggestions)  →  Feature 3 (follow-ups)
```

Feature 2 first because Feature 1 introduces `[placeholder]` tokens that depend on the no-auto-submit behavior being in place.

---

## File Change Summary

| File | Change |
|------|--------|
| `components/chat/SuggestionChips.tsx` | Replace hardcoded strings with data-grounded `SUGGESTIONS` array |
| `components/chat/EmptyState.tsx` | Update subtitle copy |
| `components/chat/ChatContainer.tsx` | Remove `setTimeout` auto-submit; add `inputRef.focus()` |
| `agents/analytics-agent/src/schemas/ui_components.py` | Add `follow_up_suggestions: list[str]` to `AnalyticsResponse` |
| `agents/analytics-agent/src/state.py` | Add `follow_up_suggestions: list[str]` to `AnalyticsState` |
| `agents/analytics-agent/src/nodes/synthesis.py` | Extend prompt + return `follow_up_suggestions` in state update |
| `agents/analytics-agent/src/app.py` | Include `follow_up_suggestions` in streamed data event |
| `frontends/analytics-dashboard/lib/types.ts` | Add `follow_up_suggestions?: string[]` to `AnalyticsData` |
| `components/chat/FollowUpChips.tsx` | **New file** — contextual follow-up chip component |
| `components/chat/MessageList.tsx` | Render `FollowUpChips` after last assistant message |

**Total: 9 files (1 new, 9 changed)**

---

## Out of Scope (future consideration)

- **Personalized suggestions**: Storing per-user query history in Redis and seeding the welcome screen with queries that match their past patterns
- **Schema-aware placeholder resolution**: Auto-detecting `[company name]` tokens and showing an inline autocomplete populated from `dim_party` names
- **Suggestion ranking**: Using the agent's intent classifier to order suggestions by likelihood given the conversation so far
- **Pinning follow-ups**: Allowing users to save a follow-up to a "saved queries" sidebar
