"""
init_db.py — Create Chainlit data-layer tables in PostgreSQL.

Called from entrypoint.sh before the Chainlit server starts.
Uses asyncpg directly so we are not dependent on `chainlit db upgrade`
(which relies on Alembic being wired up correctly).

All statements use CREATE TABLE IF NOT EXISTS, so this script is fully
idempotent and safe to run on every container start.

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
    "indent"        INT
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
    "mime"        TEXT
);

CREATE TABLE IF NOT EXISTS feedbacks (
    "id"       UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
    "forId"    UUID  NOT NULL,
    "threadId" UUID  NOT NULL REFERENCES threads("id") ON DELETE CASCADE,
    "value"    INT   NOT NULL,
    "comment"  TEXT
);
"""


async def main() -> None:
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        print("[init_db] DATABASE_URL not set — skipping schema init.")
        return

    # asyncpg uses a plain postgresql:// DSN; strip the +asyncpg driver suffix
    dsn = db_url.replace("postgresql+asyncpg://", "postgresql://")

    import asyncpg

    print("[init_db] Connecting to PostgreSQL…")
    try:
        conn = await asyncpg.connect(dsn)
    except Exception as exc:
        print(f"[init_db] ERROR: Could not connect: {exc}", file=sys.stderr)
        sys.exit(1)

    try:
        await conn.execute(_SCHEMA_SQL)
        print("[init_db] Chainlit tables created / verified OK.")
    except Exception as exc:
        print(f"[init_db] ERROR: Schema creation failed: {exc}", file=sys.stderr)
        sys.exit(1)
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
