/**
 * intentRouter.js — Client-side intent detection for automatic agent selection.
 *
 * Analyses the user's natural-language message and returns the most appropriate
 * agent ID. This is a lightweight keyword/pattern matcher — not an LLM call.
 * When a top-level orchestrator agent exists on the backend, this will be
 * replaced by a server-side routing call.
 *
 * @module lib/intentRouter
 */

import { AGENTS } from '../config/agents.js'

/**
 * Intent patterns for each agent. Ordered by specificity — first match wins.
 * Each pattern has a set of keywords/phrases that suggest the user wants
 * that particular agent.
 */
const INTENT_PATTERNS = [
  {
    agentId: 'rm-prep',
    // Meeting prep, client briefs, CRM-related requests
    patterns: [
      /\b(meeting|brief|prep|prepare)\b/i,
      /\b(client|customer|account)\s+(meeting|brief|review|summary|intelligence)/i,
      /\b(crm|salesforce)\b/i,
      /\bmeeting\s+(with|for|about)\b/i,
      /\bprepare\s+(me|a|the|for)\b/i,
      /\b(talking[\s-]?points?|agenda)\b/i,
      /\bclient\s+intel/i,
    ],
    // Boost score if these words appear
    boostWords: ['meeting', 'brief', 'prepare', 'client', 'customer', 'crm'],
  },
  {
    agentId: 'portfolio-watch',
    // Portfolio monitoring, risk scanning, book-level analysis
    patterns: [
      /\b(portfolio|book)\s*(watch|scan|review|monitor|risk|analysis)/i,
      /\b(risk|alert|flag|stress|covenant|breach)\b/i,
      /\bscan\s+(my|the|for)\b/i,
      /\bportfolio\b/i,
      /\b(watch|monitor)\s+(my|the)\s+(book|portfolio|clients?)/i,
      /\b(payment\s+stress|credit\s+(risk|score|deteriorat))/i,
      /\badverse\s+news\b/i,
    ],
    boostWords: ['portfolio', 'risk', 'scan', 'watch', 'book', 'alert', 'flag'],
  },
]

/**
 * Score a message against an intent pattern set.
 * Returns a confidence score between 0 and 1.
 *
 * @param {string} message - User's input text
 * @param {object} intent  - Intent pattern config
 * @returns {number} Confidence score 0–1
 */
function scoreIntent(message, intent) {
  let score = 0
  const lower = message.toLowerCase()

  // Pattern matches (strongest signal)
  for (const pattern of intent.patterns) {
    if (pattern.test(message)) {
      score += 0.3
    }
  }

  // Boost word matches (weaker signal)
  for (const word of intent.boostWords) {
    if (lower.includes(word)) {
      score += 0.1
    }
  }

  return Math.min(score, 1.0)
}

/**
 * Detect which agent should handle a user message.
 *
 * @param {string} message - The user's natural-language input
 * @returns {{ agentId: string, confidence: number } | null}
 *   Returns the best matching agent with confidence, or null if
 *   no agent scores above the minimum threshold.
 */
export function detectIntent(message) {
  if (!message || message.trim().length < 3) return null

  const THRESHOLD = 0.2 // Minimum confidence to auto-route

  let best = null
  let bestScore = 0

  for (const intent of INTENT_PATTERNS) {
    const score = scoreIntent(message, intent)
    if (score > bestScore && score >= THRESHOLD) {
      bestScore = score
      best = { agentId: intent.agentId, confidence: score }
    }
  }

  return best
}

/**
 * Get the agent config object for a detected intent.
 *
 * @param {string} message - User's input text
 * @returns {{ agent: object, confidence: number } | null}
 */
export function routeToAgent(message) {
  const intent = detectIntent(message)
  if (!intent) return null

  const agent = AGENTS.find((a) => a.id === intent.agentId && !a.comingSoon)
  if (!agent) return null

  return { agent, confidence: intent.confidence }
}
