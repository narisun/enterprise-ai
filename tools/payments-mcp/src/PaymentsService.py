"""Pure business logic for payment transaction queries.

Handles:
- SQL queries against bankdw schema (fact_payments, dim_party)
- Payment volume aggregation and trend analysis
- Compliance column masking
- Result formatting
"""
import asyncpg
import json
from datetime import datetime, timezone
from typing import Optional

_DEFAULT_DAYS = 360


def _apply_col_mask(record: Optional[dict], col_mask: list[str]) -> Optional[dict]:
    """Null out columns that the caller's clearance does not permit."""
    if record is None or not col_mask:
        return record
    return {k: (None if k in col_mask else v) for k, v in record.items()}


class PaymentsService:
    """Pure business logic for payment transaction queries."""

    def __init__(self, db_pool: asyncpg.Pool, max_result_bytes: int = 15_000) -> None:
        """
        Initialize the payments service.

        Args:
            db_pool: PostgreSQL connection pool.
            max_result_bytes: Maximum size of JSON output before truncation.
        """
        self.db_pool = db_pool
        self.max_result_bytes = max_result_bytes

    async def _resolve_client_name(self, conn, client_name: str) -> tuple[Optional[str], list[str]]:
        """Resolve a fuzzy client name to the exact PartyName in dim_party.

        Lookup order:
          1. Exact match (case-insensitive) on dim_party.PartyName
          2. ILIKE prefix match (e.g. "IBM" → "IBM Corp.")
          3. ILIKE substring match (e.g. "acme" → "Acme Corporation")

        Also checks fact_payments PayorName/PayeeName directly in case the party
        exists in transactions but not in dim_party.

        Returns:
            (resolved_name, similar_names):
              - resolved_name is the exact PartyName to use, or None if not found
              - similar_names is a list of close matches for suggestion
        """
        # Step 1: Exact match (case-insensitive)
        row = await conn.fetchrow(
            'SELECT "PartyName" FROM bankdw.dim_party WHERE lower("PartyName") = lower($1) LIMIT 1',
            client_name,
        )
        if row:
            return row["PartyName"], []

        # Step 2: ILIKE prefix match — handles "IBM" → "IBM Corp."
        rows = await conn.fetch(
            'SELECT DISTINCT "PartyName" FROM bankdw.dim_party WHERE "PartyName" ILIKE $1 ORDER BY "PartyName" LIMIT 5',
            f"{client_name}%",
        )
        if rows:
            # If exactly one match, use it; otherwise return as suggestions
            names = [r["PartyName"] for r in rows]
            if len(names) == 1:
                return names[0], []
            return names[0], names  # Use best match, but also show alternatives

        # Step 3: ILIKE substring match — handles partial names
        rows = await conn.fetch(
            'SELECT DISTINCT "PartyName" FROM bankdw.dim_party WHERE "PartyName" ILIKE $1 ORDER BY "PartyName" LIMIT 5',
            f"%{client_name}%",
        )
        if rows:
            names = [r["PartyName"] for r in rows]
            if len(names) == 1:
                return names[0], []
            return names[0], names

        # Step 4: Check fact_payments directly (party might not be in dim_party)
        row = await conn.fetchrow(
            """
            SELECT name FROM (
                SELECT DISTINCT "PayorName" AS name FROM bankdw.fact_payments WHERE "PayorName" ILIKE $1
                UNION
                SELECT DISTINCT "PayeeName" AS name FROM bankdw.fact_payments WHERE "PayeeName" ILIKE $1
            ) t ORDER BY name LIMIT 1
            """,
            f"%{client_name}%",
        )
        if row:
            return row["name"], []

        return None, []

    async def get_summary(self, client_name: str, col_mask: list[str], days: int = _DEFAULT_DAYS) -> str:
        """
        Get bank payment transaction summary for a client.

        All seven queries run inside a single REPEATABLE READ read-only transaction
        so the snapshot is consistent across the full request.

        Fuzzy name resolution: If the provided client_name is not an exact match,
        we attempt ILIKE prefix and substring matching against dim_party and
        fact_payments to find the closest match.

        Args:
            client_name: Company name (fuzzy matching supported).
            col_mask: List of column names to redact (compliance masking).
            days: Look-back window in days (default: 360).

        Returns:
            JSON string with payment analytics, or error JSON if no data found.
        """
        async with self.db_pool.acquire() as conn:
            async with conn.transaction(isolation="repeatable_read", readonly=True):

                # Resolve fuzzy client name to exact PartyName
                resolved_name, similar_names = await self._resolve_client_name(conn, client_name)
                if resolved_name is None:
                    return json.dumps({
                        "error": "client_not_found",
                        "message": (
                            f"No party found matching '{client_name}' in the payments database. "
                            "Try a different spelling or the full legal entity name."
                        ),
                        "searched_name": client_name,
                    })

                # Use the resolved exact name for all subsequent queries
                original_search = client_name
                client_name = resolved_name
                executed_sql: list[str] = []  # Track SQL for transparency

                # 1. Outbound volume by payment rail (client as Payor)
                outbound = await conn.fetch(
                    """
                    SELECT "TransactionType"  AS payment_type,
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
                    client_name,
                    days,
                )

                # 2. Inbound volume (client as Payee)
                inbound = await conn.fetch(
                    """
                    SELECT "TransactionType"  AS payment_type,
                           SUM("Amount")      AS total,
                           COUNT(*)           AS tx_count
                    FROM bankdw."fact_payments"
                    WHERE "PayeeName" = $1
                      AND "Status" = 'Completed'
                      AND "TransactionDate" >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
                    GROUP BY "TransactionType"
                    ORDER BY total DESC
                    """,
                    client_name,
                    days,
                )

                if not outbound and not inbound:
                    return json.dumps({
                        "error": "no_data",
                        "message": (
                            "No completed payment transactions found for the requested client "
                            f"in the last {days} days. "
                            "Verify the client name matches the bank party name exactly."
                        ),
                    })

                # 3. Prior period outbound — for trend calculation
                prior = await conn.fetchrow(
                    """
                    SELECT SUM("Amount") AS total
                    FROM bankdw."fact_payments"
                    WHERE "PayorName" = $1
                      AND "Status" = 'Completed'
                      AND "TransactionDate" >= CURRENT_DATE - ($2::int * INTERVAL '1 day') * 2
                      AND "TransactionDate" <  CURRENT_DATE - ($2::int * INTERVAL '1 day')
                    """,
                    client_name,
                    days,
                )

                # 4. Top counterparties
                top_counterparties = await conn.fetch(
                    """
                    SELECT "PayeeName"        AS counterparty_name,
                           "PayeeBank"        AS counterparty_bank,
                           "TransactionType"  AS payment_type,
                           "Currency"         AS currency,
                           SUM("Amount")      AS total_usd,
                           COUNT(*)           AS tx_count
                    FROM bankdw."fact_payments"
                    WHERE "PayorName" = $1
                      AND "Status" = 'Completed'
                      AND "TransactionDate" >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
                    GROUP BY "PayeeName", "PayeeBank", "TransactionType", "Currency"
                    ORDER BY total_usd DESC
                    LIMIT 8
                    """,
                    client_name,
                    days,
                )

                # 5. Transaction status mix
                status_mix = await conn.fetch(
                    """
                    SELECT "Status" AS status, COUNT(*) AS cnt, SUM("Amount") AS total
                    FROM bankdw."fact_payments"
                    WHERE ("PayorName" = $1 OR "PayeeName" = $1)
                      AND "TransactionDate" >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
                    GROUP BY "Status"
                    ORDER BY cnt DESC
                    """,
                    client_name,
                    days,
                )

                # 6. Payor bank diversity
                payor_banks = await conn.fetch(
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
                    client_name,
                    days,
                )

                # 7. Party compliance profile — col_mask applied below
                party = await conn.fetchrow(
                    """
                    SELECT "CustomerSegment"          AS segment,
                           "KYCStatus"                AS kyc_status,
                           "AMLRiskCategory"          AS aml_risk,
                           "RiskRating"               AS risk_rating,
                           "SanctionsScreeningStatus" AS sanctions_status,
                           "PEPFlag"                  AS pep_flag,
                           "FraudMonitoringSegment"   AS fraud_segment,
                           "RelationshipStartDate"::text AS relationship_since,
                           "CustomerStatus"           AS customer_status
                    FROM bankdw."dim_party"
                    WHERE "PartyName" = $1
                    LIMIT 1
                    """,
                    client_name,
                )

        # ── Aggregate ────────────────────────────────────────────────────────────
        total_out = sum(float(r["total"]) for r in outbound)
        total_in  = sum(float(r["total"]) for r in inbound)

        by_type: dict = {}
        for r in outbound:
            pt = r["payment_type"]
            by_type.setdefault(pt, {"outbound_usd": 0.0, "inbound_usd": 0.0, "tx_count": 0})
            by_type[pt]["outbound_usd"] += float(r["total"])
            by_type[pt]["tx_count"] += r["tx_count"]
        for r in inbound:
            pt = r["payment_type"]
            by_type.setdefault(pt, {"outbound_usd": 0.0, "inbound_usd": 0.0, "tx_count": 0})
            by_type[pt]["inbound_usd"] += float(r["total"])

        prior_total = float(prior["total"] or 0) if prior and prior["total"] else 0.0
        trend_pct = None
        trend_label = "STABLE"
        if prior_total > 0:
            trend_pct = round(((total_out - prior_total) / prior_total) * 100, 1)
            trend_label = "INCREASING" if trend_pct > 5 else ("DECLINING" if trend_pct < -5 else "STABLE")

        # Apply column mask to compliance fields before including in response
        party_dict = dict(party) if party else None
        masked_party = _apply_col_mask(party_dict, col_mask)

        # Build representative SQL for transparency / UI display
        _sql_queries = [
            (
                f'-- Outbound payment volume by rail\n'
                f'SELECT "TransactionType", SUM("Amount") AS total, COUNT(*) AS tx_count, "Currency"\n'
                f'FROM bankdw."fact_payments"\n'
                f"WHERE \"PayorName\" = '{client_name}'\n"
                f"  AND \"Status\" = 'Completed'\n"
                f"  AND \"TransactionDate\" >= CURRENT_DATE - INTERVAL '{days} days'\n"
                f'GROUP BY "TransactionType", "Currency"\nORDER BY total DESC'
            ),
            (
                f'-- Inbound payment volume\n'
                f'SELECT "TransactionType", SUM("Amount") AS total, COUNT(*) AS tx_count\n'
                f'FROM bankdw."fact_payments"\n'
                f"WHERE \"PayeeName\" = '{client_name}'\n"
                f"  AND \"Status\" = 'Completed'\n"
                f"  AND \"TransactionDate\" >= CURRENT_DATE - INTERVAL '{days} days'\n"
                f'GROUP BY "TransactionType"\nORDER BY total DESC'
            ),
            (
                f'-- Top counterparties\n'
                f'SELECT "PayeeName", "PayeeBank", "TransactionType", SUM("Amount") AS total_usd, COUNT(*) AS tx_count\n'
                f'FROM bankdw."fact_payments"\n'
                f"WHERE \"PayorName\" = '{client_name}'\n"
                f"  AND \"Status\" = 'Completed'\n"
                f"  AND \"TransactionDate\" >= CURRENT_DATE - INTERVAL '{days} days'\n"
                f'GROUP BY "PayeeName", "PayeeBank", "TransactionType"\nORDER BY total_usd DESC\nLIMIT 8'
            ),
            (
                f'-- Party compliance profile\n'
                f'SELECT "CustomerSegment", "KYCStatus", "AMLRiskCategory", "RiskRating",\n'
                f'       "SanctionsScreeningStatus", "PEPFlag", "FraudMonitoringSegment",\n'
                f'       "RelationshipStartDate", "CustomerStatus"\n'
                f'FROM bankdw."dim_party"\n'
                f"WHERE \"PartyName\" = '{client_name}'\nLIMIT 1"
            ),
        ]

        result = {
            "client_name": client_name,
            **({"searched_as": original_search, "other_matches": similar_names} if original_search.lower() != client_name.lower() else {}),
            "period_days": days,
            "total_outbound_usd": round(total_out, 2),
            "total_inbound_usd": round(total_in, 2),
            "by_payment_type": by_type,
            "volume_trend_pct": trend_pct,
            "trend_label": trend_label,
            "sending_banks": [
                {"bank": r["bank_name"], "tx_count": r["tx_count"], "total_usd": round(float(r["total"]), 2)}
                for r in payor_banks
            ],
            "transaction_status_mix": [
                {"status": r["status"], "count": r["cnt"], "total_usd": round(float(r["total"] or 0), 2)}
                for r in status_mix
            ],
            "top_counterparties": [
                {
                    "name": r["counterparty_name"],
                    "bank": r["counterparty_bank"],
                    "payment_type": r["payment_type"],
                    "currency": r["currency"],
                    "total_usd": round(float(r["total_usd"]), 2),
                    "tx_count": r["tx_count"],
                }
                for r in top_counterparties
            ],
            "party_profile": {
                "segment":             masked_party.get("segment") if masked_party else None,
                "kyc_status":          masked_party.get("kyc_status") if masked_party else None,
                "aml_risk_category":   masked_party.get("aml_risk") if masked_party else None,
                "risk_rating":         masked_party.get("risk_rating") if masked_party else None,
                "sanctions_status":    masked_party.get("sanctions_status") if masked_party else None,
                "pep_flag":            masked_party.get("pep_flag") if masked_party else None,
                "fraud_segment":       masked_party.get("fraud_segment") if masked_party else None,
                "relationship_since":  masked_party.get("relationship_since") if masked_party else None,
                "customer_status":     masked_party.get("customer_status") if masked_party else None,
            } if masked_party else None,
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
            "_sql_queries": _sql_queries,
        }

        output = json.dumps(result, default=str)

        # Enforce result size limit
        if len(output) > self.max_result_bytes:
            output = output[:self.max_result_bytes] + "\n... [RESULTS TRUNCATED]"

        return output
