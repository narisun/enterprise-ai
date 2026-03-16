-- ============================================================
-- platform/db/rm_prep_schema.sql
--
-- Mock CRM and Payments tables for RM Prep Agent Phase 1 MVP.
--
-- In production these would be replaced by live integrations:
--   sf_* tables  → Salesforce REST API via salesforce-mcp
--   payment_*    → Core banking API via payments-mcp
--
-- Run order: after init.sql (extensions already enabled)
-- ============================================================

-- ============================================================
-- SALESFORCE MOCK — CRM data
-- ============================================================

CREATE TABLE IF NOT EXISTS sf_accounts (
    account_id          VARCHAR(18)     PRIMARY KEY,   -- Salesforce 18-char ID
    account_name        VARCHAR(255)    NOT NULL,
    industry            VARCHAR(100),
    sub_industry        VARCHAR(100),
    annual_revenue      BIGINT,                        -- USD
    employee_count      INT,
    segment             VARCHAR(50),                   -- enterprise, mid-market, smb
    account_owner       VARCHAR(100),                  -- RM name
    phone               VARCHAR(50),
    website             VARCHAR(255),
    hq_city             VARCHAR(100),
    hq_country          VARCHAR(100)    DEFAULT 'USA',
    description         TEXT,
    created_at          TIMESTAMPTZ     DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sf_contacts (
    contact_id          VARCHAR(18)     PRIMARY KEY,
    account_id          VARCHAR(18)     REFERENCES sf_accounts(account_id),
    first_name          VARCHAR(100),
    last_name           VARCHAR(100)    NOT NULL,
    title               VARCHAR(150),
    email               VARCHAR(255),
    phone               VARCHAR(50),
    is_primary          BOOLEAN         DEFAULT FALSE,
    last_contacted_date DATE,
    created_at          TIMESTAMPTZ     DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sf_activities (
    activity_id         VARCHAR(18)     PRIMARY KEY,
    account_id          VARCHAR(18)     REFERENCES sf_accounts(account_id),
    contact_id          VARCHAR(18)     REFERENCES sf_contacts(contact_id),
    activity_type       VARCHAR(50)     NOT NULL,      -- meeting, call, email, note
    subject             VARCHAR(500)    NOT NULL,
    description         TEXT,
    activity_date       DATE            NOT NULL,
    duration_minutes    INT,
    created_by          VARCHAR(100),
    created_at          TIMESTAMPTZ     DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sf_opportunities (
    opportunity_id      VARCHAR(18)     PRIMARY KEY,
    account_id          VARCHAR(18)     REFERENCES sf_accounts(account_id),
    opportunity_name    VARCHAR(255)    NOT NULL,
    stage               VARCHAR(100)    NOT NULL,      -- Prospecting, Qualification, Proposal, Negotiation, Closed Won/Lost
    amount              DECIMAL(18,2),                 -- USD
    close_date          DATE,
    probability         INT,                           -- 0-100%
    product_category    VARCHAR(100),                  -- treasury, lending, payments, fx, deposits
    next_steps          TEXT,
    description         TEXT,
    is_active           BOOLEAN         DEFAULT TRUE,
    created_at          TIMESTAMPTZ     DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sf_tasks (
    task_id             VARCHAR(18)     PRIMARY KEY,
    account_id          VARCHAR(18)     REFERENCES sf_accounts(account_id),
    contact_id          VARCHAR(18)     REFERENCES sf_contacts(contact_id),
    subject             VARCHAR(500)    NOT NULL,
    status              VARCHAR(50)     DEFAULT 'Open',  -- Open, In Progress, Completed, Deferred
    priority            VARCHAR(20)     DEFAULT 'Normal', -- High, Normal, Low
    due_date            DATE,
    description         TEXT,
    assigned_to         VARCHAR(100),
    created_at          TIMESTAMPTZ     DEFAULT NOW()
);

-- ============================================================
-- PAYMENTS MOCK — Bank transaction data
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_transactions (
    transaction_id      VARCHAR(36)     PRIMARY KEY   DEFAULT gen_random_uuid()::VARCHAR,
    account_id          VARCHAR(18)     NOT NULL,      -- links to sf_accounts.account_id
    transaction_date    DATE            NOT NULL,
    value_date          DATE,
    payment_type        VARCHAR(20)     NOT NULL,      -- wire, ach, rtp, check, swift
    direction           VARCHAR(10)     NOT NULL,      -- outbound, inbound
    amount              DECIMAL(18,2)   NOT NULL,
    currency            VARCHAR(3)      DEFAULT 'USD',
    counterparty_name   VARCHAR(255),
    counterparty_bank   VARCHAR(255),
    counterparty_country VARCHAR(100)   DEFAULT 'USA',
    reference           VARCHAR(255),
    purpose_code        VARCHAR(50),                   -- payroll, vendor, intercompany, tax
    status              VARCHAR(20)     DEFAULT 'completed', -- completed, pending, returned
    created_at          TIMESTAMPTZ     DEFAULT NOW()
);

-- Index for performance on the most common query patterns
CREATE INDEX IF NOT EXISTS idx_payment_account_date
    ON payment_transactions(account_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_payment_type
    ON payment_transactions(account_id, payment_type);

-- ============================================================
-- RM PREP BRIEFS — Audit trail (insert-only)
-- ============================================================

CREATE TABLE IF NOT EXISTS rm_prep_briefs (
    brief_id            UUID            PRIMARY KEY   DEFAULT gen_random_uuid(),
    client_name         VARCHAR(255)    NOT NULL,
    account_id          VARCHAR(18),
    rm_id               VARCHAR(100),
    meeting_date        DATE,
    generated_at        TIMESTAMPTZ     DEFAULT NOW(),
    brief_markdown      TEXT            NOT NULL,
    otel_trace_id       VARCHAR(64),
    sources_used        JSONB           DEFAULT '[]',  -- ["salesforce","payments","news"]
    created_at          TIMESTAMPTZ     DEFAULT NOW()
    -- No UPDATE, no DELETE — audit table is append-only
);

CREATE INDEX IF NOT EXISTS idx_briefs_client
    ON rm_prep_briefs(client_name, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_briefs_rm
    ON rm_prep_briefs(rm_id, generated_at DESC);

-- ============================================================
-- Helper view — payment summary per account (last 90 days)
-- Used by payments-mcp server for fast aggregation
-- ============================================================

CREATE OR REPLACE VIEW v_payment_summary_90d AS
SELECT
    account_id,
    COUNT(*)                                                    AS transaction_count,
    SUM(amount)                                                 AS total_volume,
    SUM(CASE WHEN payment_type = 'wire'  THEN amount ELSE 0 END) AS wire_volume,
    SUM(CASE WHEN payment_type = 'ach'   THEN amount ELSE 0 END) AS ach_volume,
    SUM(CASE WHEN payment_type = 'rtp'   THEN amount ELSE 0 END) AS rtp_volume,
    SUM(CASE WHEN payment_type = 'check' THEN amount ELSE 0 END) AS check_volume,
    SUM(CASE WHEN payment_type = 'swift' THEN amount ELSE 0 END) AS swift_volume,
    SUM(CASE WHEN direction = 'outbound' THEN amount ELSE 0 END) AS outbound_volume,
    SUM(CASE WHEN direction = 'inbound'  THEN amount ELSE 0 END) AS inbound_volume,
    COUNT(DISTINCT counterparty_country)
        FILTER (WHERE counterparty_country != 'USA')            AS international_corridor_count,
    MIN(transaction_date)                                       AS period_start,
    MAX(transaction_date)                                       AS period_end
FROM payment_transactions
WHERE transaction_date >= CURRENT_DATE - INTERVAL '90 days'
  AND status = 'completed'
GROUP BY account_id;
