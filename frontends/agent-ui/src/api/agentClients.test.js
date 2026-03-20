/**
 * agentClients.test.js
 *
 * Verifies that every registered agent client:
 *   • Points at the correct backend endpoint
 *   • Builds a request body whose shape matches what the FastAPI handler expects
 *   • Is discoverable via getAgentClient()
 *
 * These tests act as a living contract between the frontend and the backend
 * Pydantic request models.  A backend field rename should cause a test failure
 * here before the breakage reaches staging.
 *
 * Run with: node --test src/api/agentClients.test.js
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { agentClients, getAgentClient } from './agentClients.js'

// Shared fixture values used across all buildRequest() tests
const PROMPT     = 'Prepare a brief for Acme Manufacturing'
const RM_ID      = 'RM-007'
const SESSION_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

// ── rm-prep (Alex) ────────────────────────────────────────────────────────────

describe('agentClients["rm-prep"]', () => {
  const client = agentClients['rm-prep']

  it('is registered', () => {
    assert.ok(client !== undefined, 'rm-prep client must be registered')
  })

  it('endpoint matches the Vite proxy route for rm-prep-agent', () => {
    // Vite dev server proxies /api/* → rm-prep-agent:8003
    // FastAPI handler is POST /brief (proxied from /api/brief)
    assert.strictEqual(client.endpoint, '/api/brief')
  })

  it('buildRequest returns all required fields with correct names', () => {
    const body = client.buildRequest(PROMPT, RM_ID, SESSION_ID)

    // Must match the BriefRequest Pydantic model: prompt, rm_id, session_id
    assert.deepStrictEqual(body, {
      prompt:     PROMPT,
      rm_id:      RM_ID,
      session_id: SESSION_ID,
    })
  })

  it('buildRequest uses snake_case field names (guards against camelCase regressions)', () => {
    const body = client.buildRequest(PROMPT, RM_ID, SESSION_ID)
    // If someone accidentally uses rmId or sessionId, this test catches it
    assert.ok(!('rmId'      in body), 'body must not contain camelCase "rmId"')
    assert.ok(!('sessionId' in body), 'body must not contain camelCase "sessionId"')
  })

  it('buildRequest passes the prompt through unchanged', () => {
    const longPrompt = 'Prepare a full brief for Acme Manufacturing including risk flags and recent news'
    const body = client.buildRequest(longPrompt, RM_ID, SESSION_ID)
    assert.strictEqual(body.prompt, longPrompt)
  })
})

// ── portfolio-watch (Morgan) ───────────────────────────────────────────────────

describe('agentClients["portfolio-watch"]', () => {
  const client = agentClients['portfolio-watch']

  it('is registered', () => {
    assert.ok(client !== undefined, 'portfolio-watch client must be registered')
  })

  it('endpoint matches the Vite proxy route for portfolio-watch-agent', () => {
    // Vite dev server has a specific rule:
    //   '/api/portfolio-watch' → portfolio-watch-agent:8004
    // FastAPI handler is POST /portfolio-watch (proxied from /api/portfolio-watch)
    assert.strictEqual(client.endpoint, '/api/portfolio-watch')
  })

  it('buildRequest returns all required fields with correct names', () => {
    const body = client.buildRequest(PROMPT, RM_ID, SESSION_ID)

    // Must match the WatchRequest Pydantic model: prompt, rm_id, session_id
    assert.deepStrictEqual(body, {
      prompt:     PROMPT,
      rm_id:      RM_ID,
      session_id: SESSION_ID,
    })
  })

  it('buildRequest uses snake_case field names', () => {
    const body = client.buildRequest(PROMPT, RM_ID, SESSION_ID)
    assert.ok(!('rmId'      in body), 'body must not contain camelCase "rmId"')
    assert.ok(!('sessionId' in body), 'body must not contain camelCase "sessionId"')
  })
})

// ── getAgentClient() ──────────────────────────────────────────────────────────

describe('getAgentClient()', () => {
  it('returns the correct client for "rm-prep"', () => {
    assert.strictEqual(getAgentClient('rm-prep'), agentClients['rm-prep'])
  })

  it('returns the correct client for "portfolio-watch"', () => {
    assert.strictEqual(getAgentClient('portfolio-watch'), agentClients['portfolio-watch'])
  })

  it('throws a descriptive error for an unknown agent ID', () => {
    assert.throws(
      () => getAgentClient('nonexistent-agent'),
      (err) => {
        assert.ok(
          err.message.includes('No API client registered for agent "nonexistent-agent"'),
          `Error message should name the missing agent. Got: ${err.message}`,
        )
        return true
      },
    )
  })

  it('error message includes the missing agent ID', () => {
    assert.throws(
      () => getAgentClient('credit-review'),
      (err) => {
        assert.ok(err.message.includes('credit-review'), `Missing agent ID in error: ${err.message}`)
        return true
      },
    )
  })

  it('error message mentions agentClients.js so developers know where to add entries', () => {
    assert.throws(
      () => getAgentClient('aml-triage'),
      (err) => {
        assert.ok(err.message.includes('agentClients.js'), `Error should mention agentClients.js. Got: ${err.message}`)
        return true
      },
    )
  })
})

// ── Registry completeness ─────────────────────────────────────────────────────

describe('agentClients registry — structural invariants', () => {
  it('every registered client has an endpoint string starting with /', () => {
    for (const [id, client] of Object.entries(agentClients)) {
      assert.strictEqual(typeof client.endpoint, 'string',  `${id}.endpoint must be a string`)
      assert.ok(client.endpoint.startsWith('/'), `${id}.endpoint must start with /`)
    }
  })

  it('every registered client has a buildRequest function', () => {
    for (const [id, client] of Object.entries(agentClients)) {
      assert.strictEqual(typeof client.buildRequest, 'function', `${id}.buildRequest must be a function`)
    }
  })

  it('every buildRequest returns a plain object', () => {
    for (const [id, client] of Object.entries(agentClients)) {
      const result = client.buildRequest('p', 'r', 's')
      assert.strictEqual(typeof result, 'object', `${id}.buildRequest() must return an object`)
      assert.ok(result !== null,                  `${id}.buildRequest() must not return null`)
    }
  })

  it('no two clients share the same endpoint', () => {
    const endpoints = Object.values(agentClients).map((c) => c.endpoint)
    const unique = new Set(endpoints)
    assert.strictEqual(
      endpoints.length,
      unique.size,
      `Duplicate endpoints detected: ${endpoints.join(', ')}`,
    )
  })
})
