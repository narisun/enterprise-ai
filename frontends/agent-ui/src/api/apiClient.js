/**
 * apiClient.js — centralised HTTP client for all agent API calls.
 *
 * ── Responsibilities ──────────────────────────────────────────────────────
 *   1. Read VITE_API_KEY exactly once at module load time
 *   2. Validate it and emit a clear startup warning when it is missing
 *   3. Expose buildHeaders() so any caller can get the right auth headers
 *      without knowing about the env var
 *
 * ── What this is NOT ──────────────────────────────────────────────────────
 *   • It does NOT make fetch calls directly — that is sseStream's job
 *   • It does NOT manage React state
 *   • It does NOT know about individual agents — that is agentClients.js
 *
 * ── Future extension points ───────────────────────────────────────────────
 *   • Token refresh: update _apiKey and re-export buildHeaders()
 *   • Per-environment base URLs: read VITE_API_BASE_URL here
 *   • JWT handling: swap Bearer API key for a short-lived JWT token
 *   • Request signing / HMAC: centralised in buildHeaders()
 */

const _apiKey = import.meta.env.VITE_API_KEY ?? ''

// ── Startup validation ────────────────────────────────────────────────────────
//
// Fail loudly in production so a misconfigured deployment is immediately
// obvious rather than silently returning 401s.
//
// In development, demote to a warning so the dev server still starts and
// the developer sees a clear message in the console.
if (!_apiKey) {
  const msg =
    '[apiClient] VITE_API_KEY is not set.\n' +
    'Add it to your .env file and restart the dev server:\n\n' +
    '  VITE_API_KEY=your-internal-api-key\n\n' +
    'The backend will return 401 Unauthorized on every request until this is set.'

  if (import.meta.env.PROD) {
    // In CI / production builds, throw so the bundle fails visibly rather than
    // shipping a broken app.
    throw new Error(msg)
  } else {
    // In development, warn and continue — the developer likely hasn't created
    // .env yet.
    console.warn(msg)
  }
}

/**
 * Build the standard HTTP headers used by all agent API calls.
 *
 * Returns a plain object so it can be spread into any fetch init or passed
 * to sseStream's `headers` parameter.
 *
 * @returns {Record<string, string>}
 */
export function buildHeaders() {
  return {
    'Content-Type': 'application/json',
    ...(_apiKey ? { Authorization: `Bearer ${_apiKey}` } : {}),
  }
}

/**
 * Fetch a signed JWT for a named test persona from the rm-prep-agent.
 *
 * Only available in local/dev environments — the backend returns 403 in
 * production.  The JWT is signed with JWT_SECRET and carries the persona's
 * role, assigned_account_ids, and compliance_clearance claims.
 *
 * @param {string} persona  One of: manager | senior_rm | rm | readonly
 * @param {string} [baseUrl='/api']  Override the agent base URL (default: Vite proxy)
 * @returns {Promise<{ access_token: string, role: string, description: string }>}
 * @throws {Error} On 4xx/5xx or network failure
 */
export async function fetchPersonaToken(persona, baseUrl = '/api') {
  const resp = await fetch(`${baseUrl}/auth/token`, {
    method:  'POST',
    headers: buildHeaders(),
    body:    JSON.stringify({ persona, expires_in: 3600 }),
  })
  if (!resp.ok) {
    const detail = await resp.text().catch(() => resp.statusText)
    throw new Error(`[fetchPersonaToken] ${resp.status}: ${detail}`)
  }
  return resp.json()
}

/**
 * List available test personas from the rm-prep-agent.
 *
 * @param {string} [baseUrl='/api']
 * @returns {Promise<Array<{ name: string, role: string, description: string }>>}
 */
export async function fetchPersonas(baseUrl = '/api') {
  const resp = await fetch(`${baseUrl}/auth/personas`, {
    headers: buildHeaders(),
  })
  if (!resp.ok) throw new Error(`[fetchPersonas] ${resp.status}`)
  return resp.json()
}
