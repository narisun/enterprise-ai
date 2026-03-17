/**
 * Agent registry — defines every agent the platform exposes.
 *
 * To add a new agent:
 *   1. Append an entry to AGENTS.
 *   2. Set `endpoint` to the FastAPI route (relative, proxied via /api).
 *   3. Define the prompt `template` and its `variables`.
 *   4. List `progressSteps` so the execution rail can show expected stages
 *      even before the first SSE event arrives.
 */

export const AGENTS = [
  {
    id: 'rm-prep',
    name: 'RM Prep Agent',
    tagline: 'Meeting briefs for Relationship Managers',
    description:
      'Pulls live data from Salesforce CRM, the payments system, and recent news to generate a comprehensive pre-meeting brief in seconds.',
    icon: '📋',
    color: 'blue',           // drives accent colour throughout the UI
    endpoint: '/api/brief',  // proxied → rm-prep-agent:8003/brief
    requestShape: (prompt, rmId, sessionId) => ({
      prompt,
      rm_id: rmId,
      session_id: sessionId,
    }),

    // Prompt template — {{ variable }} tokens are replaced by PromptBuilder
    template: {
      text: 'Prepare a full meeting brief for customer {{customer_name}}',
      variables: [
        {
          key: 'customer_name',
          label: 'Customer / Company Name',
          placeholder: 'e.g. Acme Manufacturing',
          required: true,
        },
      ],
      // Extra free-text addenda the RM can add (appended to the prompt)
      addendumLabel: 'Additional context (optional)',
      addendumPlaceholder:
        'e.g. Focus on their recent expansion into Asia-Pacific, upcoming renewal in Q3…',
    },

    dataSources: [
      { label: 'Salesforce CRM',   icon: '🏢' },
      { label: 'Payments System',  icon: '💰' },
      { label: 'Internet News',    icon: '📰' },
    ],

    // Shown in the execution rail before/during streaming.
    // Order should mirror the LangGraph pipeline stages.
    progressSteps: [
      'Identifying client…',
      'Planning data retrieval…',
      'Fetching CRM relationship data…',
      'Analysing payment trends…',
      'Searching latest news…',
      'Generating your brief…',
    ],

    // Suggested follow-up prompts shown after the brief is rendered
    followUps: [
      'Summarise the key risks in two bullet points',
      'Add a recommended talking-points section',
      'Translate the executive summary into formal email language',
      'What are the top three opportunities to discuss?',
    ],
  },

  // ── Future agents go here ────────────────────────────────────────────────
  // {
  //   id: 'credit-review',
  //   name: 'Credit Review Agent',
  //   ...
  // },
]

/** Quick lookup by ID */
export const getAgent = (id) => AGENTS.find((a) => a.id === id) ?? null
