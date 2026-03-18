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
 *   progress   — a pipeline stage has started; emitted by all agents
 *   token      — a single LLM output token; RM Prep (synthesize node) only
 *   brief      — final output from the RM Prep agent (Alex)
 *   report     — final output from the Portfolio Watch agent (Morgan)
 *   thinking   — evaluator transparency event; Portfolio Watch only
 *   error      — the pipeline failed; stream ends after this event
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
 *   | { type: 'progress', data: ProgressEventData }
 *   | { type: 'token',    data: TokenEventData    }
 *   | { type: 'brief',    data: BriefEventData    }
 *   | { type: 'report',   data: ReportEventData   }
 *   | { type: 'thinking', data: ThinkingEventData }
 *   | { type: 'error',    data: ErrorEventData    }
 * } AgentSSEEvent
 */

// This file contains only JSDoc types — there is no runtime export.
// Import the types with:  @param {import('../types/sseEvents').AgentSSEEvent} event
export {}
