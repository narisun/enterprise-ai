/**
 * SSE stream parser — opens a POST request and yields typed events.
 * Handles our custom deep agent wire format:
 *   event: plan_update | tool_start | tool_end | token | subagent_start |
 *          subagent_end | artifact | thinking | error | done
 *   data: { ... }
 */
export async function* sseStream({ url, body, signal }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let currentEvent = 'message'

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        const raw = line.slice(5).trim()
        if (!raw) continue
        try {
          yield { type: currentEvent, data: JSON.parse(raw) }
        } catch {
          // Non-JSON data — yield as text
          yield { type: currentEvent, data: { text: raw } }
        }
        currentEvent = 'message'
      }
    }
  }

  // Flush remaining buffer
  if (buffer.trim()) {
    const lines = buffer.split(/\r?\n/)
    for (const line of lines) {
      if (line.startsWith('data:')) {
        const raw = line.slice(5).trim()
        if (raw) {
          try {
            yield { type: currentEvent, data: JSON.parse(raw) }
          } catch {
            yield { type: currentEvent, data: { text: raw } }
          }
        }
      }
    }
  }
}
