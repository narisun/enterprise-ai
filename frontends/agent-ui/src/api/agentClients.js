/**
 * agentClients.js — per-agent API contracts.
 *
 * Each entry maps an agent ID (matching agents.js) to:
 *   • endpoint       — the backend route that receives the POST request
 *   • buildRequest() — constructs the JSON request body from call parameters
 *
 * ── Separation of concerns ────────────────────────────────────────────────
 * agents.js owns DISPLAY configuration (name, icon, color, template text).
 * agentClients.js owns the API CONTRACT (endpoint, request shape).
 *
 * This split means:
 *   • A backend developer can change a request field without touching the
 *     UI component registry, and vice versa.
 *   • Request shapes are plain functions — trivially unit-testable with no
 *     DOM, no React, and no running server.
 *   • When a new field is needed (e.g. locale, file attachment, API version),
 *     the change lives in one place.
 *
 * ── Adding a new agent ────────────────────────────────────────────────────
 *   1. Add the agent entry to agents.js with comingSoon: false
 *   2. Add an entry here keyed by the same agent id
 *   3. Wire up the FastAPI backend endpoint
 *   4. Add a test case to agentClients.test.js
 *   — No other files need to change —
 */

/**
 * @typedef {object} AgentClient
 * @property {string}   endpoint
 *   Relative URL routed by the Vite dev proxy (e.g. '/api/brief').
 *   In production the nginx config must proxy the same paths.
 * @property {function(string, string, string): object} buildRequest
 *   Pure function that converts (prompt, rmId, sessionId) into the JSON body
 *   expected by the backend endpoint.
 */

/** @type {Record<string, AgentClient>} */
export const agentClients = {
  // ── RM Prep Agent (Alex) — rm-prep-agent:8003 ────────────────────────────
  'rm-prep': {
    endpoint: '/api/brief',
    /**
     * @param {string}      prompt     Natural-language RM request
     * @param {string}      rmId       RM identifier for personalisation and audit
     * @param {string}      sessionId  UUID that ties this call to a LangGraph checkpoint
     * @param {string|null} [jwtToken] Optional test persona JWT (dev/local only).
     *                                 When provided the backend builds fresh MCP bridges
     *                                 carrying that persona's X-Agent-Context header.
     * @returns {{ prompt: string, rm_id: string, session_id: string, jwt_token?: string }}
     */
    buildRequest: (prompt, rmId, sessionId, jwtToken) => ({
      prompt,
      rm_id:      rmId,
      session_id: sessionId,
      ...(jwtToken ? { jwt_token: jwtToken } : {}),
    }),
  },

  // ── Portfolio Watch Agent (Morgan) — portfolio-watch-agent:8004 ──────────
  'portfolio-watch': {
    endpoint: '/api/portfolio-watch',
    /**
     * @param {string} prompt     Scan instruction (optional focus area)
     * @param {string} rmId       RM identifier
     * @param {string} sessionId  UUID for LangGraph session continuity
     * @returns {{ prompt: string, rm_id: string, session_id: string }}
     */
    buildRequest: (prompt, rmId, sessionId) => ({
      prompt,
      rm_id:      rmId,
      session_id: sessionId,
    }),
  },

  // ── Placeholder pattern for coming-soon agents ────────────────────────────
  //
  // When you activate Casey, Jordan, Taylor, etc.:
  //
  // 'credit-review': {
  //   endpoint: '/api/credit-review',
  //   buildRequest: (prompt, rmId, sessionId) => ({ prompt, rm_id: rmId, session_id: sessionId }),
  // },
}

/**
 * Look up the API client for a given agent ID.
 *
 * Throws a descriptive error for unknown IDs so misconfiguration is caught at
 * call time rather than surfacing as a cryptic network failure.
 *
 * @param {string} agentId  Must match an `id` field in agents.js
 * @returns {AgentClient}
 * @throws {Error} When no client is registered for the given ID
 */
export function getAgentClient(agentId) {
  const client = agentClients[agentId]
  if (!client) {
    throw new Error(
      `[agentClients] No API client registered for agent "${agentId}".\n` +
      `Add an entry to src/api/agentClients.js and wire up the backend endpoint.`,
    )
  }
  return client
}
