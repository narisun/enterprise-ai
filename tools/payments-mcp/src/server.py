"""
Payments MCP Server — bank payment transaction data via PostgreSQL.

Tool: get_payment_summary(client_name, days=90)
  Returns payment volumes by type, trend vs prior period,
  top counterparties, sending bank diversity, and party compliance profile.

Cache TTL: 3600s (1 hour) — payments data is loaded in nightly batches.
"""
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

import asyncpg
from mcp.server.fastmcp import FastMCP

from platform_sdk import MCPConfig, OpaClient, ToolResultCache, cached_tool, configure_logging, get_logger

configure_logging()
log = get_logger(__name__)

_config = MCPConfig.from_env()

# Cache initialised at module level so @cached_tool can capture it at decoration time.
_cache: Optional[ToolResultCache] = ToolResultCache.from_env(ttl_seconds=3600)
_opa: Optional[OpaClient] = None
_pool: Optional[asyncpg.Pool] = None

TRANSPORT = os.environ.get("MCP_TRANSPORT", "sse")
PORT = int(os.environ.get("PORT", 8082))


@asynccontextmanager
async def _lifespan(server: FastMCP):
    global _opa, _pool
    _opa = OpaClient(_config)
    _pool = await asyncpg.create_pool(
        host=os.environ.get("DB_HOST", "pgvector"),
        port=int(os.environ.get("DB_PORT", 5432)),
        user=os.environ.get("DB_USER", "admin"),
        password=os.environ.get("DB_PASS", ""),
        database=os.environ.get("DB_NAME", "ai_memory"),
        min_size=2,
        max_size=10,
    )
    log.info("payments_mcp_ready")
    yield
    await _pool.close()
    await _opa.aclose()


mcp = FastMCP("payments-mcp", lifespan=_lifespan, host="0.0.0.0", port=PORT)


async def _get_payment_summary_impl(client_name: str, days: int) -> str:
    """
    Core implementation — queries bankdw.fact_payments and bankdw.dim_party
    using the company name as the join key (matches sfcrm.Account.Name).

    Schema:
      bankdw.fact_payments  — TransactionID, TransactionDate, PayorName,
                               PayeeBank, TransactionType, Amount, Currency, Status
      bankdw.dim_party      — PartyName, KYCStatus, AMLRiskCategory,
                               RiskRating, SanctionsScreeningStatus, PEPFlag, ...
      bankdw.dim_bank       — BankName, SWIFTBIC, CountryCode, BSAAMLProgramRating
    """
    async with _pool.acquire() as conn:
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
              AND "TransactionDate" >= CURRENT_DATE - ($2 || ' days')::INTERVAL
            GROUP BY "TransactionType", "Currency"
            ORDER BY total DESC
            """,
            client_name,
            str(days),
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
              AND "TransactionDate" >= CURRENT_DATE - ($2 || ' days')::INTERVAL
            GROUP BY "TransactionType"
            ORDER BY total DESC
            """,
            client_name,
            str(days),
        )

        if not outbound and not inbound:
            return json.dumps({
                "error": "no_data",
                "client_name": client_name,
                "message": (
                    f"No completed payment transactions found for '{client_name}' "
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
              AND "TransactionDate" >= CURRENT_DATE - ($2 || ' days')::INTERVAL * 2
              AND "TransactionDate" <  CURRENT_DATE - ($2 || ' days')::INTERVAL
            """,
            client_name,
            str(days),
        )

        # 4. Top counterparties (where client is the payor)
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
              AND "TransactionDate" >= CURRENT_DATE - ($2 || ' days')::INTERVAL
            GROUP BY "PayeeName", "PayeeBank", "TransactionType", "Currency"
            ORDER BY total_usd DESC
            LIMIT 8
            """,
            client_name,
            str(days),
        )

        # 5. Transaction status mix (all statuses — reveals failed/pending %)
        status_mix = await conn.fetch(
            """
            SELECT "Status", COUNT(*) AS cnt, SUM("Amount") AS total
            FROM bankdw."fact_payments"
            WHERE ("PayorName" = $1 OR "PayeeName" = $1)
              AND "TransactionDate" >= CURRENT_DATE - ($2 || ' days')::INTERVAL
            GROUP BY "Status"
            ORDER BY cnt DESC
            """,
            client_name,
            str(days),
        )

        # 6. Payor bank diversity (which sending banks does the client use?)
        payor_banks = await conn.fetch(
            """
            SELECT "PayorBank" AS bank_name,
                   COUNT(*)    AS tx_count,
                   SUM("Amount") AS total
            FROM bankdw."fact_payments"
            WHERE "PayorName" = $1
              AND "Status" = 'Completed'
              AND "TransactionDate" >= CURRENT_DATE - ($2 || ' days')::INTERVAL
            GROUP BY "PayorBank"
            ORDER BY total DESC
            """,
            client_name,
            str(days),
        )

        # 7. Party compliance profile — fields visible per clearance level
        #    (col_mask applied at the PostgreSQL query result level
        #     by mcp_auth middleware when integrated)
        party = await conn.fetchrow(
            """
            SELECT "CustomerSegment"         AS segment,
                   "KYCStatus"               AS kyc_status,
                   "AMLRiskCategory"         AS aml_risk,
                   "RiskRating"              AS risk_rating,
                   "SanctionsScreeningStatus" AS sanctions_status,
                   "PEPFlag"                 AS pep_flag,
                   "FraudMonitoringSegment"  AS fraud_segment,
                   "RelationshipStartDate"::text AS relationship_since,
                   "CustomerStatus"          AS customer_status
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
        # Party compliance profile — fields may be null if caller lacks clearance
        "party_profile": {
            "segment": party["segment"] if party else None,
            "kyc_status": party["kyc_status"] if party else None,
            "aml_risk_category": party["aml_risk"] if party else None,
            "risk_rating": party["risk_rating"] if party else None,
            "sanctions_status": party["sanctions_status"] if party else None,
            "pep_flag": party["pep_flag"] if party else None,
            "fraud_segment": party["fraud_segment"] if party else None,
            "relationship_since": party["relationship_since"] if party else None,
            "customer_status": party["customer_status"] if party else None,
        } if party else None,
        "retrieved_at": datetime.utcnow().isoformat() + "Z",
    }
    return json.dumps(result, default=str)


@cached_tool(_cache)
async def _get_payment_summary_cached(client_name: str, days: int = 360) -> str:
    """Cached inner implementation — called only after OPA approves."""
    log.info("payments_tool_call", client=client_name, days=days)
    return await _get_payment_summary_impl(client_name, days)


@mcp.tool()
async def get_payment_summary(client_name: str, days: int = 360) -> str:
    """
    Get bank payment transaction summary for a client.

    Queries the bank data warehouse (bankdw schema) using the client's company
    name as the join key.  The company name must match exactly the value in
    bankdw.dim_party.PartyName, which equals sfcrm.Account.Name — so pass the
    account_name field from get_salesforce_summary output.

    Returns outbound/inbound volumes by payment rail (ACH/Wire/RTP), trend vs
    prior period, top counterparties, sending bank diversity, transaction status
    mix, and party compliance profile (fields visible per caller's clearance level).

    Args:
        client_name: Company name exactly as stored in Salesforce Account.Name
                     (e.g. 'Microsoft Corp.', 'Ford Motor Company').
                     Use the account_name field from get_salesforce_summary.
        days:        Look-back window in days. Default 90.

    Returns:
        JSON string with payment analytics, or error JSON if no data found.
    """
    if _opa is None:
        return "ERROR: Service not initialised — OPA client not ready."

    is_authorized = await _opa.authorize(
        "get_payment_summary", {"client_name": client_name, "days": days}
    )
    if not is_authorized:
        log.warning("opa_denied", tool="get_payment_summary", client=client_name)
        return "ERROR: Unauthorized. Execution blocked by policy engine."

    return await _get_payment_summary_cached(client_name=client_name, days=days)


if __name__ == "__main__":
    log.info("mcp_server_starting", transport=TRANSPORT)
    mcp.run(transport=TRANSPORT)
