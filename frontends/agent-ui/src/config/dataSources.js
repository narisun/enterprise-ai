/**
 * dataSources.js — Data source registry for the Meridian platform.
 *
 * Each entry describes a data source that agents can access via MCP tool servers:
 *   • id          — unique key, referenced by agents.js dataSources[].sourceId
 *   • label       — display name matching what appears on agent cards
 *   • icon        — emoji icon
 *   • status      — 'live' | 'coming-soon'
 *   • mcpServer   — the MCP server that exposes this source
 *   • port        — container port for the MCP server
 *   • transport   — 'SSE' | 'stdio'
 *   • description — one-paragraph overview
 *   • accessNote  — OPA / RBAC note
 *   • schema      — array of table definitions (live sources only)
 *   • usedBy      — agent IDs that reference this source
 *
 * Schema column flags:
 *   • opaMasked   — column is redacted or masked by OPA policy at runtime
 *   • sensitive   — PII / AML / compliance field requiring clearance
 */

/** @type {Record<string, DataSource>} */
export const DATA_SOURCES = {

  // ── Salesforce CRM ─────────────────────────────────────────────────────────
  'salesforce-crm': {
    id: 'salesforce-crm',
    label: 'Salesforce CRM',
    icon: '🏢',
    status: 'live',
    mcpServer: 'salesforce-mcp',
    port: 8081,
    transport: 'SSE',
    description:
      'Salesforce CRM is the system of record for client relationships. ' +
      'It holds accounts, contacts, opportunities, contracts, tasks, events, ' +
      'and cases. The Meridian platform accesses it read-only via the ' +
      'salesforce-mcp server, which enforces row-level filtering so each RM ' +
      'only sees accounts in their assigned book.',
    accessNote:
      'OPA policy rm_prep_authz.rego applies account-level row filters ' +
      'based on the AgentContext assigned_account_ids claim. Contacts, ' +
      'opportunities, and contracts are accessible to any RM with CRM tool ' +
      'clearance (compliance_clearance ≥ standard).',
    usedBy: ['rm-prep', 'aml-triage', 'treasury-advisory'],
    schema: [
      {
        name: 'salesforce.Account',
        description: 'Top-level client entity — companies and individuals managed by the bank.',
        columns: [
          { name: 'Id',                   type: 'VARCHAR(18)',   description: 'Salesforce record ID (primary key)' },
          { name: 'Name',                  type: 'VARCHAR(255)',  description: 'Legal entity or trading name' },
          { name: 'Type',                  type: 'VARCHAR(50)',   description: 'Account type: Corporate, SME, Individual, etc.' },
          { name: 'Industry',              type: 'VARCHAR(100)',  description: 'Sector classification' },
          { name: 'AnnualRevenue',         type: 'NUMERIC(18,2)', description: 'Annual revenue in USD' },
          { name: 'NumberOfEmployees',     type: 'INTEGER',       description: 'Headcount' },
          { name: 'BillingCity',           type: 'VARCHAR(100)',  description: 'Primary billing city' },
          { name: 'BillingCountry',        type: 'VARCHAR(100)',  description: 'Primary billing country' },
          { name: 'Phone',                 type: 'VARCHAR(40)',   description: 'Main switchboard number' },
          { name: 'Website',               type: 'VARCHAR(255)',  description: 'Primary web presence' },
          { name: 'OwnerId',               type: 'VARCHAR(18)',   description: 'Salesforce User ID of the assigned RM' },
          { name: 'RatingClass',           type: 'VARCHAR(20)',   description: 'Internal client tier: Platinum, Gold, Silver' },
          { name: 'RelationshipStartDate', type: 'DATE',          description: 'Date the banking relationship began' },
          { name: 'CreatedDate',           type: 'TIMESTAMPTZ',   description: 'Record creation timestamp' },
          { name: 'LastModifiedDate',      type: 'TIMESTAMPTZ',   description: 'Last update timestamp' },
        ],
      },
      {
        name: 'salesforce.Contact',
        description: 'Individual people linked to an Account — signatories, decision-makers, and stakeholders.',
        columns: [
          { name: 'Id',         type: 'VARCHAR(18)',  description: 'Salesforce record ID' },
          { name: 'AccountId',  type: 'VARCHAR(18)',  description: 'Foreign key → salesforce.Account' },
          { name: 'FirstName',  type: 'VARCHAR(80)',  description: 'Given name' },
          { name: 'LastName',   type: 'VARCHAR(80)',  description: 'Family name' },
          { name: 'Title',      type: 'VARCHAR(128)', description: 'Job title / designation' },
          { name: 'Email',      type: 'VARCHAR(255)', description: 'Business email address', sensitive: true },
          { name: 'Phone',      type: 'VARCHAR(40)',  description: 'Direct line', sensitive: true },
          { name: 'Department', type: 'VARCHAR(80)',  description: 'Business unit within the account' },
          { name: 'IsPrimary',  type: 'BOOLEAN',      description: 'True if this is the primary relationship contact' },
          { name: 'CreatedDate',type: 'TIMESTAMPTZ',  description: 'Record creation timestamp' },
        ],
      },
      {
        name: 'salesforce.Opportunity',
        description: 'Revenue opportunities and deals in progress for each account.',
        columns: [
          { name: 'Id',          type: 'VARCHAR(18)',   description: 'Salesforce record ID' },
          { name: 'AccountId',   type: 'VARCHAR(18)',   description: 'Foreign key → salesforce.Account' },
          { name: 'Name',        type: 'VARCHAR(120)',  description: 'Opportunity name / deal title' },
          { name: 'StageName',   type: 'VARCHAR(40)',   description: 'Pipeline stage: Prospecting, Proposal, Negotiation, Closed Won/Lost' },
          { name: 'Amount',      type: 'NUMERIC(18,2)', description: 'Expected deal value in USD' },
          { name: 'CloseDate',   type: 'DATE',          description: 'Forecast close date' },
          { name: 'Probability', type: 'NUMERIC(5,2)',  description: 'Win probability (0–100)' },
          { name: 'OwnerId',     type: 'VARCHAR(18)',   description: 'Assigned RM User ID' },
          { name: 'ProductLine', type: 'VARCHAR(80)',   description: 'Banking product category' },
          { name: 'CreatedDate', type: 'TIMESTAMPTZ',  description: 'Record creation timestamp' },
        ],
      },
      {
        name: 'salesforce.Contract',
        description: 'Executed banking agreements and facilities linked to an account.',
        columns: [
          { name: 'Id',             type: 'VARCHAR(18)',   description: 'Salesforce record ID' },
          { name: 'AccountId',      type: 'VARCHAR(18)',   description: 'Foreign key → salesforce.Account' },
          { name: 'ContractNumber', type: 'VARCHAR(30)',   description: 'Internal contract reference' },
          { name: 'Status',         type: 'VARCHAR(20)',   description: 'Draft, Activated, Expired' },
          { name: 'StartDate',      type: 'DATE',          description: 'Contract effective date' },
          { name: 'EndDate',        type: 'DATE',          description: 'Contract expiry date' },
          { name: 'FacilityType',   type: 'VARCHAR(80)',   description: 'Product type: Term Loan, Revolving, LC, etc.' },
          { name: 'FacilityAmount', type: 'NUMERIC(18,2)', description: 'Committed facility amount in USD' },
          { name: 'InterestRate',   type: 'NUMERIC(8,4)',  description: 'Contracted interest rate (annualised)' },
          { name: 'Covenants',      type: 'JSONB',         description: 'Structured covenant terms and thresholds' },
          { name: 'CreatedDate',    type: 'TIMESTAMPTZ',   description: 'Record creation timestamp' },
        ],
      },
      {
        name: 'salesforce.Task',
        description: 'CRM activity log — calls, emails, and to-dos recorded by RMs.',
        columns: [
          { name: 'Id',          type: 'VARCHAR(18)',  description: 'Salesforce record ID' },
          { name: 'WhatId',      type: 'VARCHAR(18)',  description: 'Related Account or Opportunity ID' },
          { name: 'Subject',     type: 'VARCHAR(255)', description: 'Short activity title' },
          { name: 'Description', type: 'TEXT',         description: 'Full activity notes' },
          { name: 'Status',      type: 'VARCHAR(20)',  description: 'Not Started, In Progress, Completed, Deferred' },
          { name: 'Priority',    type: 'VARCHAR(10)',  description: 'High, Normal, Low' },
          { name: 'ActivityDate',type: 'DATE',         description: 'Due or completion date' },
          { name: 'OwnerId',     type: 'VARCHAR(18)',  description: 'Assigned RM User ID' },
          { name: 'CreatedDate', type: 'TIMESTAMPTZ',  description: 'Record creation timestamp' },
        ],
      },
      {
        name: 'salesforce.Event',
        description: 'Calendar meetings and interactions with clients.',
        columns: [
          { name: 'Id',             type: 'VARCHAR(18)',  description: 'Salesforce record ID' },
          { name: 'WhatId',         type: 'VARCHAR(18)',  description: 'Related Account or Opportunity ID' },
          { name: 'Subject',        type: 'VARCHAR(255)', description: 'Meeting title' },
          { name: 'Description',    type: 'TEXT',         description: 'Agenda / meeting notes' },
          { name: 'StartDateTime',  type: 'TIMESTAMPTZ',  description: 'Meeting start time' },
          { name: 'EndDateTime',    type: 'TIMESTAMPTZ',  description: 'Meeting end time' },
          { name: 'Location',       type: 'VARCHAR(255)', description: 'Physical or virtual location' },
          { name: 'OwnerId',        type: 'VARCHAR(18)',  description: 'Organising RM User ID' },
          { name: 'CreatedDate',    type: 'TIMESTAMPTZ',  description: 'Record creation timestamp' },
        ],
      },
      {
        name: 'salesforce.Campaign',
        description: 'Bank-wide outreach and product campaigns linked to accounts.',
        columns: [
          { name: 'Id',          type: 'VARCHAR(18)',  description: 'Salesforce record ID' },
          { name: 'Name',        type: 'VARCHAR(128)', description: 'Campaign name' },
          { name: 'Type',        type: 'VARCHAR(50)',  description: 'Campaign type: Email, Event, Product Push, etc.' },
          { name: 'Status',      type: 'VARCHAR(20)',  description: 'Planned, Active, Completed, Aborted' },
          { name: 'StartDate',   type: 'DATE',         description: 'Campaign launch date' },
          { name: 'EndDate',     type: 'DATE',         description: 'Campaign close date' },
          { name: 'Description', type: 'TEXT',         description: 'Campaign objectives and messaging' },
          { name: 'CreatedDate', type: 'TIMESTAMPTZ',  description: 'Record creation timestamp' },
        ],
      },
    ],
  },

  // ── Payments System ────────────────────────────────────────────────────────
  'payments-system': {
    id: 'payments-system',
    label: 'Payments System',
    icon: '💰',
    status: 'live',
    mcpServer: 'payments-mcp',
    port: 8082,
    transport: 'SSE',
    description:
      'The bank data warehouse (bankdw) is the analytical layer over the ' +
      'core payments and AML systems. It holds fact tables for payment ' +
      'transactions and dimensional tables for parties, banks, and products. ' +
      'The payments-mcp server exposes aggregated and detail queries — ' +
      'individual AML and compliance columns are masked by OPA policy ' +
      'unless the caller holds the required compliance_clearance.',
    accessNote:
      'OPA policy tool_auth.rego grants access based on role. ' +
      'Columns flagged OPA-masked below are redacted for standard clearance — ' +
      'they are visible only when compliance_clearance = "aml" or "full". ' +
      'Row-level filters restrict fact_payments to the RM\'s assigned accounts.',
    usedBy: ['rm-prep', 'portfolio-watch', 'credit-review', 'aml-triage'],
    schema: [
      {
        name: 'bankdw.fact_payments',
        description: 'Central fact table for all payment transactions processed through core banking.',
        columns: [
          { name: 'payment_id',         type: 'BIGSERIAL',     description: 'Surrogate primary key' },
          { name: 'party_id',           type: 'INTEGER',        description: 'Foreign key → bankdw.dim_party' },
          { name: 'bank_id',            type: 'INTEGER',        description: 'Foreign key → bankdw.dim_bank (correspondent bank)' },
          { name: 'product_id',         type: 'INTEGER',        description: 'Foreign key → bankdw.dim_product' },
          { name: 'account_number',     type: 'VARCHAR(34)',    description: 'IBAN or account number of the transacting account', sensitive: true },
          { name: 'transaction_date',   type: 'DATE',           description: 'Value date of the transaction' },
          { name: 'transaction_time',   type: 'TIMESTAMPTZ',    description: 'Timestamp of transaction authorisation' },
          { name: 'amount',             type: 'NUMERIC(18,2)',  description: 'Transaction amount in original currency' },
          { name: 'currency',           type: 'CHAR(3)',        description: 'ISO 4217 currency code' },
          { name: 'amount_usd',         type: 'NUMERIC(18,2)',  description: 'Converted amount in USD at transaction rate' },
          { name: 'transaction_type',   type: 'VARCHAR(30)',    description: 'CREDIT, DEBIT, INTERNAL_TRANSFER, FX_TRADE, etc.' },
          { name: 'payment_status',     type: 'VARCHAR(20)',    description: 'SETTLED, PENDING, RETURNED, FAILED' },
          { name: 'channel',            type: 'VARCHAR(30)',    description: 'SWIFT, SEPA, ACH, RTGS, INTERNAL' },
          { name: 'beneficiary_name',   type: 'VARCHAR(255)',   description: 'Name of the payment recipient', sensitive: true },
          { name: 'beneficiary_iban',   type: 'VARCHAR(34)',    description: 'Recipient IBAN or account', sensitive: true },
          { name: 'remittance_info',    type: 'VARCHAR(140)',   description: 'Payment reference / remittance text' },
          { name: 'days_overdue',       type: 'INTEGER',        description: 'Days beyond agreed due date (0 = on time)' },
          { name: 'is_structured',      type: 'BOOLEAN',        description: 'True if the remittance uses structured reference format' },
        ],
      },
      {
        name: 'bankdw.dim_party',
        description: 'Customer / counterparty dimension with AML risk attributes. Several columns are OPA-masked.',
        columns: [
          { name: 'party_id',                   type: 'SERIAL',       description: 'Surrogate primary key' },
          { name: 'party_name',                  type: 'VARCHAR(255)', description: 'Legal name of the entity or individual' },
          { name: 'party_type',                  type: 'VARCHAR(50)',  description: 'CORPORATE, INDIVIDUAL, FINANCIAL_INSTITUTION, etc.' },
          { name: 'country_of_incorporation',    type: 'CHAR(2)',      description: 'ISO 3166-1 alpha-2 country code' },
          { name: 'industry_sector',             type: 'VARCHAR(100)', description: 'GICS or internal sector classification' },
          { name: 'relationship_manager_id',     type: 'VARCHAR(50)',  description: 'Assigned RM identifier (matches AgentContext rm_id)' },
          { name: 'onboarding_date',             type: 'DATE',         description: 'Date the client was onboarded' },
          // AML columns — OPA masked at standard clearance
          { name: 'AMLRiskCategory',             type: 'VARCHAR(20)',  description: 'AML risk tier: HIGH, MEDIUM, LOW', opaMasked: true, sensitive: true },
          { name: 'RiskRating',                  type: 'VARCHAR(20)',  description: 'Overall risk rating used by compliance team', opaMasked: true, sensitive: true },
          { name: 'KYCStatus',                   type: 'VARCHAR(30)',  description: 'KYC refresh status: VERIFIED, PENDING, OVERDUE', opaMasked: true, sensitive: true },
          { name: 'FraudMonitoringSegment',      type: 'VARCHAR(30)',  description: 'Transaction monitoring rule group', opaMasked: true, sensitive: true },
          // Compliance columns — OPA masked at standard clearance
          { name: 'SanctionsScreeningStatus',    type: 'VARCHAR(30)',  description: 'Result of latest sanctions screen: CLEAR, MATCH, PENDING', opaMasked: true, sensitive: true },
          { name: 'PEPFlag',                     type: 'BOOLEAN',      description: 'True if party or UBO is a Politically Exposed Person', opaMasked: true, sensitive: true },
          { name: 'BSAAMLProgramRating',         type: 'VARCHAR(20)',  description: 'BSA/AML programme rating assigned by compliance', opaMasked: true, sensitive: true },
          { name: 'SanctionsComplianceStatus',   type: 'VARCHAR(30)',  description: 'Ongoing sanctions compliance category', opaMasked: true, sensitive: true },
          { name: 'last_reviewed_date',          type: 'DATE',         description: 'Date of last compliance review' },
          { name: 'next_review_date',            type: 'DATE',         description: 'Scheduled date for next compliance review' },
        ],
      },
      {
        name: 'bankdw.dim_bank',
        description: 'Reference table of correspondent and counterparty banks.',
        columns: [
          { name: 'bank_id',       type: 'SERIAL',       description: 'Surrogate primary key' },
          { name: 'bank_name',     type: 'VARCHAR(255)',  description: 'Full legal name of the bank' },
          { name: 'swift_bic',     type: 'VARCHAR(11)',   description: 'SWIFT BIC code' },
          { name: 'country',       type: 'CHAR(2)',       description: 'ISO 3166-1 alpha-2 country code' },
          { name: 'bank_type',     type: 'VARCHAR(50)',   description: 'CORRESPONDENT, CENTRAL_BANK, CLEARING, COMMERCIAL' },
          { name: 'risk_tier',     type: 'VARCHAR(20)',   description: 'Correspondent banking risk tier: LOW, MEDIUM, HIGH' },
          { name: 'is_active',     type: 'BOOLEAN',       description: 'True if the correspondent relationship is active' },
        ],
      },
      {
        name: 'bankdw.dim_product',
        description: 'Banking product reference — maps product codes to names and categories.',
        columns: [
          { name: 'product_id',       type: 'SERIAL',       description: 'Surrogate primary key' },
          { name: 'product_code',     type: 'VARCHAR(20)',   description: 'Internal product code' },
          { name: 'product_name',     type: 'VARCHAR(100)',  description: 'Display name of the banking product' },
          { name: 'product_category', type: 'VARCHAR(50)',   description: 'LENDING, DEPOSITS, TRADE_FINANCE, TREASURY, PAYMENTS' },
          { name: 'sub_category',     type: 'VARCHAR(80)',   description: 'Sub-classification within the category' },
          { name: 'currency',         type: 'CHAR(3)',       description: 'Primary currency for this product (ISO 4217)' },
          { name: 'is_active',        type: 'BOOLEAN',       description: 'True if currently offered to clients' },
        ],
      },
      {
        name: 'bankdw.bridge_party_account',
        description: 'Many-to-many bridge resolving parties to their bank accounts.',
        columns: [
          { name: 'party_id',      type: 'INTEGER',      description: 'Foreign key → bankdw.dim_party' },
          { name: 'account_number',type: 'VARCHAR(34)',   description: 'IBAN or account number', sensitive: true },
          { name: 'account_type',  type: 'VARCHAR(50)',   description: 'CURRENT, SAVINGS, LOAN, LC, OVERDRAFT' },
          { name: 'currency',      type: 'CHAR(3)',       description: 'Account currency (ISO 4217)' },
          { name: 'is_primary',    type: 'BOOLEAN',       description: 'True if this is the party\'s primary operating account' },
          { name: 'opened_date',   type: 'DATE',          description: 'Account open date' },
          { name: 'closed_date',   type: 'DATE',          description: 'Account close date (NULL if active)' },
        ],
      },
    ],
  },

  // ── Internet News / News Search ────────────────────────────────────────────
  'internet-news': {
    id: 'internet-news',
    label: 'Internet News',
    icon: '📰',
    status: 'live',
    mcpServer: 'news-search-mcp',
    port: 8083,
    transport: 'SSE',
    description:
      'The news-search-mcp server provides real-time web search and news ' +
      'retrieval for named entities — companies, executives, sectors, and ' +
      'geographies. It is used by the RM Prep Agent to surface recent news ' +
      'about a client and by the Portfolio Watch Agent to screen for adverse ' +
      'events across the full book. Results are ranked and deduplicated before ' +
      'being passed to the LangGraph workflow.',
    accessNote:
      'News search has no row-level filtering — results are public web content. ' +
      'Access is gated by the news_search tool permission in OPA tool_auth.rego, ' +
      'which is granted to all rm and compliance roles.',
    usedBy: ['rm-prep', 'portfolio-watch', 'aml-triage', 'kyc-onboarding'],
    schema: [
      {
        name: 'Tool: search_news',
        description: 'Search for recent news articles about a named entity or topic.',
        columns: [
          { name: 'query',      type: 'string',  description: 'Natural-language search query (company name, person, topic)' },
          { name: 'max_results',type: 'integer', description: 'Maximum number of results to return (default: 10, max: 50)' },
          { name: 'days_back',  type: 'integer', description: 'How many days of news to search (default: 30, max: 365)' },
          { name: 'language',   type: 'string',  description: 'ISO 639-1 language code filter (default: en)' },
        ],
      },
      {
        name: 'Response: NewsArticle',
        description: 'Structured article returned by the news search tool.',
        columns: [
          { name: 'title',        type: 'string',    description: 'Article headline' },
          { name: 'source',       type: 'string',    description: 'Publication name' },
          { name: 'published_at', type: 'ISO 8601',  description: 'Publication timestamp' },
          { name: 'url',          type: 'string',    description: 'Direct link to the article' },
          { name: 'summary',      type: 'string',    description: 'LLM-generated 2–3 sentence summary' },
          { name: 'sentiment',    type: 'string',    description: 'Positive / Neutral / Negative classification' },
          { name: 'relevance',    type: 'float',     description: 'Relevance score 0.0–1.0 relative to query' },
        ],
      },
    ],
  },

  // ── CRM / Client Book (alias used by Portfolio Watch) ─────────────────────
  'crm-client-book': {
    id: 'crm-client-book',
    label: 'CRM / Client Book',
    icon: '🏢',
    status: 'live',
    mcpServer: 'salesforce-mcp',
    port: 8081,
    transport: 'SSE',
    description:
      'The CRM / Client Book view is used by the Portfolio Watch Agent to ' +
      'enumerate the full set of accounts in an RM\'s book of business. ' +
      'It is backed by the same salesforce-mcp server as the Salesforce CRM ' +
      'source, but the Portfolio Watch workflow uses bulk account listing ' +
      'rather than single-account deep dives.',
    accessNote:
      'Same OPA policies as Salesforce CRM. AgentContext assigned_account_ids ' +
      'constrains the account list to the RM\'s authorised book.',
    usedBy: ['portfolio-watch'],
    schema: [], // Same server as salesforce-crm — see Salesforce CRM schema
  },

  // ── Credit Intelligence ────────────────────────────────────────────────────
  'credit-intelligence': {
    id: 'credit-intelligence',
    label: 'Credit Intelligence',
    icon: '📈',
    status: 'coming-soon',
    mcpServer: 'credit-mcp',
    port: 8085,
    transport: 'SSE',
    description:
      'Credit Intelligence aggregates internal credit ratings, covenant ' +
      'compliance status, and external bureau scores. It will power the ' +
      'Portfolio Watch and Credit Review agents with real-time credit ' +
      'deterioration signals.',
    accessNote:
      'Will require compliance_clearance ≥ credit for full access. ' +
      'Standard RM users will see aggregated signals only.',
    usedBy: ['portfolio-watch', 'credit-review'],
    schema: [],
  },

  // ── News & Events (alias used by Portfolio Watch) ──────────────────────────
  'news-events': {
    id: 'news-events',
    label: 'News & Events',
    icon: '📰',
    status: 'live',
    mcpServer: 'news-search-mcp',
    port: 8083,
    transport: 'SSE',
    description:
      'News & Events is the same news-search-mcp service used for per-client ' +
      'news lookups, configured for bulk adversarial news screening across an ' +
      'entire portfolio. Portfolio Watch queries it in parallel for each ' +
      'account in the book.',
    accessNote:
      'Same OPA permissions as Internet News source.',
    usedBy: ['portfolio-watch'],
    schema: [], // Same server as internet-news — see Internet News schema
  },

  // ── Credit System ──────────────────────────────────────────────────────────
  'credit-system': {
    id: 'credit-system',
    label: 'Credit System',
    icon: '🏦',
    status: 'coming-soon',
    mcpServer: 'credit-mcp',
    port: 8085,
    transport: 'SSE',
    description:
      'Core credit origination and management system. Will provide structured ' +
      'credit facility data, drawdown history, covenant monitoring, and ' +
      'financial ratio trends for the Credit Review Agent.',
    accessNote: 'Will require credit_analyst or credit_manager role.',
    usedBy: ['credit-review'],
    schema: [],
  },

  // ── Financial Docs ─────────────────────────────────────────────────────────
  'financial-docs': {
    id: 'financial-docs',
    label: 'Financial Docs',
    icon: '📄',
    status: 'coming-soon',
    mcpServer: 'document-mcp',
    port: 8086,
    transport: 'SSE',
    description:
      'Secure document store for client-submitted financial statements, ' +
      'audited accounts, and management accounts. Will enable the Credit ' +
      'Review Agent to ingest structured financials for ratio analysis.',
    accessNote: 'Will require credit_analyst role and document_access permission.',
    usedBy: ['credit-review'],
    schema: [],
  },

  // ── Transaction Monitor ────────────────────────────────────────────────────
  'transaction-monitor': {
    id: 'transaction-monitor',
    label: 'Transaction Monitor',
    icon: '⚡',
    status: 'coming-soon',
    mcpServer: 'aml-mcp',
    port: 8087,
    transport: 'SSE',
    description:
      'Real-time transaction monitoring system that generates AML alerts ' +
      'when payment patterns breach rule thresholds. The AML Triage Agent ' +
      'will pull the full transaction chain for a given alert to support ' +
      'structured triage recommendations.',
    accessNote: 'Requires compliance_clearance = aml or full.',
    usedBy: ['aml-triage'],
    schema: [],
  },

  // ── Sanctions Lists ────────────────────────────────────────────────────────
  'sanctions-lists': {
    id: 'sanctions-lists',
    label: 'Sanctions Lists',
    icon: '🛡️',
    status: 'coming-soon',
    mcpServer: 'sanctions-mcp',
    port: 8088,
    transport: 'SSE',
    description:
      'Aggregated sanctions and watchlist screening service covering OFAC, ' +
      'EU, UN, HM Treasury, and regional lists. Used by the AML Triage and ' +
      'KYC Screening agents for real-time name and entity matching.',
    accessNote: 'Requires compliance_clearance = aml or full.',
    usedBy: ['aml-triage', 'kyc-onboarding'],
    schema: [],
  },

  // ── Adverse News ──────────────────────────────────────────────────────────
  'adverse-news': {
    id: 'adverse-news',
    label: 'Adverse News',
    icon: '📰',
    status: 'coming-soon',
    mcpServer: 'news-search-mcp',
    port: 8083,
    transport: 'SSE',
    description:
      'Adverse news screening variant of the news-search-mcp service, ' +
      'pre-filtered for negative sentiment and configured with compliance ' +
      'relevant query templates (fraud, sanctions, enforcement, litigation).',
    accessNote: 'Requires compliance role or compliance_clearance ≥ standard.',
    usedBy: ['aml-triage', 'kyc-onboarding'],
    schema: [],
  },

  // ── Trade System ──────────────────────────────────────────────────────────
  'trade-system': {
    id: 'trade-system',
    label: 'Trade System',
    icon: '📦',
    status: 'coming-soon',
    mcpServer: 'trade-mcp',
    port: 8089,
    transport: 'SSE',
    description:
      'Core trade finance platform managing Letters of Credit, documentary ' +
      'collections, and guarantees. The Trade Finance Agent will query it ' +
      'for LC terms to cross-reference against uploaded shipping documents.',
    accessNote: 'Requires trade_finance role.',
    usedBy: ['trade-finance'],
    schema: [],
  },

  // ── Document Store ─────────────────────────────────────────────────────────
  'document-store': {
    id: 'document-store',
    label: 'Document Store',
    icon: '📄',
    status: 'coming-soon',
    mcpServer: 'document-mcp',
    port: 8086,
    transport: 'SSE',
    description:
      'Secure document management system for trade documents — bills of ' +
      'lading, commercial invoices, packing lists, certificates of origin. ' +
      'The Trade Finance Agent will extract and cross-reference fields from ' +
      'uploaded documents against LC terms.',
    accessNote: 'Requires trade_finance role and document_access permission.',
    usedBy: ['trade-finance'],
    schema: [],
  },

  // ── LC Registry ────────────────────────────────────────────────────────────
  'lc-registry': {
    id: 'lc-registry',
    label: 'LC Registry',
    icon: '📋',
    status: 'coming-soon',
    mcpServer: 'trade-mcp',
    port: 8089,
    transport: 'SSE',
    description:
      'Letter of Credit issuance and amendment registry. Holds the master ' +
      'LC record, all amendment history, and compliance check results for ' +
      'each LC instrument.',
    accessNote: 'Requires trade_finance role.',
    usedBy: ['trade-finance'],
    schema: [],
  },

  // ── KYC System ────────────────────────────────────────────────────────────
  'kyc-system': {
    id: 'kyc-system',
    label: 'KYC System',
    icon: '🗂️',
    status: 'coming-soon',
    mcpServer: 'kyc-mcp',
    port: 8090,
    transport: 'SSE',
    description:
      'Client KYC repository holding due diligence documents, UBO structures, ' +
      'risk narratives, and review schedules. The KYC Screening Agent will ' +
      'orchestrate KYC refresh workflows using this system as the source of ' +
      'record.',
    accessNote: 'Requires compliance role and kyc_access permission.',
    usedBy: ['kyc-onboarding'],
    schema: [],
  },

  // ── Companies House ────────────────────────────────────────────────────────
  'companies-house': {
    id: 'companies-house',
    label: 'Companies House',
    icon: '🏛️',
    status: 'coming-soon',
    mcpServer: 'registry-mcp',
    port: 8091,
    transport: 'SSE',
    description:
      'Public company registry API (UK Companies House and equivalent ' +
      'international registries). Used by the KYC Screening Agent to verify ' +
      'UBO structures, director details, and filing history for corporate ' +
      'clients.',
    accessNote: 'Public data — accessible to all roles.',
    usedBy: ['kyc-onboarding'],
    schema: [],
  },

  // ── Treasury System ────────────────────────────────────────────────────────
  'treasury-system': {
    id: 'treasury-system',
    label: 'Treasury System',
    icon: '💱',
    status: 'coming-soon',
    mcpServer: 'treasury-mcp',
    port: 8092,
    transport: 'SSE',
    description:
      'Treasury management system holding the client\'s FX hedge book, ' +
      'interest rate swap portfolio, upcoming maturities, and mark-to-market ' +
      'valuations. The Treasury Advisory Agent will use this to build ' +
      'personalised conversation guides for treasury sales calls.',
    accessNote: 'Requires treasury_sales or treasury_manager role.',
    usedBy: ['treasury-advisory'],
    schema: [],
  },

  // ── Rates Feed ─────────────────────────────────────────────────────────────
  'rates-feed': {
    id: 'rates-feed',
    label: 'Rates Feed',
    icon: '📈',
    status: 'coming-soon',
    mcpServer: 'treasury-mcp',
    port: 8092,
    transport: 'SSE',
    description:
      'Live FX rates, interest rate curves, and benchmark data (SOFR, EURIBOR, ' +
      'SONIA) from the bank\'s market data infrastructure. Provides current ' +
      'rates context for the Treasury Advisory Agent.',
    accessNote: 'Accessible to treasury_sales and rm roles.',
    usedBy: ['treasury-advisory'],
    schema: [],
  },

  // ── GL / Finance System ───────────────────────────────────────────────────
  'gl-finance-system': {
    id: 'gl-finance-system',
    label: 'GL / Finance System',
    icon: '🏦',
    status: 'coming-soon',
    mcpServer: 'finance-mcp',
    port: 8093,
    transport: 'SSE',
    description:
      'General ledger and financial reporting system. Will provide balance ' +
      'sheet positions, P&L data, and regulatory capital positions for ' +
      'COREP/FINREP/LCR report generation.',
    accessNote: 'Requires finance or regulatory_reporting role.',
    usedBy: ['regulatory-reporting'],
    schema: [],
  },

  // ── Risk Data Mart ────────────────────────────────────────────────────────
  'risk-data-mart': {
    id: 'risk-data-mart',
    label: 'Risk Data Mart',
    icon: '📊',
    status: 'coming-soon',
    mcpServer: 'finance-mcp',
    port: 8093,
    transport: 'SSE',
    description:
      'Risk-weighted asset calculations, exposure at default, and credit ' +
      'risk parameters (PD, LGD, EAD). Used by the Regulatory Reporting ' +
      'Agent to apply Basel haircuts and weightings for COREP submissions.',
    accessNote: 'Requires regulatory_reporting role.',
    usedBy: ['regulatory-reporting'],
    schema: [],
  },

  // ── Regulatory Rules ──────────────────────────────────────────────────────
  'regulatory-rules': {
    id: 'regulatory-rules',
    label: 'Regulatory Rules',
    icon: '⚖️',
    status: 'coming-soon',
    mcpServer: 'finance-mcp',
    port: 8093,
    transport: 'SSE',
    description:
      'Structured regulatory rule library covering EBA/PRA/FRB requirements ' +
      'for COREP, FINREP, and LCR. Provides the calculation logic and ' +
      'validation rules that the Regulatory Reporting Agent applies when ' +
      'preparing report sections.',
    accessNote: 'Read-only, accessible to regulatory_reporting role.',
    usedBy: ['regulatory-reporting'],
    schema: [],
  },
}

/**
 * Look up a data source by ID.
 * @param {string} sourceId
 * @returns {DataSource | null}
 */
export const getDataSource = (sourceId) => DATA_SOURCES[sourceId] ?? null

/**
 * Get all live data sources (for index/directory views).
 * @returns {DataSource[]}
 */
export const getLiveSources = () =>
  Object.values(DATA_SOURCES).filter((s) => s.status === 'live')

/**
 * Get the unique set of data sources used by a given agent.
 * @param {string} agentId
 * @returns {DataSource[]}
 */
export const getSourcesForAgent = (agentId) =>
  Object.values(DATA_SOURCES).filter((s) => s.usedBy.includes(agentId))
