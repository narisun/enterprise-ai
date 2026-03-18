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
 *   progress  → advance the step timeline
 *   token     → append to streamingText (RM Prep only; enables live typing)
 *   brief     → set final output + client name, status → 'complete'
 *   report    → set final output (+ meta stored on data), status → 'complete'
 *   thinking  → append evaluator insight to thoughts[] (Portfolio Watch)
 *   error     → set error message, status → 'error'
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

  const abortRef      = useRef(null)
  const activeStepRef = useRef(null)
  const seenStepsRef  = useRef(new Set()) // guards against duplicate progress events

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
    setStatus('streaming')
    activeStepRef.current = null
    seenStepsRef.current  = new Set()

    const controller = new AbortController()
    abortRef.current = controller

    try {
      for await (const { type, data } of sseStream(endpoint, body, buildHeaders(), controller.signal)) {

        if (type === 'progress') {
          _advanceStep(data.message)

        } else if (type === 'token') {
          // Accumulate LLM tokens into the live text buffer.
          // The ThinkingBlock will auto-collapse when this becomes non-empty.
          setStreamingText((prev) => prev + data.text)

        } else if (type === 'brief' || type === 'report') {
          _flushActiveStep()
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
    activeStepRef.current = null
    seenStepsRef.current  = new Set()
    setSteps([])
    setActiveStep(null)
    setThoughts([])
    setStreamingText('')
    setOutput(null)
    setClientName(null)
    setError(null)
    setStatus('idle')
  }, [])

  return {
    steps, activeStep, thoughts,
    streamingText, output, clientName,
    status, error,
    run, abort, reset,
  }
}
