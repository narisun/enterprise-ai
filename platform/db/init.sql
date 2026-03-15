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

-- ============================================================
-- Example workspace schema (created per-session by the agent)
-- In production, workspace schemas are created dynamically by the
-- agent session bootstrap process.
-- ============================================================
CREATE SCHEMA IF NOT EXISTS ws_123e4567_e89b_12d3_a456_426614174000;

SET search_path TO ws_123e4567_e89b_12d3_a456_426614174000, public;

-- Example table for integration tests
CREATE TABLE IF NOT EXISTS sample_data (
    id      SERIAL      PRIMARY KEY,
    name    TEXT        NOT NULL,
    value   NUMERIC(15,2),
    created TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sample_data (name, value) VALUES
    ('Account Alpha',  1234567.89),
    ('Account Beta',    987654.32),
    ('Account Gamma',  456789.01)
ON CONFLICT DO NOTHING;
