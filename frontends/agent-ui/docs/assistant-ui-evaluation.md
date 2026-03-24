# assistant-ui Evaluation for Enterprise AI Platform

**Date:** March 22, 2026
**Package:** `@assistant-ui/react` — [GitHub](https://github.com/assistant-ui/assistant-ui) · [npm](https://www.npmjs.com/package/@assistant-ui/react)
**License:** MIT
**Backing:** Y Combinator

---

## What is assistant-ui?

A TypeScript/React component library for building production-grade AI chat interfaces. It follows a Radix UI–style composable primitives approach — instead of a monolithic `<Chat />` component, you compose granular building blocks (`ThreadPrimitive`, `MessagePrimitive`, `ComposerPrimitive`, `ActionBarPrimitive`, etc.) and bring your own styling via a shadcn/ui theme layer.

### Key capabilities out of the box

- **Streaming** — token-by-token rendering with auto-scroll, backpressure handling
- **Markdown** — code highlighting, syntax themes, GFM tables
- **Tool call rendering** — custom React components for each tool, with human-in-the-loop approval (`interrupt.payload` → `resume()`)
- **Attachments** — file upload, drag-and-drop, image preview
- **Branch picking** — navigate between response variants (regenerations)
- **Voice input** — dictation support
- **Keyboard shortcuts & accessibility** — ARIA, focus management, a11y defaults
- **Generative UI** — render arbitrary React components inline from tool calls

### Runtime architecture

assistant-ui decouples the UI layer from the backend via a "runtime" abstraction:

| Runtime | Best for |
|---------|----------|
| **AI SDK Runtime** | Vercel AI SDK backends (useChat / useCompletion) |
| **LangGraph Runtime** | LangGraph Cloud API with streaming |
| **ExternalStoreRuntime** | Custom backends — you own the state (Redux, Zustand, etc.) |
| **LocalRuntime** | Client-side inference or custom HTTP endpoints |

---

## How our current frontend compares

| Capability | Our implementation | assistant-ui |
|---|---|---|
| **Streaming render** | Custom `sseStream.js` async generator → `useAgentStream` reducer → token-by-token render with cursor | Built-in, battle-tested across hundreds of production apps |
| **Message list** | Custom `ChatView.jsx` with scroll-to-bottom, live message injection | `ThreadPrimitive.Viewport` + `ThreadPrimitive.Messages` with auto-scroll, virtualization |
| **Input composer** | Custom `ChatInput.jsx` — auto-resize textarea, Enter/Shift+Enter, stop button | `ComposerPrimitive` with attachments, voice input, keyboard shortcuts |
| **Markdown** | `react-markdown` + `remark-gfm` + `rehype-raw` + custom renderers in `markdownRenderers.jsx` | Built-in with code highlighting, copy button, syntax themes |
| **Thinking/steps** | Custom `ThinkingBlock.jsx` — collapsible timeline, tool call cards | Tool UI components with `makeAssistantToolUI()` — render per tool type |
| **Artifact cards** | Custom `ArtifactCard.jsx` — expand/collapse, copy, download | Can be built as a tool UI or generative UI component |
| **Tool calls** | Custom reducer tracking `TOOL_START` / `TOOL_END` events, manual rendering | First-class `ToolUI` with approval flows, loading states, result rendering |
| **Human-in-the-loop** | Not implemented | Built-in — tools can `interrupt` and `resume` with user approval |
| **Branch/regenerate** | Not implemented | Built-in `BranchPickerPrimitive` |
| **Accessibility** | Manual ARIA labels, skip-nav, focus management | Built-in a11y defaults |
| **State management** | Custom `useChat.js` hook with snapshot lifecycle | Managed by runtime — `ExternalStoreRuntime` or `useThreadRuntime` |

**Lines of code we'd replace:**

| File | Lines | Purpose |
|------|-------|---------|
| `useAgentStream.js` | ~180 | SSE reducer + streaming state |
| `useChat.js` | ~120 | Conversation state + snapshot lifecycle |
| `ChatView.jsx` | ~100 | Message list + scroll management |
| `ChatInput.jsx` | ~80 | Composer with auto-resize |
| `ChatMessage.jsx` | ~200 | Message bubble + streaming cursor |
| `ThinkingBlock.jsx` | ~160 | Activity timeline |
| `markdownRenderers.jsx` | ~90 | Custom markdown components |
| `sseStream.js` | ~100 | SSE parser |
| **Total** | **~1,030** | Core chat infrastructure |

---

## Integration fit analysis

### The good: where assistant-ui aligns

1. **LangGraph runtime exists.** assistant-ui has a dedicated `@assistant-ui/react-langgraph` adapter. Since our backend IS LangGraph, this is a natural fit — it can consume LangGraph's streaming protocol directly.

2. **ExternalStoreRuntime as escape hatch.** For our custom SSE events (`progress`, `tool_activity`, `thinking`, `brief`, `report`), we can use `ExternalStoreRuntime` to bridge our existing `useAgentStream` reducer state into assistant-ui's component tree. We don't have to go all-in on their runtime — we can keep our SSE parser and feed messages into their store adapter.

3. **Tool UI is a major upgrade.** Our `ThinkingBlock` and tool call rendering is custom and brittle. assistant-ui's `makeAssistantToolUI()` gives us typed, per-tool-name components with loading/result states and approval flows. This directly enables the human-in-the-loop patterns we'll need for enterprise features (e.g., "confirm before executing trade", "approve data source query").

4. **Composable primitives preserve our design.** We have a specific enterprise look — agent avatars, color-coded departments, artifact cards, status pills. The primitives approach means we keep our visual identity while leveraging their streaming/scroll/a11y infrastructure.

5. **Markdown rendering is strictly better.** Their built-in renderer includes code copy buttons, syntax highlighting, and proper table handling — things we'd eventually need to add.

### The concerns: where friction exists

1. **Custom SSE event types.** Our backend emits 8 distinct event types (`progress`, `token`, `llm_token`, `tool_activity`, `brief`, `report`, `thinking`, `error`). The LangGraph runtime expects LangGraph Cloud's wire format. We'd either need to:
   - (a) Adapt our SSE output to match LangGraph Cloud's format, or
   - (b) Use `ExternalStoreRuntime` and keep our custom SSE parser as the bridge

   Option (b) is more practical since our backend is self-hosted LangGraph (not LangGraph Cloud).

2. **ThinkingBlock is domain-specific.** Our collapsible step timeline with phase labels ("Gathering CRM data…", "Analyzing payment patterns…") is tightly coupled to our agent pipeline topology. assistant-ui has no equivalent — we'd still build this as a custom component, but it can live inside their message rendering tree.

3. **Artifact cards have no direct equivalent.** The expand/collapse brief card with Copy + Download is custom UI. We'd implement this as a `ToolUI` component or a custom message part renderer. Not a blocker, but not free either.

4. **Bundle size increase.** We currently have ~7 production dependencies. Adding `@assistant-ui/react` + its shadcn/ui peer dependencies adds weight. For an enterprise app, this is acceptable, but worth noting.

5. **shadcn/ui styling assumption.** assistant-ui's themed layer assumes shadcn/ui (Tailwind + Radix). We already use Tailwind, so this aligns well. But we don't currently use shadcn's component library — adopting it partially may create style inconsistencies.

---

## Recommendation: Incremental adoption (yes, adopt it)

assistant-ui is the right choice for our platform. Unlike LibreChat (which we evaluated and rejected due to SSE protocol mismatch and framework differences), assistant-ui is a **component library, not a framework** — it slots into our existing React app without requiring architectural changes.

### Adoption strategy: 3 phases

**Phase 1 — Runtime bridge (1–2 days)**
- Install `@assistant-ui/react`
- Create an `ExternalStoreRuntime` adapter that maps our `useChat` + `useAgentStream` state into assistant-ui's message format
- Keep our existing `sseStream.js` and `useAgentStream.js` as-is — they feed the store
- Swap `ChatView.jsx` message list to use `ThreadPrimitive` for auto-scroll and virtualization
- Swap `ChatInput.jsx` to use `ComposerPrimitive` for input handling

**Phase 2 — Message rendering (2–3 days)**
- Replace `ChatMessage.jsx` streaming cursor with assistant-ui's streaming renderer
- Replace `markdownRenderers.jsx` with assistant-ui's markdown components
- Build `ThinkingBlock` as a custom assistant-ui message part (keeps our design, uses their rendering lifecycle)
- Build `ArtifactCard` as a `ToolUI` component for `brief` and `report` outputs

**Phase 3 — Advanced features (ongoing)**
- Add human-in-the-loop approval for sensitive tool calls using `interrupt`/`resume`
- Add branch picking for response regeneration
- Add file attachment support for document-based queries
- Evaluate `@assistant-ui/react-langgraph` if we move to LangGraph Cloud hosting

### What we keep

- `sseStream.js` — our SSE parser handles our custom wire format
- `useAgentStream.js` — continues as the streaming state reducer
- `useRouter.js` — URL routing is orthogonal to chat UI
- `useSession.js` — session management stays
- `agents.js` / `agentClients.js` — agent configuration and API contracts
- `intentRouter.js` — client-side intent detection
- Sidebar, AgentSelector, SettingsPanel, UserProfile, HelpGuide — all non-chat UI

### What we retire

- `ChatView.jsx` → replaced by `ThreadPrimitive` composition
- `ChatMessage.jsx` → replaced by `MessagePrimitive` composition
- `ChatInput.jsx` → replaced by `ComposerPrimitive` composition
- `markdownRenderers.jsx` → replaced by assistant-ui markdown renderer
- `useChat.js` → replaced by `ExternalStoreRuntime` adapter
- Streaming cursor CSS → handled by assistant-ui

---

## Risk assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Custom SSE events don't map cleanly | Medium | ExternalStoreRuntime gives full control — we adapt on our side |
| ThinkingBlock requires custom work | Low | Build as composable message part — our existing component logic ports over |
| shadcn/ui style conflicts | Low | Adopt shadcn CSS variables for chat area only; rest of app keeps current Tailwind classes |
| Library abandonment | Low | YC-backed, MIT licensed, actively maintained (daily commits), 7k+ GitHub stars |
| Learning curve for team | Medium | Radix-style API is well-documented; existing React/Tailwind skills transfer directly |

---

## Conclusion

assistant-ui gives us **industry-standard AI chat UX** (streaming, auto-scroll, tool rendering, a11y, branch picking) without surrendering control over our enterprise-specific components (thinking timeline, artifact cards, agent avatars). The `ExternalStoreRuntime` path means we can adopt incrementally — keep our battle-tested SSE parser and streaming reducer, while progressively replacing hand-rolled UI with composable primitives.

The main value isn't replacing what we have — it's **what we don't have to build next**: human-in-the-loop approvals, file attachments, branch picking, response regeneration, and proper virtualized message lists for long conversations. These are table-stakes features for enterprise AI apps, and building them from scratch would take weeks.
