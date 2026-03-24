/**
 * nodeLabels.js — Human-readable labels for agent pipeline node names.
 *
 * Shared between ThinkingBlock and any future component that needs
 * to display node-level activity in a user-friendly way.
 *
 * @module lib/nodeLabels
 */

export const NODE_LABELS = {
  // RM Prep outer orchestrator nodes
  parse_intent:       'Parsing intent',
  route:              'Routing',
  gather_crm:         'CRM specialist',
  gather_payments:    'Payments specialist',
  gather_news:        'News specialist',
  synthesize:         'Synthesizing brief',
  format_brief:       'Formatting brief',
  // Portfolio Watch nodes
  gather_portfolio:   'Portfolio data',
  gather_signals:     'Signal analysis',
  generate_narrative: 'Generating narrative',
  evaluate_narrative: 'Evaluating narrative',
  format_report:      'Formatting report',
  // Inner ReAct agent nodes (from build_specialist_agent)
  agent:              'Agent reasoning',
  tools:              'Running tools',
}

/**
 * Human-readable labels for MCP tool names.
 * Maps raw tool identifiers to friendly descriptions shown in the UI.
 */
export const TOOL_LABELS = {
  get_salesforce_summary:  'Looking up CRM account',
  get_crm_relationships:   'Fetching CRM relationships',
  get_crm_activities:      'Fetching recent activities',
  get_crm_opportunities:   'Fetching opportunities',
  get_payment_summary:     'Analysing payment trends',
  get_payment_details:     'Fetching payment details',
  search_company_news:     'Searching company news',
  get_portfolio_positions: 'Fetching portfolio data',
  get_market_signals:      'Scanning market signals',
  get_risk_metrics:        'Calculating risk metrics',
}

/**
 * Get a human-readable label for a tool name.
 * Falls back to a cleaned-up version of the raw name.
 */
export function getToolLabel(toolName) {
  if (TOOL_LABELS[toolName]) return TOOL_LABELS[toolName]
  // Fallback: convert snake_case to Title Case
  return toolName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
