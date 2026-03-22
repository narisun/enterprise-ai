/**
 * sseEvents.js — JSDoc type definitions for all SSE events emitted by agent
 * backends.
 *
 * This is the single source of truth for the wire contract between the FastAPI
 * streaming endpoints and the React frontend.  Backend and frontend developers
 * should update this file together when adding new event types or fields.
 *
 * ── Current protocol version: v1 ──────────────────────────────────────────
 *
 * Events are delivered as Server-Sent Events (SSE) with the following format:
 *
 *   event: <type>\r\n
 *   data:  <JSON>\r\n
 *   \r\n
 *
 * The `event:` field is ALWAYS present (sse_starlette guarantees this).
 * Clients MUST NOT rely on content-sniffing as a primary dispatch mechanism.
 *
 * ── Event catalogue ───────────────────────────────────────────────────────
 *
 *   progress      — a pipeline stage has started; emitted by all agents
 *   token         — a single rendered-markdown token; RM Prep (format_brief) only
 *   llm_token     — a real-time LLM output token (thinking/reasoning); all agents
 *   tool_activity  — MCP tool call start/end; all agents
 *   brief         — final output from the RM Prep agent (Alex)
 *   report        — final output from the Portfolio Watch agent (Morgan)
 *   thinking      — evaluator transparency event; Portfolio Watch only
 *   error         — the pipeline failed; stream ends after this event
 *
 * ── Backend endpoints that emit these events ──────────────────────────────
 *
 *   POST /brief           → rm-prep-agent:8003
 *   POST /portfolio-watch → portfolio-watch-agent:8004
 */

// ---------------------------------------------------------------------------
// Individual event data payloads
// ---------------------------------------------------------------------------

/**
 * Emitted when a named pipeline stage begins execution.
 * The UI should advance its progress indicator.
 *
 * @typedef {object} ProgressEventData
 * @property {string}  message  Human-readable step label, e.g. "Fetching CRM data…"
 * @property {string=} phase    Optional phase bucket: "gather" | "generate" | "evaluate" | "format"
 */

/**
 * A single LLM output token streamed from the synthesis node.
 * Emitted only by RM Prep (rm-prep-agent) during the `synthesize` step.
 * Portfolio Watch does NOT emit tokens because its generator can be revised
 * in a loop — streaming intermediate drafts would be confusing.
 *
 * The UI should accumulate these into a `streamingText` buffer and render
 * it as live markdown.  When the final `brief` event arrives, `streamingText`
 * can be discarded in favour of the authoritative full-text response.
 *
 * @typedef {object} TokenEventData
 * @property {string} text  One or more characters from the LLM output stream
 */

/**
 * Final output from the RM Prep agent (Alex).
 * Signals that the stream is complete; the UI should exit streaming state.
 *
 * @typedef {object} BriefEventData
 * @property {string}  markdown     Full markdown string of the generated brief
 * @property {string=} client_name  Canonical client name extracted during intent parsing
 */

/**
 * Report metadata attached to a portfolio-watch report event.
 *
 * @typedef {object} ReportMeta
 * @property {number}  total_flags       Number of risk flags surfaced
 * @property {number}  evaluation_score  Final evaluator confidence score (0–1)
 * @property {number}  iterations        Number of generate→evaluate loop iterations
 */

/**
 * Final output from the Portfolio Watch agent (Morgan).
 * Signals that the stream is complete; the UI should exit streaming state.
 *
 * @typedef {object} ReportEventData
 * @property {string}     markdown  Full markdown string of the generated report
 * @property {ReportMeta} meta      Report statistics and quality metadata
 */

/**
 * Evaluator transparency event — emitted by Portfolio Watch after each
 * fact-checking pass.  The UI may display these as "thinking" bubbles.
 *
 * @typedef {object} ThinkingEventData
 * @property {string}   message         Human-readable summary, e.g. "Fact-check score: 87% — 2 issues found"
 * @property {'pass'|'revise'} verdict  Whether the evaluator approved the draft
 * @property {number}   score           Confidence score (0–1)
 * @property {string[]} issues          List of specific factual issues found
 * @property {string[]} missed_signals  Risk signals present in the data but absent from the draft
 * @property {string=}  phase           Pipeline phase label
 */

/**
 * Real-time LLM output token — streamed from specialist agent nodes while
 * they reason about tool calls, plan data retrieval, or generate content.
 *
 * Unlike `token` events (which stream pre-rendered markdown from format_brief),
 * these represent the LLM's actual thinking process and are displayed inside
 * the ThinkingBlock to give users visibility into what the agent is doing.
 *
 * For RM Prep, the specialist gather nodes use nested ReAct agents.  Their
 * inner events propagate through astream_events(v2) but the `node` field
 * is mapped to the outer orchestrator node name (e.g. "gather_crm") by the
 * server for meaningful UI labels.
 *
 * @typedef {object} LLMTokenEventData
 * @property {string} text  One or more characters from the LLM's output
 * @property {string} node  Effective node name (outer orchestrator node for
 *                          nested agents, e.g. "gather_crm", "gather_news")
 */

/**
 * MCP tool invocation event — emitted when a specialist agent calls or
 * completes an MCP tool.  Gives the user visibility into which data sources
 * are being queried and what results come back.
 *
 * @typedef {object} ToolActivityEventData
 * @property {'start'|'end'} action         Whether the tool is starting or finished
 * @property {string}        tool           MCP tool name (e.g. "get_crm_summary")
 * @property {string}        node           LangGraph node making the call
 * @property {string=}       input_preview  Truncated input (start only, max 200 chars)
 * @property {string=}       output_preview Truncated output (end only, max 300 chars)
 */

/**
 * Emitted when the pipeline encounters a fatal error.
 * The UI should display the message and exit streaming state.
 *
 * @typedef {object} ErrorEventData
 * @property {string} message  Human-readable error description
 */

// ---------------------------------------------------------------------------
// Discriminated union of all possible SSE events
// ---------------------------------------------------------------------------

/**
 * @typedef {
 *   | { type: 'progress',      data: ProgressEventData      }
 *   | { type: 'token',         data: TokenEventData         }
 *   | { type: 'llm_token',     data: LLMTokenEventData      }
 *   | { type: 'tool_activity', data: ToolActivityEventData   }
 *   | { type: 'brief',         data: BriefEventData         }
 *   | { type: 'report',        data: ReportEventData        }
 *   | { type: 'thinking',      data: ThinkingEventData      }
 *   | { type: 'error',         data: ErrorEventData         }
 * } AgentSSEEvent
 */

// This file contains only JSDoc types — there is no runtime export.
// Import the types with:  @param {import('../types/sseEvents').AgentSSEEvent} event
export {}
