/**
 * useAgentStream — React hook that drives the SSE streaming connection to
 * any registered agent backend.
 *
 * ── Responsibilities (this file only) ────────────────────────────────────
 *   • Manage React state: steps, activeStep, thoughts, streamingText,
 *     output, status, error
 *   • Provide run() / abort() / reset() to callers
 *   • Dispatch typed SSE events from sseStream into state updates
 *
 * ── SSE event types handled ───────────────────────────────────────────────
 * See src/types/sseEvents.js for the full contract.
 *
 *   progress       → advance the step timeline
 *   token          → append to streamingText (RM Prep only; enables live typing)
 *   llm_token      → append to thinkingText (real-time LLM reasoning from any node)
 *   tool_activity  → append to toolCalls[] (MCP tool start/end from any node)
 *   brief          → set final output + client name, status → 'complete'
 *   report         → set final output (+ meta stored on data), status → 'complete'
 *   thinking       → append evaluator insight to thoughts[] (Portfolio Watch)
 *   error          → set error message, status → 'error'
 *
 * ── Token streaming flow ──────────────────────────────────────────────────
 * When RM Prep's `synthesize` node runs it emits `token` events. The UI
 * accumulates them into `streamingText` and renders the markdown live.
 * When the final `brief` event arrives, `output` is set to the authoritative
 * full-text and `streamingText` can be ignored (OutputCanvas transitions
 * smoothly because `output` takes precedence when set).
 *
 * Portfolio Watch does NOT emit `token` events (revision loop would produce
 * confusing intermediate drafts), so `streamingText` stays empty for that
 * agent and the `report` event delivers the output all at once.
 *
 * ── LLM thinking flow ──────────────────────────────────────────────────
 * Both agents now emit `llm_token` events from specialist nodes showing
 * the LLM's real-time reasoning (thinking, planning, tool selection).
 * These tokens accumulate into `thinkingText` keyed by node name and are
 * displayed inside the ThinkingBlock.  When the node changes, the previous
 * node's text is finalised and a new buffer starts.
 *
 * `tool_activity` events show MCP tool calls (start/end) with input/output
 * previews — giving users visibility into which data sources are being queried.
 */

import { useState, useCallback, useRef } from 'react'
import { sseStream } from '../lib/sseStream.js'
import { buildHeaders } from '../api/apiClient.js'

export function useAgentStream() {
  const [steps,         setSteps]         = useState([])
  const [activeStep,    setActiveStep]    = useState(null)
  const [thoughts,      setThoughts]      = useState([])
  const [streamingText, setStreamingText] = useState('')  // live token buffer
  const [output,        setOutput]        = useState(null) // final markdown
  const [clientName,    setClientName]    = useState(null)
  const [status,        setStatus]        = useState('idle')
  const [error,         setError]         = useState(null)

  // ── LLM thinking state ──────────────────────────────────────────────────
  // thinkingText: running buffer of LLM tokens for the currently active node.
  //   { node: string, text: string }
  // thinkingLog: array of completed thinking segments from finished nodes.
  //   [{ id, node, text, ts }]
  // toolCalls: array of MCP tool call entries.  Start/end are PAIRED in-place:
  //   on_tool_start creates a new entry with action='start'; on_tool_end finds
  //   the matching start entry and updates it to action='end' with outputPreview.
  //   When the agent completes, any remaining 'start' entries are forced to 'end'.
  //   [{ id, action, tool, node, inputPreview?, outputPreview?, ts, endTs? }]
  const [thinkingText,  setThinkingText]  = useState(null)  // current node's LLM buffer
  const [thinkingLog,   setThinkingLog]   = useState([])    // completed node thinking segments
  const [toolCalls,     setToolCalls]     = useState([])    // MCP tool activity

  const abortRef          = useRef(null)
  const activeStepRef     = useRef(null)
  const seenStepsRef      = useRef(new Set()) // guards against duplicate progress events
  const thinkingNodeRef   = useRef(null)      // tracks which node is currently streaming LLM tokens
  const thinkingBufferRef = useRef('')        // accumulates tokens between React renders

  // ── Step timeline helpers ─────────────────────────────────────────────────

  const _advanceStep = (message) => {
    // Guard against empty messages and duplicates.
    //
    // Why a Set and not just a consecutive-equality check?
    // gather_payments and gather_news run in parallel; their ReAct specialist
    // agents make multiple tool calls, each firing on_chain_start with the
    // same langgraph_node name.  Because the two parallel branches interleave,
    // the same message may arrive non-consecutively (e.g. gather_payments fires,
    // then gather_news fires changing activeStep, then gather_payments fires
    // again).  A Set deduplicates across all orderings.
    if (!message || seenStepsRef.current.has(message)) return
    seenStepsRef.current.add(message)

    if (activeStepRef.current) {
      setSteps((prev) => [
        ...prev,
        { id: `${Date.now()}-${Math.random()}`, message: activeStepRef.current, ts: Date.now() },
      ])
    }
    activeStepRef.current = message
    setActiveStep(message)
  }

  const _flushActiveStep = () => {
    if (activeStepRef.current) {
      setSteps((prev) => [
        ...prev,
        { id: `flush-${Date.now()}`, message: activeStepRef.current, ts: Date.now() },
      ])
      activeStepRef.current = null
      setActiveStep(null)
    }
  }

  // Flush the current thinking buffer when the LLM switches to a new node
  const _flushThinkingBuffer = () => {
    if (thinkingNodeRef.current && thinkingBufferRef.current) {
      const node = thinkingNodeRef.current
      const text = thinkingBufferRef.current
      setThinkingLog((prev) => [
        ...prev,
        { id: `think-${Date.now()}-${Math.random()}`, node, text, ts: Date.now() },
      ])
    }
    thinkingNodeRef.current   = null
    thinkingBufferRef.current = ''
    setThinkingText(null)
  }

  // ── Public API ────────────────────────────────────────────────────────────

  const run = useCallback(async ({ endpoint, body }) => {
    // Reset all state for a fresh run
    setSteps([])
    setActiveStep(null)
    setThoughts([])
    setStreamingText('')
    setOutput(null)
    setClientName(null)
    setError(null)
    setThinkingText(null)
    setThinkingLog([])
    setToolCalls([])
    setStatus('streaming')
    activeStepRef.current     = null
    seenStepsRef.current      = new Set()
    thinkingNodeRef.current   = null
    thinkingBufferRef.current = ''

    const controller = new AbortController()
    abortRef.current = controller

    try {
      for await (const { type, data } of sseStream(endpoint, body, buildHeaders(), controller.signal)) {

        if (type === 'progress') {
          _advanceStep(data.message)

        } else if (type === 'token') {
          // Accumulate rendered-markdown tokens into the live text buffer.
          // The ThinkingBlock will auto-collapse when this becomes non-empty.
          setStreamingText((prev) => prev + data.text)

        } else if (type === 'llm_token') {
          // Real-time LLM reasoning tokens — accumulate per-node.
          // When the node changes, flush the previous node's buffer to thinkingLog.
          const node = data.node ?? 'unknown'
          if (thinkingNodeRef.current && thinkingNodeRef.current !== node) {
            _flushThinkingBuffer()
          }
          thinkingNodeRef.current    = node
          thinkingBufferRef.current += data.text
          setThinkingText({ node, text: thinkingBufferRef.current })

        } else if (type === 'tool_activity') {
          if (data.action === 'end') {
            // Pair with the matching "start" entry — update it to "end" in-place
            // so the UI shows a single bubble that transitions from calling → done.
            setToolCalls((prev) => {
              const idx = prev.findLastIndex(
                (tc) => tc.tool === data.tool && tc.action === 'start'
              )
              if (idx >= 0) {
                const updated = [...prev]
                updated[idx] = {
                  ...updated[idx],
                  action:        'end',
                  outputPreview: data.output_preview ?? null,
                  endTs:         Date.now(),
                }
                return updated
              }
              // No matching start found — add as standalone end entry
              return [
                ...prev,
                {
                  id:            `tool-${Date.now()}-${Math.random()}`,
                  action:        'end',
                  tool:          data.tool,
                  node:          data.node,
                  inputPreview:  null,
                  outputPreview: data.output_preview ?? null,
                  ts:            Date.now(),
                },
              ]
            })
          } else {
            // Start event — add a new entry
            setToolCalls((prev) => [
              ...prev,
              {
                id:            `tool-${Date.now()}-${Math.random()}`,
                action:        'start',
                tool:          data.tool,
                node:          data.node,
                inputPreview:  data.input_preview  ?? null,
                outputPreview: null,
                ts:            Date.now(),
              },
            ])
          }

        } else if (type === 'brief' || type === 'report') {
          _flushThinkingBuffer()
          _flushActiveStep()
          // Force any in-flight tool calls to "done" — some on_tool_end events
          // from nested ReAct agents may not propagate through astream_events.
          setToolCalls((prev) =>
            prev.map((tc) => tc.action === 'start' ? { ...tc, action: 'end' } : tc)
          )
          // Set the authoritative full output.  OutputCanvas transitions from
          // streamingText to output automatically when output becomes non-null.
          setOutput(data.markdown ?? '')
          setClientName(data.client_name ?? null)
          setStatus('complete')

        } else if (type === 'thinking') {
          setThoughts((prev) => [
            ...prev,
            {
              id:             `thought-${Date.now()}-${Math.random()}`,
              ts:             Date.now(),
              message:        data.message,
              verdict:        data.verdict,
              score:          data.score,
              issues:         data.issues         ?? [],
              missed_signals: data.missed_signals ?? [],
              phase:          data.phase,
            },
          ])

        } else if (type === 'error') {
          _flushThinkingBuffer()
          _flushActiveStep()
          setError(data.message ?? 'Unknown error from agent')
          setStatus('error')
        }
      }

      // Safety net: stream closed cleanly without a final event
      setStatus((s) => (s === 'streaming' ? 'complete' : s))

    } catch (err) {
      if (err.name === 'AbortError') return
      console.error('[useAgentStream]', err)
      setError(err.message)
      setStatus('error')
    }
  }, [])

  const abort = useCallback(() => {
    abortRef.current?.abort()
    activeStepRef.current = null
    setActiveStep(null)
    setStatus('idle')
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    activeStepRef.current     = null
    seenStepsRef.current      = new Set()
    thinkingNodeRef.current   = null
    thinkingBufferRef.current = ''
    setSteps([])
    setActiveStep(null)
    setThoughts([])
    setStreamingText('')
    setOutput(null)
    setClientName(null)
    setThinkingText(null)
    setThinkingLog([])
    setToolCalls([])
    setError(null)
    setStatus('idle')
  }, [])

  return {
    steps, activeStep, thoughts,
    streamingText, output, clientName,
    thinkingText, thinkingLog, toolCalls,
    status, error,
    run, abort, reset,
  }
}
