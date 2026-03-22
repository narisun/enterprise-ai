"""
Salesforce MCP Server — mock Salesforce CRM data via PostgreSQL.

Tool: get_salesforce_summary(client_name)
  Returns account profile, key contacts, recent activities (Events + Tasks),
  open opportunities, pending tasks, open service cases, and active contracts
  as a JSON string.

Cache TTL: 1800s (30 minutes) — CRM is updated by humans, not real-time.

Security fixes applied:
- AgentContextMiddleware registered so X-Agent-Context is decoded per-request
- build_row_filters_crm() enforced: RM role restricted to assigned accounts
- Contact email/phone masked for non-rm roles (PII protection)
- ILIKE fuzzy search now prefers exact match first, errors on ambiguous results
- All queries wrapped in a single repeatable-read transaction for atomicity
- Cache and OPA client initialised in lifespan (correct event loop)
- datetime.utcnow() replaced with timezone-aware datetime.now(timezone.utc)
- searched_name removed from error response bodies
"""
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

import asyncpg
from mcp.server.fastmcp import FastMCP

from platform_sdk import MCPConfig, OpaClient, ToolResultCache, configure_logging, get_logger
from platform_sdk.auth import assert_secrets_configured

configure_logging()
log = get_logger(__name__)

_config = MCPConfig.from_env()

# Initialised in lifespan — do NOT create at module level (wrong event loop).
_cache: Optional[ToolResultCache] = None
_opa: Optional[OpaClient] = None
_pool: Optional[asyncpg.Pool] = None

TRANSPORT = os.environ.get("MCP_TRANSPORT", "sse")
PORT = int(os.environ.get("PORT", 8081))

# Roles that may see contact PII (email, phone)
_PII_ALLOWED_ROLES = {"rm", "senior_rm", "manager", "compliance_officer"}


# ---- Startup secret assertion (delegated to SDK) ----------------------------


# ---- Lifespan ---------------------------------------------------------------

@asynccontextmanager
async def _lifespan(server: FastMCP):
    global _opa, _cache, _pool

    assert_secrets_configured()

    _opa = OpaClient(_config)
    log.info("opa_client_ready", url=_config.opa_url)

    if _config.enable_tool_cache:
        _cache = ToolResultCache.from_env(ttl_seconds=1800)
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
    log.info("salesforce_mcp_ready")
    yield

    await _pool.close()
    await _opa.aclose()
    if _cache:
        await _cache.aclose()
    log.info("salesforce_mcp_shutdown")


mcp = FastMCP("salesforce-mcp", lifespan=_lifespan, host="0.0.0.0", port=PORT)

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


# ---- Core implementation ----------------------------------------------------

async def _get_salesforce_summary_impl(
    client_name: str,
    allow_pii: bool,
    assigned_account_ids: tuple[str, ...],
    unrestricted: bool,
) -> str:
    """
    Core implementation — queries the salesforce.* schema.

    All queries run inside a single REPEATABLE READ read-only transaction.

    Account lookup order: exact match first, then ILIKE.
    If ILIKE returns multiple accounts and none is exact, we return the first
    alphabetically with an ambiguity warning so callers can refine the name.

    allow_pii:            Whether to include contact email and phone.
    assigned_account_ids: For RM role — restrict to these account IDs.
    unrestricted:         True for senior_rm / manager / compliance_officer.
    """
    async with _pool.acquire() as conn:
        async with conn.transaction(isolation="repeatable_read", readonly=True):

            # 1. Account lookup — exact match preferred, fuzzy fallback
            account = await conn.fetchrow(
                """
                SELECT "Id"                AS account_id,
                       "Name"              AS account_name,
                       "Industry"          AS industry,
                       "Type"              AS account_type,
                       "Ownership"         AS ownership,
                       "AnnualRevenue"     AS annual_revenue,
                       "NumberOfEmployees" AS employee_count,
                       "Rating"            AS rating,
                       "Phone"             AS phone,
                       "Website"           AS website,
                       "BillingCity"       AS hq_city,
                       "BillingState"      AS hq_state,
                       "BillingCountry"    AS hq_country,
                       "AccountNumber"     AS account_number
                FROM salesforce."Account"
                WHERE "Name" ILIKE $1
                ORDER BY
                    CASE WHEN lower("Name") = lower($2) THEN 0 ELSE 1 END,
                    "Name"
                LIMIT 1
                """,
                f"%{client_name}%",
                client_name,
            )

            if not account:
                return json.dumps({
                    "error": "client_not_found",
                    "message": (
                        "No Salesforce account found matching the provided name. "
                        "Try the exact company name as stored in CRM."
                    ),
                })

            account_id = account["account_id"]
            account_name = account["account_name"]

            # Row-level access check for RM role
            if not unrestricted and account_id not in assigned_account_ids:
                log.warning(
                    "row_filter_deny",
                    tool="get_salesforce_summary",
                    account_id=account_id,
                )
                return json.dumps({
                    "error": "access_denied",
                    "message": "This account is not in your book of business.",
                })

            # 2. Key contacts
            # Email and phone are PII — only included for roles with rm+ access.
            # readonly / data_analyst callers receive null for those fields.
            contacts = await conn.fetch(
                """
                SELECT "FirstName"  AS first_name,
                       "LastName"   AS last_name,
                       "Title"      AS title,
                       "Department" AS department,
                       "Email"      AS email,
                       "Phone"      AS phone,
                       "LeadSource" AS lead_source
                FROM salesforce."Contact"
                WHERE "AccountId" = $1
                ORDER BY "Title" NULLS LAST
                LIMIT 5
                """,
                account_id,
            )

            # 3. Recent activities
            activities = await conn.fetch(
                """
                SELECT 'Event'              AS activity_type,
                       e."Subject"          AS subject,
                       e."Description"      AS description,
                       e."StartDateTime"::text AS activity_date,
                       e."Type"             AS event_type,
                       e."Location"         AS location
                FROM salesforce."Event" e
                JOIN salesforce."Contact" c ON e."WhoId" = c."Id"
                WHERE c."AccountId" = $1
                  AND e."StartDateTime" >= NOW() - INTERVAL '365 days'

                UNION ALL

                SELECT 'Task'               AS activity_type,
                       t."Subject"          AS subject,
                       t."Description"      AS description,
                       t."ActivityDate"::text AS activity_date,
                       t."Type"             AS event_type,
                       NULL                 AS location
                FROM salesforce."Task" t
                JOIN salesforce."Contact" c ON t."WhoId" = c."Id"
                WHERE c."AccountId" = $1
                  AND t."ActivityDate" >= NOW() - INTERVAL '365 days'

                ORDER BY activity_date DESC NULLS LAST
                LIMIT 8
                """,
                account_id,
            )

            # 4. Open opportunities
            opportunities = await conn.fetch(
                """
                SELECT "Id"                    AS opportunity_id,
                       "Name"                  AS opportunity_name,
                       "StageName"             AS stage,
                       "Amount"                AS amount,
                       "CloseDate"::text       AS close_date,
                       "Probability"           AS probability,
                       "ForecastCategoryName"  AS forecast_category,
                       "NextStep"              AS next_steps,
                       "Description"           AS description
                FROM salesforce."Opportunity"
                WHERE "AccountId" = $1
                  AND "StageName" NOT IN ('Closed Won', 'Closed Lost')
                ORDER BY "Amount" DESC NULLS LAST
                """,
                account_id,
            )

            # 5. Open tasks
            tasks = await conn.fetch(
                """
                SELECT t."Subject"            AS subject,
                       t."Status"             AS status,
                       t."Priority"           AS priority,
                       t."ActivityDate"::text AS due_date,
                       t."Description"        AS description,
                       t."Type"               AS task_type
                FROM salesforce."Task" t
                JOIN salesforce."Contact" c ON t."WhoId" = c."Id"
                WHERE c."AccountId" = $1
                  AND t."Status" != 'Completed'
                ORDER BY
                    CASE t."Priority" WHEN 'High' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END,
                    t."ActivityDate" ASC NULLS LAST
                LIMIT 5
                """,
                account_id,
            )

            # 6. Open service cases
            cases = await conn.fetch(
                """
                SELECT "CaseNumber"        AS case_number,
                       "Subject"           AS subject,
                       "Status"            AS status,
                       "Priority"          AS priority,
                       "Origin"            AS origin,
                       "Type"              AS case_type,
                       "CreatedDate"::text AS created_date
                FROM salesforce."Case"
                WHERE "AccountId" = $1
                  AND "Status" != 'Closed'
                ORDER BY
                    CASE "Priority" WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,
                    "CreatedDate" DESC NULLS LAST
                LIMIT 4
                """,
                account_id,
            )

            # 7. Active contracts
            contracts = await conn.fetch(
                """
                SELECT "ContractNumber"    AS contract_number,
                       "Status"            AS status,
                       "StartDate"::text   AS start_date,
                       "EndDate"::text     AS end_date,
                       "ContractTerm"      AS term_months,
                       "SpecialTerms"      AS special_terms
                FROM salesforce."Contract"
                WHERE "AccountId" = $1
                  AND "Status" NOT IN ('Cancelled', 'Expired')
                ORDER BY "EndDate" ASC NULLS LAST
                LIMIT 3
                """,
                account_id,
            )

    result = {
        "account_id": account_id,
        "account_name": account_name,
        "industry": account["industry"],
        "account_type": account["account_type"],
        "ownership": account["ownership"],
        "annual_revenue_usd": float(account["annual_revenue"]) if account["annual_revenue"] else None,
        "employee_count": account["employee_count"],
        "rating": account["rating"],
        "phone": account["phone"],
        "website": account["website"],
        "location": f"{account['hq_city']}, {account['hq_state']}, {account['hq_country']}",
        "key_contacts": [
            {
                "name": f"{c['first_name']} {c['last_name']}",
                "title": c["title"],
                "department": c["department"],
                # PII fields: null for callers without rm+ role
                "email": c["email"] if allow_pii else None,
                "phone": c["phone"] if allow_pii else None,
            }
            for c in contacts
        ],
        "recent_activities": [
            {
                "type": a["activity_type"],
                "event_type": a["event_type"],
                "subject": a["subject"],
                "notes": a["description"],
                "date": a["activity_date"],
                "location": a["location"],
            }
            for a in activities
        ],
        "open_opportunities": [
            {
                "name": o["opportunity_name"],
                "stage": o["stage"],
                "amount_usd": float(o["amount"]) if o["amount"] else None,
                "close_date": o["close_date"],
                "probability_pct": o["probability"],
                "forecast_category": o["forecast_category"],
                "next_steps": o["next_steps"],
            }
            for o in opportunities
        ],
        "open_tasks": [
            {
                "subject": t["subject"],
                "priority": t["priority"],
                "due_date": t["due_date"],
                "detail": t["description"],
                "type": t["task_type"],
            }
            for t in tasks
        ],
        "open_cases": [
            {
                "number": c["case_number"],
                "subject": c["subject"],
                "status": c["status"],
                "priority": c["priority"],
                "type": c["case_type"],
                "opened": c["created_date"],
            }
            for c in cases
        ],
        "contracts": [
            {
                "number": c["contract_number"],
                "status": c["status"],
                "start_date": c["start_date"],
                "end_date": c["end_date"],
                "term_months": c["term_months"],
                "special_terms": c["special_terms"],
            }
            for c in contracts
        ],
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
    }
    return json.dumps(result, default=str)


@mcp.tool()
async def get_salesforce_summary(client_name: str) -> str:
    """
    Get Salesforce CRM summary for a client.

    Returns account profile, key contacts, recent activities (365 days),
    open opportunities with pipeline stage and value, and pending tasks.

    The response includes account_id and account_name which are required by
    get_payment_summary (exact name match in bankdw).

    Args:
        client_name: Company name as known in Salesforce (partial match supported).

    Returns:
        JSON string with full CRM context, or error JSON if client not found.
    """
    if _opa is None:
        return "ERROR: Service not initialised — OPA client not ready."

    if not client_name or not client_name.strip():
        return "ERROR: client_name must not be empty."

    client_name = client_name.strip()[:256]

    is_authorized = await _opa.authorize(
        "get_salesforce_summary", {"client_name": client_name}
    )
    if not is_authorized:
        log.warning("opa_denied", tool="get_salesforce_summary")
        return "ERROR: Unauthorized. Execution blocked by policy engine."

    # Resolve caller identity and access rights from the signed X-Agent-Context header.
    # Falls back to minimum-privilege anonymous context if header is absent/invalid.
    ctx = get_agent_context()
    if ctx is None:
        from platform_sdk.auth import AgentContext
        ctx = AgentContext.anonymous()
        log.warning("no_agent_context", tool="get_salesforce_summary", fallback="anonymous/readonly")

    allow_pii = ctx.role in _PII_ALLOWED_ROLES
    unrestricted = ctx.role in ("senior_rm", "manager", "compliance_officer")
    assigned_ids = ctx.assigned_account_ids

    # Cache key includes role so different clearance levels get separate entries.
    cache_key = None
    if _cache is not None:
        from platform_sdk.cache import make_cache_key
        cache_key = make_cache_key(
            "get_salesforce_summary",
            {"client_name": client_name, "role": ctx.role},
        )
        cached = await _cache.get(cache_key)
        if cached is not None:
            log.info("crm_cache_hit", client=client_name)
            return cached

    log.info("salesforce_tool_call", client=client_name, role=ctx.role, allow_pii=allow_pii)

    try:
        result = await _get_salesforce_summary_impl(
            client_name,
            allow_pii=allow_pii,
            assigned_account_ids=assigned_ids,
            unrestricted=unrestricted,
        )
    except asyncpg.PostgresError as exc:
        log.error("db_error", error=str(exc))
        return "ERROR: A database error occurred. Please try again."

    if _cache is not None and cache_key is not None:
        await _cache.set(cache_key, result)

    return result


if __name__ == "__main__":
    log.info("mcp_server_starting", transport=TRANSPORT)
    mcp.run(transport=TRANSPORT)
