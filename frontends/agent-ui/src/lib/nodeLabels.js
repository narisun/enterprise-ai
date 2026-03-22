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
