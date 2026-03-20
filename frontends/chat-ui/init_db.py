"""
init_db.py — Create / migrate Chainlit data-layer tables in PostgreSQL.

Called from entrypoint.sh before the Chainlit server starts.
Uses asyncpg directly so we are not dependent on `chainlit db upgrade`
(which relies on Alembic being wired up correctly).

Structure:
  _SCHEMA_SQL    — CREATE TABLE IF NOT EXISTS for fresh databases.
  _MIGRATION_SQL — ALTER TABLE … ADD COLUMN IF NOT EXISTS for columns
                   added in newer Chainlit releases. Safe to run against
                   both old and new schemas (fully idempotent).

Schema source: chainlit/backend/chainlit/data/sql_alchemy.py (Chainlit 1.x)
"""

import asyncio
import os
import sys


# ---------------------------------------------------------------------------
# Chainlit 1.x table definitions
# Column names deliberately kept in the camelCase that Chainlit uses in its
# ORM queries (e.g. "threadId", "userIdentifier") so they match exactly.
# ---------------------------------------------------------------------------
_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
    "id"          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    "identifier"  TEXT    NOT NULL UNIQUE,
    "metadata"    JSONB   NOT NULL DEFAULT '{}',
    "createdAt"   TEXT
);

CREATE TABLE IF NOT EXISTS threads (
    "id"              UUID    PRIMARY KEY,
    "createdAt"       TEXT,
    "name"            TEXT,
    "userId"          UUID    REFERENCES users("id") ON DELETE CASCADE,
    "userIdentifier"  TEXT,
    "tags"            TEXT[],
    "metadata"        JSONB   NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS steps (
    "id"            UUID     PRIMARY KEY,
    "name"          TEXT     NOT NULL,
    "type"          TEXT     NOT NULL,
    "threadId"      UUID     NOT NULL REFERENCES threads("id") ON DELETE CASCADE,
    "parentId"      UUID,
    "streaming"     BOOLEAN  NOT NULL DEFAULT FALSE,
    "waitForAnswer" BOOLEAN,
    "isError"       BOOLEAN,
    "metadata"      JSONB    DEFAULT '{}',
    "tags"          TEXT[],
    "input"         TEXT,
    "output"        TEXT,
    "createdAt"     TEXT,
    "start"         TEXT,
    "end"           TEXT,
    "generation"    JSONB,
    "showInput"     TEXT,
    "language"      TEXT,
    "indent"        INT,
    "defaultOpen"   BOOLEAN  DEFAULT FALSE,  -- added in Chainlit 1.x (later releases)
    "autoCollapse"  BOOLEAN  DEFAULT FALSE   -- added in Chainlit 1.x (later releases)
);

CREATE TABLE IF NOT EXISTS elements (
    "id"          UUID  PRIMARY KEY,
    "threadId"    UUID,
    "type"        TEXT,
    "url"         TEXT,
    "chainlitKey" TEXT,
    "name"        TEXT  NOT NULL,
    "display"     TEXT,
    "objectKey"   TEXT,
    "size"        TEXT,
    "page"        INT,
    "language"    TEXT,
    "forId"       UUID,
    "mime"        TEXT,
    "props"       JSONB DEFAULT '{}'   -- added in Chainlit 1.x (later releases)
);

CREATE TABLE IF NOT EXISTS feedbacks (
    "id"       UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
    "forId"    UUID  NOT NULL,
    "threadId" UUID  NOT NULL REFERENCES threads("id") ON DELETE CASCADE,
    "value"    INT   NOT NULL,
    "comment"  TEXT
);
"""

# ---------------------------------------------------------------------------
# Additive migrations — columns added in newer Chainlit point releases.
# Each statement is fully idempotent: ADD COLUMN IF NOT EXISTS is a no-op
# when the column already exists (PostgreSQL 9.6+).
# ---------------------------------------------------------------------------
_MIGRATION_SQL = """
-- Chainlit added "props" to elements for storing element metadata (e.g. tool
-- call payloads). Without it the SQL layer raises UndefinedColumnError on every
-- thread load.  See: chainlit/backend/chainlit/data/sql_alchemy.py
ALTER TABLE elements
    ADD COLUMN IF NOT EXISTS "props" JSONB DEFAULT '{}';

-- Chainlit added "defaultOpen" and "autoCollapse" to steps for controlling
-- how Step widgets are displayed in the UI.  Without them, every INSERT into
-- steps raises UndefinedColumnError and NO messages (user or assistant) are
-- persisted — making the history view appear completely empty.
ALTER TABLE steps
    ADD COLUMN IF NOT EXISTS "defaultOpen"  BOOLEAN DEFAULT FALSE;
ALTER TABLE steps
    ADD COLUMN IF NOT EXISTS "autoCollapse" BOOLEAN DEFAULT FALSE;
"""


_MAX_RETRIES = 10
_RETRY_DELAY = 3.0   # seconds between attempts


async def main() -> None:
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        print("[init_db] DATABASE_URL not set — skipping schema init.")
        return

    # asyncpg uses a plain postgresql:// DSN; strip the +asyncpg driver suffix
    dsn = db_url.replace("postgresql+asyncpg://", "postgresql://")

    import asyncpg

    # Retry loop — docker depends_on with service_healthy is not atomic:
    # pg_isready can pass a moment before port 5432 accepts all clients.
    conn = None
    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            print(f"[init_db] Connecting to PostgreSQL… (attempt {attempt}/{_MAX_RETRIES})")
            conn = await asyncpg.connect(dsn, timeout=10)
            break  # success
        except Exception as exc:
            if attempt == _MAX_RETRIES:
                print(f"[init_db] ERROR: Could not connect after {_MAX_RETRIES} attempts: {exc}",
                      file=sys.stderr)
                sys.exit(1)
            print(f"[init_db] Not ready yet ({exc}); retrying in {_RETRY_DELAY:.0f}s…")
            await asyncio.sleep(_RETRY_DELAY)

    try:
        await conn.execute(_SCHEMA_SQL)
        print("[init_db] Chainlit tables created / verified OK.")
        await conn.execute(_MIGRATION_SQL)
        print("[init_db] Migrations applied OK.")
    except Exception as exc:
        print(f"[init_db] ERROR: Schema / migration failed: {exc}", file=sys.stderr)
        sys.exit(1)
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
