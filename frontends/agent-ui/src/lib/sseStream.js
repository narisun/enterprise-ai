/**
 * sseStream.js — pure async generator for Server-Sent Events over fetch.
 *
 * Zero React dependency — import this in unit tests without a DOM or React
 * runtime.  Pass in a mocked `fetch` via the optional last argument.
 *
 * ── Why an async generator? ───────────────────────────────────────────────
 * An async generator decouples parsing from consumption.  The caller (the
 * React hook) iterates with `for await … of` and handles each typed event
 * with a plain switch/if — no callback nesting, no manual reader wiring.
 *
 * ── Wire format handled ───────────────────────────────────────────────────
 *   • \r\n line endings (HTTP spec / sse_starlette default)
 *   • \n   line endings (plain SSE / test fixtures)
 *   • Events split across multiple read() chunks
 *   • Multiple events in a single chunk
 *
 * @module lib/sseStream
 */

// How long to wait for the next chunk before giving up.
// Exposed as a default so callers (and tests) can override it.
const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Open a POST → SSE stream and yield typed events one at a time.
 *
 * @param {string}            url          POST endpoint (relative or absolute)
 * @param {object}            body         JSON-serialisable request body
 * @param {Record<string, string>} headers  HTTP headers; must include Authorization
 * @param {AbortSignal}       signal        AbortController signal for cancellation
 * @param {object}            [opts]
 * @param {number}            [opts.timeoutMs=30000]  Inactivity timeout in ms
 * @param {typeof fetch}      [opts.fetchFn=fetch]    Injectable fetch for testing
 * @yields {import('../types/sseEvents').AgentSSEEvent}
 * @throws {Error} On non-OK HTTP status, stream timeout, or unrecoverable network error
 */
export async function* sseStream(url, body, headers, signal, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchFn   = fetch,
} = {}) {
  // ── 1. Open the HTTP connection ─────────────────────────────────────────
  const response = await fetchFn(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body:    JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}${text ? ` — ${text}` : ''}`)
  }

  // ── 2. Stream line-by-line ───────────────────────────────────────────────
  const reader  = response.body.getReader()
  const decoder = new TextDecoder()
  let lineBuffer   = ''   // accumulates bytes until a complete line arrives
  let currentEvent = null // value of the `event:` field for the current block

  while (true) {
    // Race read() against an inactivity timeout so a silently-dropped backend
    // connection surfaces as a descriptive error rather than a hung UI.
    let timeoutId
    let chunk
    try {
      chunk = await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error(`SSE stream timed out after ${timeoutMs / 1000}s with no data`)),
            timeoutMs,
          )
        }),
      ])
    } catch (err) {
      reader.cancel().catch(() => {})
      throw err
    } finally {
      clearTimeout(timeoutId)
    }

    const { done, value } = chunk
    if (done) break

    // Strip \r so we only need to split on \n
    lineBuffer += decoder.decode(value, { stream: true }).replace(/\r/g, '')

    // Slice off all complete lines, keep any trailing partial line in the buffer
    const newline = lineBuffer.lastIndexOf('\n')
    if (newline === -1) continue  // no complete line yet — wait for more data

    const completeLines = lineBuffer.slice(0, newline).split('\n')
    lineBuffer = lineBuffer.slice(newline + 1)

    for (const raw of completeLines) {
      const line = raw.trim()

      if (line === '') {
        // Blank line signals the end of an SSE event block; reset event type
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
        try {
          data = JSON.parse(jsonStr)
        } catch (parseErr) {
          // A malformed payload is a backend bug — warn loudly so it surfaces
          // in the browser console during development, but keep the stream open
          // so subsequent events are not lost.
          console.warn(
            '[sseStream] malformed JSON on line (event skipped):',
            JSON.stringify(raw),
            parseErr.message,
          )
          continue
        }

        // Primary dispatch: use the explicit `event:` field.
        // Fallback: content-based inference (deprecated — see below).
        const type = currentEvent ?? _inferEventType(data)

        if (type === null) {
          console.warn('[sseStream] unrecognised event (no event: field, inference failed):', data)
          continue
        }

        yield { type, data }
      }
    }
  }
}

// ── Content-based event type inference (DEPRECATED) ───────────────────────
//
// This fallback exists only to guard against a misconfigured backend that
// omits the `event:` field.  sse_starlette always includes it, so this code
// should NEVER fire in production.
//
// A console.warn is intentionally emitted every time it triggers so that
// any regression is immediately visible in the browser DevTools console.
// Do not promote this to a silent fallback.
//
// @deprecated  Fix the backend to emit `event:` rather than relying on this.
function _inferEventType(data) {
  let inferred = null
  if ('markdown' in data && 'meta' in data) inferred = 'report'
  else if ('markdown' in data)              inferred = 'brief'
  else if ('verdict'  in data && 'score' in data) inferred = 'thinking'
  else if ('message'  in data)             inferred = 'progress'

  if (inferred !== null) {
    console.warn(
      '[sseStream] _inferEventType triggered — backend omitted event: field. ' +
      `Inferred type: "${inferred}". ` +
      'Fix the backend to emit an explicit event: field on every SSE block.',
      data,
    )
  }

  return inferred
}
