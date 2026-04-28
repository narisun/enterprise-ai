-- ============================================================
-- platform/db/init.sql
-- Initialisation script for the ai_memory PostgreSQL database.
-- Run automatically by the pgvector container on first start.
-- ============================================================

-- Enable pgvector extension for semantic search / embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable pgcrypto for UUID generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- LangGraph checkpointer tables
-- These are required by PostgresSaver for agent state persistence
-- (multi-turn conversation memory).
-- ============================================================
CREATE TABLE IF NOT EXISTS checkpoints (
    thread_id     TEXT        NOT NULL,
    checkpoint_id TEXT        NOT NULL,
    parent_id     TEXT,
    checkpoint    JSONB       NOT NULL,
    metadata      JSONB       NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (thread_id, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS checkpoint_writes (
    thread_id     TEXT  NOT NULL,
    checkpoint_id TEXT  NOT NULL,
    task_id       TEXT  NOT NULL,
    idx           INT   NOT NULL,
    channel       TEXT  NOT NULL,
    value         JSONB,
    PRIMARY KEY (thread_id, checkpoint_id, task_id, idx)
);

-- ============================================================
-- Agent audit log
-- Immutable record of every tool call made by every agent.
-- Required for compliance and incident investigation.
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_audit_log (
    id            BIGSERIAL    PRIMARY KEY,
    trace_id      TEXT         NOT NULL,
    session_id    TEXT         NOT NULL,
    agent_role    TEXT,
    tool_name     TEXT         NOT NULL,
    input_summary TEXT,
    opa_decision  BOOLEAN      NOT NULL,
    outcome       TEXT,
    duration_ms   INT,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_session ON agent_audit_log(session_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON agent_audit_log(created_at DESC);

-- Composite index for compliance query patterns (SEC-05)
CREATE INDEX IF NOT EXISTS idx_audit_role_created
    ON agent_audit_log (agent_role, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_trace
    ON agent_audit_log (trace_id);

-- Retention policy: Partition by month for efficient archival.
-- In production, use pg_partman or a cron job to:
--   1. Archive partitions older than 90 days to S3 (via pg_dump)
--   2. Drop partitions older than 365 days
-- COMMENT: Review and implement partition strategy before production launch.

-- Schema version tracking (ROB-04 / SEC-05)
CREATE TABLE IF NOT EXISTS schema_version (
    id              SERIAL PRIMARY KEY,
    version         INTEGER NOT NULL,
    description     TEXT NOT NULL,
    applied_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_version (version, description) VALUES
    (1, 'Initial schema: checkpoints, checkpoint_writes, agent_audit_log')
ON CONFLICT DO NOTHING;
