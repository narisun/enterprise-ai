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

    async def get_summary(self, client_name: str, col_mask: list[str], days: int = _DEFAULT_DAYS) -> str:
        """
        Get bank payment transaction summary for a client.

        All seven queries run inside a single REPEATABLE READ read-only transaction
        so the snapshot is consistent across the full request.

        Args:
            client_name: Company name as stored in bankdw.dim_party.PartyName.
            col_mask: List of column names to redact (compliance masking).
            days: Look-back window in days (default: 360).

        Returns:
            JSON string with payment analytics, or error JSON if no data found.
        """
        async with self.db_pool.acquire() as conn:
            async with conn.transaction(isolation="repeatable_read", readonly=True):

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

        result = {
            "client_name": client_name,
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
        }

        output = json.dumps(result, default=str)

        # Enforce result size limit
        if len(output) > self.max_result_bytes:
            output = output[:self.max_result_bytes] + "\n... [RESULTS TRUNCATED]"

        return output
