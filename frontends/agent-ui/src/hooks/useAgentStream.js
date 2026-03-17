/**
 * useAgentStream — React hook that drives the SSE streaming connection to
 * any registered agent backend.
 *
 * SSE wire format (from rm-prep-agent FastAPI / sse_starlette):
 *
 *   event: progress\r\n   (or \n — we handle both)
 *   data: {"message": "Fetching CRM relationship data…"}\r\n
 *   \r\n
 *
 *   event: brief\r\n
 *   data: {"markdown": "# RM Brief\n…", "client_name": "Acme"}\r\n
 *   \r\n
 *
 *   event: error\r\n
 *   data: {"message": "Something went wrong"}\r\n
 *   \r\n
 *
 * ── Why the rewrite ────────────────────────────────────────────────────────
 * The previous version used buffer.lastIndexOf('\n\n') to detect event
 * boundaries.  sse_starlette uses HTTP-spec CRLF (\r\n) so that search
 * never matched, events were never parsed, and the UI stayed blank.
 *
 * This version goes line-by-line (identical strategy to the working Streamlit
 * client) and handles both \r\n and \n transparently.
 *
 * It also avoids calling setSteps() inside a setActiveStep() updater
 * (nested-setState anti-pattern that React batching can silently drop).
 * The "current active step" is now tracked in a plain ref instead.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { useState, useCallback, useRef } from 'react'

const API_KEY = import.meta.env.VITE_API_KEY ?? ''

export function useAgentStream() {
  const [steps,      setSteps]      = useState([])   // completed pipeline steps
  const [activeStep, setActiveStep] = useState(null) // currently-running step label
  const [output,     setOutput]     = useState(null) // final markdown string
  const [clientName, setClientName] = useState(null)
  const [status,     setStatus]     = useState('idle') // idle|streaming|complete|error
  const [error,      setError]      = useState(null)

  const abortRef      = useRef(null)
  // Track active step in a ref so we can read the current value synchronously
  // inside the stream loop without depending on stale closure state.
  const activeStepRef = useRef(null)

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Promote the current active step to the completed list, then set a new one. */
  const _advanceStep = (message) => {
    if (activeStepRef.current) {
      const done = { id: `${Date.now()}-${Math.random()}`, message: activeStepRef.current, ts: Date.now() }
      setSteps((prev) => [...prev, done])
    }
    activeStepRef.current = message
    setActiveStep(message)
  }

  /** Flush the active step (if any) to the completed list and clear it. */
  const _flushActiveStep = () => {
    if (activeStepRef.current) {
      const done = { id: `flush-${Date.now()}`, message: activeStepRef.current, ts: Date.now() }
      setSteps((prev) => [...prev, done])
      activeStepRef.current = null
      setActiveStep(null)
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * run — kick off an agent request.
   * @param {object} opts
   * @param {string} opts.endpoint  relative URL, e.g. '/api/brief'
   * @param {object} opts.body      JSON body for the POST request
   */
  const run = useCallback(async ({ endpoint, body }) => {
    // ── Reset ──────────────────────────────────────────────────────────────
    setSteps([])
    setActiveStep(null)
    setOutput(null)
    setClientName(null)
    setError(null)
    setStatus('streaming')
    activeStepRef.current = null

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`HTTP ${response.status}${text ? ` — ${text}` : ''}`)
      }

      // ── Line-by-line SSE parsing ──────────────────────────────────────────
      //
      // We read the body as a stream, accumulate chunks into a text buffer,
      // and process complete lines one at a time.  This handles:
      //   • \r\n line endings (sse_starlette / HTTP spec)
      //   • \n  line endings (plain SSE)
      //   • events split across multiple read() chunks
      //
      const reader  = response.body.getReader()
      const decoder = new TextDecoder()
      let lineBuffer  = ''       // incomplete trailing line
      let currentEvent = null    // event: field from the current SSE block

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        // Append decoded chunk; strip \r so we only deal with \n boundaries
        lineBuffer += decoder.decode(value, { stream: true }).replace(/\r/g, '')

        // Extract all complete lines (terminated by \n), keep the partial tail
        const newline = lineBuffer.lastIndexOf('\n')
        if (newline === -1) continue  // no complete line yet — keep accumulating

        const completeLines = lineBuffer.slice(0, newline).split('\n')
        lineBuffer = lineBuffer.slice(newline + 1)

        for (const raw of completeLines) {
          const line = raw.trim()

          if (line === '') {
            // Blank line = end of SSE event block; reset event type
            currentEvent = null
            continue
          }

          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim()
            continue
          }

          if (line.startsWith('data:')) {
            const jsonStr = line.slice(5).trim()
            let data
            try { data = JSON.parse(jsonStr) } catch { continue }

            // ── Dispatch by event type ──────────────────────────────────────
            // Primary: use the event: field that sse_starlette provides.
            // Fallback: content-based detection (mirrors Streamlit client).
            const eventType = currentEvent ?? _inferEventType(data)

            console.debug('[SSE]', eventType, data)

            if (eventType === 'progress') {
              _advanceStep(data.message)

            } else if (eventType === 'brief') {
              _flushActiveStep()
              // Safety: if data.markdown is missing (double-encoded edge case),
              // try to re-parse `data` as a JSON string.
              let markdown = data.markdown
              if (markdown === undefined && typeof data === 'string') {
                try { markdown = JSON.parse(data).markdown } catch { /* ignore */ }
              }
              console.log('[SSE brief] markdown length:', markdown?.length, 'preview:', markdown?.slice(0, 120))
              setOutput(markdown ?? '')
              setClientName(data.client_name ?? null)
              setStatus('complete')

            } else if (eventType === 'error') {
              _flushActiveStep()
              setError(data.message ?? 'Unknown error from agent')
              setStatus('error')
            } else {
              console.warn('[SSE] unhandled event type:', eventType, data)
            }
          }
        }
      }

      // Safety net: if the stream closed without a 'brief' event
      setStatus((s) => (s === 'streaming' ? 'complete' : s))

    } catch (err) {
      if (err.name === 'AbortError') return
      console.error('[useAgentStream]', err)
      setError(err.message)
      setStatus('error')
    }
  }, []) // no deps — helpers use refs, setters are stable

  const abort = useCallback(() => {
    abortRef.current?.abort()
    activeStepRef.current = null
    setActiveStep(null)
    setStatus('idle')
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    activeStepRef.current = null
    setSteps([])
    setActiveStep(null)
    setOutput(null)
    setClientName(null)
    setError(null)
    setStatus('idle')
  }, [])

  return { steps, activeStep, output, clientName, status, error, run, abort, reset }
}

// ── Content-based event type inference (fallback) ─────────────────────────────
// Mirrors exactly what the Streamlit client does:
//   'markdown' key present → brief
//   'message' key present  → progress (or error, but UI handles both the same)
function _inferEventType(data) {
  if ('markdown' in data)              return 'brief'
  if ('message' in data)               return 'progress'
  return null
}
