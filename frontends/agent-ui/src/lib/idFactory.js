/**
 * idFactory.js — Deterministic ID generation for timeline entries.
 *
 * Replaces the Date.now() + Math.random() pattern used throughout
 * useAgentStream. Provides:
 *   • Unique, monotonically increasing IDs within a session
 *   • Deterministic output when seeded (for testing)
 *   • No collision risk regardless of timing
 *
 * @module lib/idFactory
 */

let _counter = 0

/**
 * Generate a unique ID with an optional prefix.
 * IDs are monotonically increasing within the session.
 *
 * @param {string} [prefix='id'] — Prefix for readability in DevTools
 * @returns {string} e.g. "step-1", "tool-42"
 */
export function nextId(prefix = 'id') {
  return `${prefix}-${++_counter}`
}

/**
 * Reset the counter. Used in tests for deterministic assertions.
 * @param {number} [value=0]
 */
export function resetIdCounter(value = 0) {
  _counter = value
}
