/**
 * Digital Worker Registry
 *
 * Each entry represents one AI digital worker. Workers that are live have a
 * full implementation config (endpoint, template, progressSteps, followUps).
 * Workers under development are marked comingSoon: true and omit those fields —
 * they will be filled in as each agent is built.
 *
 * To activate a new worker:
 *   1. Set comingSoon: false
 *   2. Add endpoint, requestShape, template, progressSteps, followUps
 *   3. Wire up the FastAPI backend service
 */

export const AGENTS = [

  // ── Relationship Banking ────────────────────────────────────────────────────

  {
    id: 'rm-prep',
    workerName: 'Alex',
    workerRole: 'Relationship Intelligence Associate',
    department: 'Relationship Banking',
    tagline: 'Pre-meeting briefs & client intelligence',
    description:
      'Pulls live data from Salesforce CRM, the payments system, and recent news to generate a comprehensive pre-meeting brief in seconds.',
    icon: '🤝',
    color: 'blue',
    comingSoon: false,

    endpoint: '/api/brief',
    requestShape: (prompt, rmId, sessionId) => ({
      prompt,
      rm_id: rmId,
      session_id: sessionId,
    }),
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
      addendumLabel: 'Additional context (optional)',
      addendumPlaceholder:
        'e.g. Focus on their recent expansion into Asia-Pacific, upcoming renewal in Q3…',
    },
    dataSources: [
      { label: 'Salesforce CRM',  icon: '🏢' },
      { label: 'Payments System', icon: '💰' },
      { label: 'Internet News',   icon: '📰' },
    ],
    progressSteps: [
      'Identifying client…',
      'Planning data retrieval…',
      'Fetching CRM relationship data…',
      'Analysing payment trends…',
      'Searching latest news…',
      'Generating your brief…',
    ],
    followUps: [
      'Summarise the key risks in two bullet points',
      'Add a recommended talking-points section',
      'Translate the executive summary into formal email language',
      'What are the top three opportunities to discuss?',
    ],
  },

  {
    id: 'portfolio-watch',
    workerName: 'Morgan',
    workerRole: 'Portfolio Watch Officer',
    department: 'Relationship Banking',
    tagline: 'On-demand book monitoring & risk verification',
    description:
      'Scans your entire client book on demand — surfaces payment stress, covenant breaches, credit score deterioration, and adverse news. Every risk flag is independently fact-checked before publishing.',
    icon: '📊',
    color: 'emerald',
    comingSoon: false,

    endpoint: '/api/portfolio-watch',
    requestShape: (prompt, rmId, sessionId) => ({
      prompt,
      rm_id: rmId,
      session_id: sessionId,
    }),
    template: {
      text: 'Run a portfolio watch scan for my book',
      variables: [],
      addendumLabel: 'Focus area (optional)',
      addendumPlaceholder:
        'e.g. Focus on credit risk and any payment stress signals…',
    },
    dataSources: [
      { label: 'CRM / Client Book',   icon: '🏢' },
      { label: 'Payments System',     icon: '💰' },
      { label: 'Credit Intelligence', icon: '📈' },
      { label: 'News & Events',       icon: '📰' },
    ],
    progressSteps: [
      'Loading your portfolio…',
      'Gathering payment, credit & news signals…',
      'Morgan is drafting the portfolio narrative…',
      'Fact-checking every claim against source data…',
      'Finalising the verified report…',
    ],
    followUps: [
      'Which client needs the most urgent attention this week?',
      'Summarise the credit risk exposure across the book',
      'Draft a call agenda for the highest-risk client',
      'What actions should I take before end of week?',
    ],
  },

  // ── Credit & Risk ───────────────────────────────────────────────────────────

  {
    id: 'credit-review',
    workerName: 'Casey',
    workerRole: 'Credit Desk Analyst',
    department: 'Credit & Risk',
    tagline: 'Credit memos, covenants & ratio analysis',
    description:
      'Ingests financial statements, cross-references repayment history, tracks covenant compliance, and produces a structured credit memo with key ratio trends and red flags — ready for credit committee.',
    icon: '📑',
    color: 'violet',
    comingSoon: true,
    dataSources: [
      { label: 'Credit System',   icon: '🏦' },
      { label: 'Payments System', icon: '💰' },
      { label: 'Financial Docs',  icon: '📄' },
    ],
  },

  {
    id: 'aml-triage',
    workerName: 'Jordan',
    workerRole: 'AML Triage Specialist',
    department: 'Credit & Risk',
    tagline: 'Alert review & escalation recommendations',
    description:
      'Takes a transaction monitoring alert, pulls the full transaction chain, cross-references the customer CRM profile and historical pattern, checks sanctions lists and adverse news, and returns a structured triage recommendation with a full reasoning trail.',
    icon: '🔍',
    color: 'rose',
    comingSoon: true,
    dataSources: [
      { label: 'Transaction Monitor', icon: '⚡' },
      { label: 'Sanctions Lists',     icon: '🛡️' },
      { label: 'Salesforce CRM',      icon: '🏢' },
      { label: 'Adverse News',        icon: '📰' },
    ],
  },

  // ── Trade & Operations ──────────────────────────────────────────────────────

  {
    id: 'trade-finance',
    workerName: 'Taylor',
    workerRole: 'Trade Finance Checker',
    department: 'Trade & Operations',
    tagline: 'LC document discrepancy review',
    description:
      'Accepts uploaded trade documents, extracts key fields, cross-checks them against letter of credit terms, and returns a precise discrepancy report with specific clause references — eliminating costly manual checking.',
    icon: '🚢',
    color: 'orange',
    comingSoon: true,
    dataSources: [
      { label: 'Trade System',   icon: '📦' },
      { label: 'Document Store', icon: '📄' },
      { label: 'LC Registry',    icon: '📋' },
    ],
  },

  {
    id: 'kyc-onboarding',
    workerName: 'Avery',
    workerRole: 'KYC & Onboarding Coordinator',
    department: 'Trade & Operations',
    tagline: 'UBO checks, sanctions screening & risk narrative',
    description:
      'Orchestrates the KYC refresh workflow — identifies outstanding documents, pulls existing records, runs UBO and sanctions checks, screens adverse news, and drafts the risk narrative with human checkpoints at appropriate stages.',
    icon: '🪪',
    color: 'amber',
    comingSoon: true,
    dataSources: [
      { label: 'KYC System',      icon: '🗂️' },
      { label: 'Sanctions Lists', icon: '🛡️' },
      { label: 'Companies House', icon: '🏛️' },
      { label: 'Adverse News',    icon: '📰' },
    ],
  },

  // ── Treasury & Markets ──────────────────────────────────────────────────────

  {
    id: 'treasury-advisory',
    workerName: 'Riley',
    workerRole: 'Treasury Advisory Associate',
    department: 'Treasury & Markets',
    tagline: 'FX hedge book, rates context & client guides',
    description:
      'Pulls the client\'s existing hedge book, current mark-to-market, upcoming maturity schedule, and live rates context, then generates a structured conversation guide with specific product recommendations for treasury sales calls.',
    icon: '💹',
    color: 'teal',
    comingSoon: true,
    dataSources: [
      { label: 'Treasury System', icon: '💱' },
      { label: 'Rates Feed',      icon: '📈' },
      { label: 'Salesforce CRM',  icon: '🏢' },
    ],
  },

  // ── Finance & Compliance ────────────────────────────────────────────────────

  {
    id: 'regulatory-reporting',
    workerName: 'Quinn',
    workerRole: 'Regulatory Reporting Analyst',
    department: 'Finance & Compliance',
    tagline: 'COREP / FINREP / LCR data pulls & variance commentary',
    description:
      'Handles specific regulatory report sections — pulls relevant positions, applies haircuts and weightings, and produces a pre-populated return with variance commentary versus the prior period, ready for sign-off.',
    icon: '📜',
    color: 'indigo',
    comingSoon: true,
    dataSources: [
      { label: 'GL / Finance System', icon: '🏦' },
      { label: 'Risk Data Mart',      icon: '📊' },
      { label: 'Regulatory Rules',    icon: '⚖️' },
    ],
  },

]

/** Quick lookup by ID */
export const getAgent = (id) => AGENTS.find((a) => a.id === id) ?? null

/** All departments in display order */
export const DEPARTMENTS = [
  'Relationship Banking',
  'Credit & Risk',
  'Trade & Operations',
  'Treasury & Markets',
  'Finance & Compliance',
]

/** Workers grouped by department */
export const byDepartment = () =>
  DEPARTMENTS.reduce((acc, dept) => {
    const workers = AGENTS.filter((a) => a.department === dept)
    if (workers.length) acc[dept] = workers
    return acc
  }, {})
