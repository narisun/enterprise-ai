"""
Integration tests — bankdw SQL layer via direct asyncpg connection.

Verifies that the 7 queries used by get_payment_summary work correctly
against the seeded test database.  Does NOT go through the MCP server —
this layer tests pure SQL correctness and schema assumptions.

Requires: pgvector with docker-compose.test.yml test fixtures loaded.

Key regression: KeyError 'status' — ensures the status_mix query returns
a 'status' key (lowercase alias), not the unaliased 'Status' column.
"""
import pytest
import pytest_asyncio

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

# Known client from 31_test_bankdw_seed.sql
CLIENT_MICROSOFT = "Microsoft Corp."
CLIENT_FORD      = "Ford Motor Company"
CLIENT_UNKNOWN   = "NoSuchCompany_XYZ_DoesNotExist"
DAYS             = 360


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 1: Microsoft Corp. has payment data (seeded baseline)
# ─────────────────────────────────────────────────────────────────────────────

class TestOutboundQuery:
    async def test_returns_rows_for_microsoft(self, db_pool):
        rows = await db_pool.fetch(
            """
            SELECT "TransactionType" AS payment_type,
                   SUM("Amount")      AS total,
                   COUNT(*)           AS tx_count,
                   "Currency"         AS currency
            FROM bankdw."fact_payments"
            WHERE "PayorName" = $1
              AND "Status" = 'Completed'
              AND "TransactionDate" >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
            GROUP BY "TransactionType", "Currency"
            ORDER BY total DESC
            """,
            CLIENT_MICROSOFT, DAYS,
        )
        assert len(rows) > 0, "Microsoft Corp. should have outbound transactions in test data"

    async def test_total_is_positive(self, db_pool):
        rows = await db_pool.fetch(
            """
            SELECT SUM("Amount") AS total
            FROM bankdw."fact_payments"
            WHERE "PayorName" = $1 AND "Status" = 'Completed'
              AND "TransactionDate" >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
            """,
            CLIENT_MICROSOFT, DAYS,
        )
        total = float(rows[0]["total"] or 0)
        assert total > 0

    async def test_unknown_client_returns_empty(self, db_pool):
        rows = await db_pool.fetch(
            """
            SELECT COUNT(*) AS n FROM bankdw."fact_payments"
            WHERE "PayorName" = $1 AND "Status" = 'Completed'
              AND "TransactionDate" >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
            """,
            CLIENT_UNKNOWN, DAYS,
        )
        assert rows[0]["n"] == 0

    async def test_int_cast_interval_does_not_raise(self, db_pool):
        """Regression: asyncpg sends int as int8; $2::int forces int4 for INTERVAL."""
        # If the cast is missing this raises: "operator does not exist: bigint * interval"
        rows = await db_pool.fetch(
            "SELECT CURRENT_DATE - ($1::int * INTERVAL '1 day') AS cutoff",
            DAYS,
        )
        assert rows[0]["cutoff"] is not None


class TestInboundQuery:
    async def test_returns_rows_for_microsoft(self, db_pool):
        rows = await db_pool.fetch(
            """
            SELECT "TransactionType" AS payment_type,
                   SUM("Amount")      AS total,
                   COUNT(*)           AS tx_count
            FROM bankdw."fact_payments"
            WHERE "PayeeName" = $1
              AND "Status" = 'Completed'
              AND "TransactionDate" >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
            GROUP BY "TransactionType"
            ORDER BY total DESC
            """,
            CLIENT_MICROSOFT, DAYS,
        )
        # Inbound may be 0 rows depending on seed; just must not raise
        assert isinstance(rows, list)


class TestStatusMixQuery:
    """
    Regression test for KeyError: 'status'.
    The query must alias "Status" AS status (lowercase) for Python dict access.
    """
    async def test_status_key_lowercase(self, db_pool):
        rows = await db_pool.fetch(
            """
            SELECT "Status" AS status, COUNT(*) AS cnt, SUM("Amount") AS total
            FROM bankdw."fact_payments"
            WHERE ("PayorName" = $1 OR "PayeeName" = $1)
              AND "TransactionDate" >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
            GROUP BY "Status"
            ORDER BY cnt DESC
            """,
            CLIENT_MICROSOFT, DAYS,
        )
        assert len(rows) > 0, "Should have status rows for Microsoft"
        # This is the regression check — accessing r["status"] must not raise KeyError
        for row in rows:
            _ = row["status"]   # raises KeyError if alias is missing
            _ = row["cnt"]
            _ = row["total"]

    async def test_status_values_are_strings(self, db_pool):
        rows = await db_pool.fetch(
            """
            SELECT "Status" AS status FROM bankdw."fact_payments"
            WHERE "PayorName" = $1
            LIMIT 10
            """,
            CLIENT_MICROSOFT,
        )
        for row in rows:
            assert isinstance(row["status"], str)


class TestTopCounterpartiesQuery:
    async def test_returns_up_to_8_rows(self, db_pool):
        rows = await db_pool.fetch(
            """
            SELECT "PayeeName"       AS counterparty_name,
                   "PayeeBank"       AS counterparty_bank,
                   "TransactionType" AS payment_type,
                   "Currency"        AS currency,
                   SUM("Amount")     AS total_usd,
                   COUNT(*)          AS tx_count
            FROM bankdw."fact_payments"
            WHERE "PayorName" = $1
              AND "Status" = 'Completed'
              AND "TransactionDate" >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
            GROUP BY "PayeeName", "PayeeBank", "TransactionType", "Currency"
            ORDER BY total_usd DESC
            LIMIT 8
            """,
            CLIENT_MICROSOFT, DAYS,
        )
        assert len(rows) <= 8

    async def test_counterparty_name_column_present(self, db_pool):
        rows = await db_pool.fetch(
            """
            SELECT "PayeeName" AS counterparty_name
            FROM bankdw."fact_payments"
            WHERE "PayorName" = $1 AND "Status" = 'Completed'
            LIMIT 1
            """,
            CLIENT_MICROSOFT,
        )
        if rows:
            _ = rows[0]["counterparty_name"]


class TestPriorPeriodQuery:
    async def test_does_not_raise(self, db_pool):
        row = await db_pool.fetchrow(
            """
            SELECT SUM("Amount") AS total
            FROM bankdw."fact_payments"
            WHERE "PayorName" = $1
              AND "Status" = 'Completed'
              AND "TransactionDate" >= CURRENT_DATE - ($2::int * INTERVAL '1 day') * 2
              AND "TransactionDate" <  CURRENT_DATE - ($2::int * INTERVAL '1 day')
            """,
            CLIENT_MICROSOFT, DAYS,
        )
        # total may be None if no data in the prior period
        assert row is not None


class TestDimPartyQuery:
    async def test_microsoft_has_party_record(self, db_pool):
        row = await db_pool.fetchrow(
            """
            SELECT "CustomerSegment" AS segment,
                   "KYCStatus"       AS kyc_status,
                   "AMLRiskCategory" AS aml_risk
            FROM bankdw."dim_party"
            WHERE "PartyName" = $1
            LIMIT 1
            """,
            CLIENT_MICROSOFT,
        )
        assert row is not None, "Microsoft Corp. must have a dim_party record"

    async def test_unknown_client_returns_none(self, db_pool):
        row = await db_pool.fetchrow(
            "SELECT * FROM bankdw.\"dim_party\" WHERE \"PartyName\" = $1 LIMIT 1",
            CLIENT_UNKNOWN,
        )
        assert row is None

    async def test_party_has_kyc_status(self, db_pool):
        row = await db_pool.fetchrow(
            "SELECT \"KYCStatus\" AS kyc_status FROM bankdw.\"dim_party\" WHERE \"PartyName\" = $1",
            CLIENT_MICROSOFT,
        )
        if row:
            assert row["kyc_status"] is not None


class TestPayorBanksQuery:
    async def test_returns_banks(self, db_pool):
        rows = await db_pool.fetch(
            """
            SELECT "PayorBank" AS bank_name,
                   COUNT(*)    AS tx_count,
                   SUM("Amount") AS total
            FROM bankdw."fact_payments"
            WHERE "PayorName" = $1
              AND "Status" = 'Completed'
              AND "TransactionDate" >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
            GROUP BY "PayorBank"
            ORDER BY total DESC
            """,
            CLIENT_MICROSOFT, DAYS,
        )
        assert isinstance(rows, list)
        if rows:
            assert "bank_name" in rows[0].keys()
