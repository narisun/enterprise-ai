/**
 * sseStream.test.js
 *
 * Unit tests for the pure SSE parser using Node.js's built-in test runner
 * (node:test + node:assert/strict).  No extra dependencies required —
 * runs with: node --test src/lib/sseStream.test.js
 *
 * When Vitest becomes available (npm registry access), the tests can be
 * migrated to Vitest syntax; the test logic stays the same.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { sseStream } from './sseStream.js'

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Build a ReadableStream that emits the provided string chunks then closes. */
function makeStream(...chunks) {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

/**
 * Build a fake fetch that returns a 200 SSE response whose body is the
 * provided ReadableStream.
 */
function okFetch(stream) {
  return mock.fn(async () => ({
    ok:     true,
    status: 200,
    body:   stream,
  }))
}

/**
 * Build a fake fetch that returns a non-OK HTTP response.
 */
function errorFetch(status, responseText = '') {
  return mock.fn(async () => ({
    ok:     false,
    status,
    text:   async () => responseText,
    body:   makeStream(''),
  }))
}

/** Collect all events yielded by an async generator into an array. */
async function collect(gen) {
  const events = []
  for await (const evt of gen) events.push(evt)
  return events
}

// Shared fixture values
const URL     = '/api/test'
const BODY    = { prompt: 'hello' }
const HEADERS = { Authorization: 'Bearer test-key' }
const signal  = () => new AbortController().signal
// Pass a very large timeout so no test accidentally hits it
const opts    = (fetchFn) => ({ fetchFn, timeoutMs: 60_000 })

// ── Happy-path tests ──────────────────────────────────────────────────────────

describe('sseStream — happy path', () => {
  it('parses a single CRLF event', async () => {
    const raw = 'event: progress\r\ndata: {"message":"Step 1"}\r\n\r\n'
    const events = await collect(sseStream(URL, BODY, HEADERS, signal(), opts(okFetch(makeStream(raw)))))

    assert.strictEqual(events.length, 1)
    assert.deepStrictEqual(events[0], { type: 'progress', data: { message: 'Step 1' } })
  })

  it('parses a single LF event', async () => {
    const raw = 'event: brief\ndata: {"markdown":"# Hello","client_name":"Acme"}\n\n'
    const events = await collect(sseStream(URL, BODY, HEADERS, signal(), opts(okFetch(makeStream(raw)))))

    assert.strictEqual(events.length, 1)
    assert.deepStrictEqual(events[0], { type: 'brief', data: { markdown: '# Hello', client_name: 'Acme' } })
  })

  it('parses multiple events in sequence', async () => {
    const raw = [
      'event: progress\ndata: {"message":"Step 1"}\n\n',
      'event: progress\ndata: {"message":"Step 2"}\n\n',
      'event: brief\ndata: {"markdown":"# Done","client_name":"Acme"}\n\n',
    ].join('')
    const events = await collect(sseStream(URL, BODY, HEADERS, signal(), opts(okFetch(makeStream(raw)))))

    assert.strictEqual(events.length, 3)
    assert.deepStrictEqual(events[0], { type: 'progress', data: { message: 'Step 1' } })
    assert.deepStrictEqual(events[1], { type: 'progress', data: { message: 'Step 2' } })
    assert.strictEqual(events[2].type, 'brief')
  })

  it('handles events split across multiple read() chunks', async () => {
    // Simulate TCP fragmentation by splitting the JSON payload mid-stream
    const events = await collect(sseStream(URL, BODY, HEADERS, signal(), opts(okFetch(
      makeStream('event: progress\ndata: {"mes', 'sage":"Step 1"}\n\n'),
    ))))

    assert.strictEqual(events.length, 1)
    assert.deepStrictEqual(events[0], { type: 'progress', data: { message: 'Step 1' } })
  })

  it('parses a report event with nested meta object', async () => {
    const payload = { markdown: '# Report', meta: { total_flags: 3, evaluation_score: 0.92, iterations: 2 } }
    const raw = `event: report\ndata: ${JSON.stringify(payload)}\n\n`
    const events = await collect(sseStream(URL, BODY, HEADERS, signal(), opts(okFetch(makeStream(raw)))))

    assert.strictEqual(events.length, 1)
    assert.deepStrictEqual(events[0], { type: 'report', data: payload })
  })

  it('parses a thinking event with all fields', async () => {
    const payload = {
      message: 'Fact-check score: 87% — 2 issues found',
      verdict: 'revise',
      score:   0.87,
      issues:  ['Issue A', 'Issue B'],
      missed_signals: ['Signal X'],
      phase: 'evaluate',
    }
    const raw = `event: thinking\ndata: ${JSON.stringify(payload)}\n\n`
    const events = await collect(sseStream(URL, BODY, HEADERS, signal(), opts(okFetch(makeStream(raw)))))

    assert.strictEqual(events.length, 1)
    assert.deepStrictEqual(events[0], { type: 'thinking', data: payload })
  })

  it('parses an error event', async () => {
    const raw = 'event: error\ndata: {"message":"Something went wrong"}\n\n'
    const events = await collect(sseStream(URL, BODY, HEADERS, signal(), opts(okFetch(makeStream(raw)))))

    assert.strictEqual(events.length, 1)
    assert.deepStrictEqual(events[0], { type: 'error', data: { message: 'Something went wrong' } })
  })

  it('yields all event types in a mixed sequence', async () => {
    const raw = [
      'event: progress\ndata: {"message":"Step 1"}\n\n',
      'event: progress\ndata: {"message":"Step 2","phase":"gather"}\n\n',
      'event: thinking\ndata: {"message":"Score 90%","verdict":"pass","score":0.9,"issues":[],"missed_signals":[]}\n\n',
      'event: report\ndata: {"markdown":"# Final","meta":{"total_flags":0,"evaluation_score":0.9,"iterations":1}}\n\n',
    ].join('')
    const events = await collect(sseStream(URL, BODY, HEADERS, signal(), opts(okFetch(makeStream(raw)))))

    assert.strictEqual(events.length, 4)
    assert.deepStrictEqual(events.map((e) => e.type), ['progress', 'progress', 'thinking', 'report'])
  })
})

// ── Error-handling tests ───────────────────────────────────────────────────────

describe('sseStream — error handling', () => {
  it('throws on non-OK HTTP response (401)', async () => {
    await assert.rejects(
      () => collect(sseStream(URL, BODY, HEADERS, signal(), opts(errorFetch(401, 'Unauthorized')))),
      (err) => {
        assert.ok(err.message.includes('HTTP 401'), `Expected "HTTP 401" in: ${err.message}`)
        return true
      },
    )
  })

  it('throws on non-OK HTTP response (500)', async () => {
    await assert.rejects(
      () => collect(sseStream(URL, BODY, HEADERS, signal(), opts(errorFetch(500, 'Internal Server Error')))),
      (err) => {
        assert.ok(err.message.includes('HTTP 500'), `Expected "HTTP 500" in: ${err.message}`)
        return true
      },
    )
  })

  it('warns and skips a malformed JSON line without aborting the stream', async () => {
    const warnCalls = []
    mock.method(console, 'warn', (...args) => { warnCalls.push(args) })

    const raw = [
      'event: progress\ndata: NOT_VALID_JSON\n\n',    // malformed — should be skipped
      'event: brief\ndata: {"markdown":"# OK"}\n\n',  // valid — should be yielded
    ].join('')

    let events
    try {
      events = await collect(sseStream(URL, BODY, HEADERS, signal(), opts(okFetch(makeStream(raw)))))
    } finally {
      console.warn.mock.restore()
    }

    // Warning must mention the malformed line
    const warnMessages = warnCalls.map((args) => args[0])
    assert.ok(
      warnMessages.some((m) => m.includes('[sseStream] malformed JSON')),
      `Expected a warning about malformed JSON. Got: ${JSON.stringify(warnMessages)}`,
    )
    // Stream must continue and yield the valid event
    assert.strictEqual(events.length, 1)
    assert.strictEqual(events[0].type, 'brief')
  })

  it('warns when _inferEventType is used (missing event: field)', async () => {
    const warnCalls = []
    mock.method(console, 'warn', (...args) => { warnCalls.push(args) })

    // No `event:` line — only `data:`
    const raw = 'data: {"markdown":"# Inferred","meta":{"total_flags":0,"evaluation_score":1,"iterations":1}}\n\n'

    let events
    try {
      events = await collect(sseStream(URL, BODY, HEADERS, signal(), opts(okFetch(makeStream(raw)))))
    } finally {
      console.warn.mock.restore()
    }

    const warnMessages = warnCalls.map((args) => args[0])
    assert.ok(
      warnMessages.some((m) => m.includes('_inferEventType')),
      `Expected a warning mentioning _inferEventType. Got: ${JSON.stringify(warnMessages)}`,
    )
    // Inference should still yield the correct type
    assert.strictEqual(events.length, 1)
    assert.strictEqual(events[0].type, 'report')
  })

  it('warns and skips an unrecognisable event (no event: field, inference fails)', async () => {
    const warnCalls = []
    mock.method(console, 'warn', (...args) => { warnCalls.push(args) })

    const raw = 'data: {"unknown_key":"mystery_value"}\n\n'

    let events
    try {
      events = await collect(sseStream(URL, BODY, HEADERS, signal(), opts(okFetch(makeStream(raw)))))
    } finally {
      console.warn.mock.restore()
    }

    const warnMessages = warnCalls.map((args) => args[0])
    assert.ok(
      warnMessages.some((m) => m.includes('unrecognised event')),
      `Expected an "unrecognised event" warning. Got: ${JSON.stringify(warnMessages)}`,
    )
    assert.strictEqual(events.length, 0)
  })

  it('throws a descriptive timeout error when the stream goes silent', async () => {
    // A stream that never emits data and never closes — simulates a hung backend
    const hangingStream = new ReadableStream({ start() {} })

    await assert.rejects(
      () => collect(sseStream(URL, BODY, HEADERS, signal(), {
        fetchFn:   okFetch(hangingStream),
        timeoutMs: 50,  // very short timeout for the test
      })),
      (err) => {
        assert.ok(
          err.message.includes('SSE stream timed out'),
          `Expected timeout error. Got: ${err.message}`,
        )
        return true
      },
    )
  })
})

// ── Fetch integration tests ────────────────────────────────────────────────────

describe('sseStream — fetch integration', () => {
  it('sends the correct method, headers, and JSON body', async () => {
    const raw = 'event: brief\ndata: {"markdown":"# Done"}\n\n'
    const fakeFetch = okFetch(makeStream(raw))

    await collect(sseStream('/api/brief', { prompt: 'test', rm_id: 'RM' }, HEADERS, signal(), opts(fakeFetch)))

    assert.strictEqual(fakeFetch.mock.calls.length, 1)
    const [calledUrl, calledInit] = fakeFetch.mock.calls[0].arguments
    assert.strictEqual(calledUrl, '/api/brief')
    assert.strictEqual(calledInit.method, 'POST')
    assert.strictEqual(calledInit.headers['Content-Type'], 'application/json')
    assert.strictEqual(calledInit.headers['Authorization'], HEADERS.Authorization)
    assert.deepStrictEqual(JSON.parse(calledInit.body), { prompt: 'test', rm_id: 'RM' })
  })
})
