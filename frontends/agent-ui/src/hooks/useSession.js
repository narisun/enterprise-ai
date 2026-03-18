/**
 * useSession.js — stable session ID management.
 *
 * ── Why a dedicated hook? ────────────────────────────────────────────────
 * Previously, App.jsx generated a UUID with useState(() => uuidv4()) and
 * threaded it as a prop through multiple components.  This approach:
 *   • Loses the session ID on every hot-reload (breaks multi-turn dev flows)
 *   • Scatters session-generation logic across App.jsx
 *   • Makes it hard to test session reset behaviour in isolation
 *
 * This hook centralises all session concerns in one testable unit.
 *
 * ── Storage strategy ──────────────────────────────────────────────────────
 * sessionStorage is intentionally chosen over localStorage:
 *   • Tab-scoped — each browser tab gets its own session, matching
 *     LangGraph's MemorySaver per-session-id model
 *   • Survives hot-reloads — the session persists across Vite HMR refreshes
 *     so multi-turn development flows work without re-running the agent
 *   • Cleared on tab close — sessions don't accumulate across days
 *
 * ── sessionStorage unavailability ────────────────────────────────────────
 * sessionStorage can be unavailable in:
 *   • Private / Incognito mode on some browsers
 *   • Embedded iframes with restrictive CSP headers
 * All read/write calls are wrapped in try/catch so the hook degrades
 * gracefully to in-memory-only session IDs in those environments.
 */

import { useState, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'

const STORAGE_KEY = 'enterprise-ai:session-id'

/** Read the persisted session ID, or create a new one if none exists. */
function readOrCreate() {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY)
    if (stored) return stored
  } catch {
    // sessionStorage unavailable — fall through to generate a fresh UUID
  }
  return uuidv4()
}

/** Persist a session ID; silently skips if sessionStorage is unavailable. */
function persist(id) {
  try {
    sessionStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Swallow — session still functions, just won't survive a page reload
  }
}

/**
 * Stable session ID for the current browser tab.
 *
 * @returns {{ sessionId: string, newSession: () => string }}
 *   sessionId   — stable UUID string (persisted in sessionStorage)
 *   newSession  — generate a new UUID, persist it, update state, return it
 */
export function useSession() {
  const [sessionId, setSessionId] = useState(() => {
    const id = readOrCreate()
    persist(id)
    return id
  })

  const newSession = useCallback(() => {
    const id = uuidv4()
    persist(id)
    setSessionId(id)
    return id
  }, [])

  return { sessionId, newSession }
}
