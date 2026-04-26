"""Pure business logic for data query execution.

Handles:
- SQL query validation (SELECT-only, no multi-statement)
- Session UUID validation
- Query execution with per-session schema isolation
- Result truncation by byte size
- OpenTelemetry span instrumentation
"""
import json
import re
import uuid
from typing import Optional

import asyncpg
from opentelemetry import trace

from platform_sdk import get_logger

log = get_logger(__name__)


def _is_valid_uuid(val: str) -> bool:
    """Validate that a string is a well-formed UUID (prevents schema injection)."""
    try:
        uuid.UUID(str(val))
        return True
    except ValueError:
        return False


class DataQueryService:
    """Pure business logic for executing read-only SQL queries."""

    def __init__(self, db_pool: asyncpg.Pool, tracer: trace.Tracer, max_result_bytes: int = 15_000) -> None:
        """
        Initialize the data query service.

        Args:
            db_pool: AsyncPG connection pool.
            tracer: OpenTelemetry tracer for span creation.
            max_result_bytes: Maximum size (in bytes) for result truncation. Defaults to 15,000.
        """
        self.db_pool = db_pool
        self.tracer = tracer
        self.max_result_bytes = max_result_bytes

    async def execute_read_query(self, query: str, session_id: str) -> str:
        """
        Execute a read-only SQL SELECT query against the database.

        Args:
            query: A SELECT statement. Only SELECT queries are permitted;
                   mutating statements are rejected.
            session_id: Workspace session UUID — used to isolate data per session.

        Returns:
            JSON-encoded rows, a "no records found" message, or an error string.
        """
        with self.tracer.start_as_current_span("execute_read_query") as span:
            span.set_attribute("session_id", session_id)

            # 1. UUID validation prevents schema-name injection
            if not _is_valid_uuid(session_id):
                span.set_status(trace.StatusCode.ERROR, "Invalid session_id UUID")
                return "ERROR: Invalid session_id — must be a valid UUID."

            # 2. Regex guard: only single SELECT statements allowed
            # Strip a trailing semicolon first — standard SQL practice, not an injection.
            # The embedded-semicolon check below catches actual multi-statement attempts
            # (e.g. "SELECT 1; DROP TABLE users").
            # \b prevents prefix bypass (e.g. "SELECTBAD"); readonly=True transaction
            # is the primary DB-level guard against mutation.
            query = query.rstrip().rstrip(";").rstrip()
            if not re.match(r"^\s*SELECT\b", query, re.IGNORECASE) or ";" in query:
                span.set_status(trace.StatusCode.ERROR, "Query security validation failed")
                return "ERROR: Security policy violation — only single SELECT queries are permitted."

            schema_name = f"ws_{session_id.replace('-', '_')}"

            # Defence in depth: verify the schema name matches the expected pattern
            # before interpolating it into SQL. The UUID check above should prevent
            # anything unexpected, but this regex is a second safety net.
            if not re.fullmatch(r"ws_[0-9a-f_]+", schema_name):
                span.set_status(trace.StatusCode.ERROR, "Schema name validation failed")
                return "ERROR: Invalid session_id format — cannot construct schema name."

            try:
                async with self.db_pool.acquire() as conn:
                    async with conn.transaction(readonly=True):
                        # SET LOCAL scopes this to the current transaction only,
                        # preventing schema leakage to the next request on the same
                        # connection when it is returned to the pool.
                        # statement_timeout prevents long-running or sleep() queries from
                        # holding a connection indefinitely (e.g. SELECT pg_sleep(300)).
                        # Schema name is double-quoted as a PostgreSQL identifier for safety.
                        safe_schema = f'"{schema_name}"'
                        await conn.execute(f"SET LOCAL search_path TO {safe_schema}, public")
                        await conn.execute("SET LOCAL statement_timeout = '30s'")
                        records = await conn.fetch(query)

                        span.set_attribute("db.row_count", len(records))
                        log.info("query_executed", session_id=session_id, rows=len(records))

                        if not records:
                            return "Query executed successfully. No records found."

                        output = json.dumps([dict(r) for r in records], default=str)

                        if len(output) > self.max_result_bytes:
                            span.set_attribute("db.truncated", True)
                            log.warning("result_truncated", session_id=session_id, bytes=len(output))
                            output = output[:self.max_result_bytes] + "\n... [RESULTS TRUNCATED]"

                        return output

            except asyncpg.PostgresError as exc:
                log.error("db_error", session_id=session_id, error=str(exc))
                span.record_exception(exc)
                span.set_status(trace.StatusCode.ERROR, f"Database error: {type(exc).__name__}")
                # Return a sanitised message — never expose DB internals to the agent
                return "ERROR: A database error occurred. Please check your query syntax."
