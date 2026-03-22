"""
Payments MCP Server — bank payment transaction data via PostgreSQL.

Tool: get_payment_summary(client_name)
  Returns payment volumes by type, trend vs prior period,
  top counterparties, sending bank diversity, and party compliance profile.

  Look-back window is fixed at _DEFAULT_DAYS (360 days).  The days parameter
  was removed from the public tool interface to avoid LLM type-coercion errors
  (asyncpg int8 vs PostgreSQL int4).  It can be re-exposed later when needed.

Cache TTL: 3600s (1 hour) — payments data is loaded in nightly batches.

Security fixes applied:
- AgentContextMiddleware registered so X-Agent-Context is decoded per-request
- build_col_mask() called to redact compliance columns per caller clearance
- build_row_filters_payments() called and enforced for RM role
- ($2 || ' days')::INTERVAL replaced with ($2::int * INTERVAL '1 day') safe cast
- days parameter removed from public interface (hardcoded to _DEFAULT_DAYS)
- max_result_bytes enforced (truncation with marker)
- All 7 queries wrapped in a single repeatable-read transaction for atomicity
- datetime.utcnow() replaced with timezone-aware datetime.now(timezone.utc)
- client_name removed from error response bodies
"""
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

import asyncpg
from mcp.server.fastmcp import FastMCP

from platform_sdk import MCPConfig, OpaClient, ToolResultCache, cached_tool, configure_logging, get_logger
from platform_sdk.auth import assert_secrets_configured

configure_logging()
log = get_logger(__name__)

_config = MCPConfig.from_env()

# Initialised in lifespan — do NOT create at module level (wrong event loop).
_cache: Optional[ToolResultCache] = None
_opa: Optional[OpaClient] = None
_pool: Optional[asyncpg.Pool] = None

TRANSPORT = os.environ.get("MCP_TRANSPORT", "sse")
PORT = int(os.environ.get("PORT", 8082))

# ---- Look-back window -------------------------------------------------------
#
# Fixed at 360 days.  The days parameter was removed from the public tool
# interface to avoid asyncpg int8 vs PostgreSQL int4 type-coercion errors.
# Re-expose as a parameter when needed — the internal impl already accepts it.

_DEFAULT_DAYS = 360


# ---- Startup secret assertion (delegated to SDK) ----------------------------


# ---- Lifespan ---------------------------------------------------------------

@asynccontextmanager
async def _lifespan(server: FastMCP):
    global _opa, _cache, _pool

    assert_secrets_configured()

    _opa = OpaClient(_config)
    log.info("opa_client_ready", url=_config.opa_url)

    if _config.enable_tool_cache:
        _cache = ToolResultCache.from_env(ttl_seconds=3600)
        log.info("tool_cache_ready")

    _pool = await asyncpg.create_pool(
        host=os.environ.get("DB_HOST", "pgvector"),
        port=int(os.environ.get("DB_PORT", 5432)),
        user=os.environ.get("DB_USER", "admin"),
        password=os.environ.get("DB_PASS", ""),
        database=os.environ.get("DB_NAME", "ai_memory"),
        ssl="require" if os.environ.get("DB_REQUIRE_SSL", "false").lower() == "true" else None,
        min_size=2,
        max_size=10,
        statement_cache_size=_config.statement_cache_size,
    )
    log.info("payments_mcp_ready")
    yield

    await _pool.close()
    await _opa.aclose()
    if _cache:
        await _cache.aclose()
    log.info("payments_mcp_shutdown")


mcp = FastMCP("payments-mcp", lifespan=_lifespan, host="0.0.0.0", port=PORT)

# Register the AgentContext middleware so X-Agent-Context is decoded on every
# request and stored in a ContextVar for tool handlers to read.
#
# FastMCP (1.x) has no _app attribute at module load time — the Starlette app
# is created lazily by sse_app() when the server starts.  We patch sse_app()
# so our middleware is added to the Starlette app before uvicorn receives it.
from tools_shared.mcp_auth import AgentContextMiddleware, get_agent_context  # noqa: E402

if TRANSPORT == "sse":
    _orig_sse_app = mcp.sse_app

    def _patched_sse_app(mount_path=None):
        starlette_app = _orig_sse_app(mount_path)
        starlette_app.add_middleware(AgentContextMiddleware)
        return starlette_app

    mcp.sse_app = _patched_sse_app


# ---- Column masking helper --------------------------------------------------

def _apply_col_mask(record: Optional[dict], col_mask: list[str]) -> Optional[dict]:
    """Null out columns that the caller's clearance does not permit."""
    if record is None or not col_mask:
        return record
    return {k: (None if k in col_mask else v) for k, v in record.items()}


# ---- Core implementation ----------------------------------------------------

async def _get_payment_summary_impl(client_name: str, days: int, col_mask: list[str]) -> str:
    """
    Core implementation — queries bankdw.fact_payments and bankdw.dim_party.

    All seven queries run inside a single REPEATABLE READ read-only transaction
    so the snapshot is consistent across the full request.

    The days parameter is cast to int4 via $2::int before being multiplied by
    INTERVAL '1 day'.  asyncpg sends Python int as int8 (bigint) by default,
    and PostgreSQL has no bigint * interval operator — the explicit cast to
    int4 is required for the multiplication to resolve correctly.
    """
    async with _pool.acquire() as conn:
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

    # Enforce result size limit (was defined in config but never applied)
    if len(output) > _config.max_result_bytes:
        log.warning("result_truncated", bytes=len(output), limit=_config.max_result_bytes)
        output = output[:_config.max_result_bytes] + "\n... [RESULTS TRUNCATED]"

    return output


@mcp.tool()
async def get_payment_summary(client_name: str) -> str:
    """
    Get bank payment transaction summary for a client.

    Queries the bank data warehouse (bankdw schema) using the client's company
    name as the join key.  The company name must match exactly the value in
    bankdw.dim_party.PartyName, which equals sfcrm.Account.Name — so pass the
    account_name field from get_salesforce_summary output.

    Returns outbound/inbound volumes by payment rail (ACH/Wire/RTP), trend vs
    prior period, top counterparties, sending bank diversity, transaction status
    mix, and party compliance profile (fields visible per caller's clearance level).

    The look-back window is fixed at 360 days.

    Args:
        client_name: Company name exactly as stored in Salesforce Account.Name.
                     Use the account_name field from get_salesforce_summary.

    Returns:
        JSON string with payment analytics, or error JSON if no data found.
    """
    days = _DEFAULT_DAYS

    if _opa is None:
        return "ERROR: Service not initialised — OPA client not ready."

    if not client_name or not client_name.strip():
        return "ERROR: client_name must not be empty."

    # Truncate excessively long client names (defence against log/cache abuse)
    client_name = client_name.strip()[:256]

    is_authorized = await _opa.authorize(
        "get_payment_summary", {"client_name": client_name}
    )
    if not is_authorized:
        log.warning("opa_denied", tool="get_payment_summary")
        return "ERROR: Unauthorized. Execution blocked by policy engine."

    # Resolve column mask from the per-request AgentContext.
    # If no valid signed context header is present, get_agent_context() returns
    # None (middleware falls through to no-context) so we use anonymous()
    # which now grants minimum privilege — all compliance columns are masked.
    ctx = get_agent_context()
    if ctx is None:
        from platform_sdk.auth import AgentContext
        ctx = AgentContext.anonymous()
        log.warning("no_agent_context", tool="get_payment_summary", fallback="anonymous/readonly")

    col_mask = ctx.build_col_mask()

    # Row-level filter for standard RM role
    row_filters = ctx.build_row_filters_payments(party_names=[client_name])
    if row_filters.get("fact_payments") == ["__DENY_ALL__"]:
        log.warning("row_filter_deny", tool="get_payment_summary", role=ctx.role)
        return "ERROR: Unauthorized. You do not have access to payment data for this client."

    # Cache key includes the col_mask so different clearance levels get
    # separate entries (a compliance_full user must not get an rm-masked entry).
    col_mask_key = ",".join(sorted(col_mask))

    if _cache is not None:
        from platform_sdk.cache import make_cache_key
        cache_key = make_cache_key(
            "get_payment_summary",
            {"client_name": client_name, "col_mask_key": col_mask_key},
        )
        cached = await _cache.get(cache_key)
        if cached is not None:
            log.info("payments_cache_hit", client=client_name)
            return cached

    log.info("payments_tool_call", client=client_name, days=days, role=ctx.role)

    try:
        result = await _get_payment_summary_impl(client_name, days, col_mask)
    except asyncpg.PostgresError as exc:
        # Log full details server-side; return a safe message to the agent
        log.error("db_postgres_error", exc_type=type(exc).__name__, error=str(exc))
        return "ERROR: A database error occurred. Please check your query syntax."
    except asyncpg.InterfaceError as exc:
        log.error("db_interface_error", exc_type=type(exc).__name__, error=str(exc))
        return "ERROR: A database connection error occurred. Please try again."
    except Exception as exc:
        log.error(
            "payments_unexpected_error",
            exc_type=type(exc).__name__,
            error=str(exc),
            exc_info=True,
        )
        return "ERROR: An unexpected error occurred. Please try again."

    # Cache the result
    if _cache is not None:
        await _cache.set(cache_key, result)

    return result


if __name__ == "__main__":
    log.info("mcp_server_starting", transport=TRANSPORT)
    mcp.run(transport=TRANSPORT)
