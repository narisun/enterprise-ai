"""
Salesforce MCP Server — mock Salesforce CRM data via PostgreSQL.

Tool: get_salesforce_summary(client_name)
  Returns account profile, key contacts, recent activities (Events + Tasks),
  open opportunities, pending tasks, open service cases, and active contracts
  as a JSON string.

Cache TTL: 1800s (30 minutes) — CRM is updated by humans, not real-time.
"""
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

import asyncpg
from mcp.server.fastmcp import FastMCP

from platform_sdk import MCPConfig, ToolResultCache, cached_tool, configure_logging, get_logger

configure_logging()
log = get_logger(__name__)

_config = MCPConfig.from_env()
_cache: Optional[ToolResultCache] = None
_pool: Optional[asyncpg.Pool] = None

TRANSPORT = os.environ.get("MCP_TRANSPORT", "sse")
PORT = int(os.environ.get("PORT", 8081))


# Lifespan must accept the FastMCP server instance as its argument.
# It is passed to the constructor, not assigned afterwards.
@asynccontextmanager
async def _lifespan(server: FastMCP):
    global _cache, _pool
    _cache = ToolResultCache.from_env(ttl_seconds=1800)
    _pool = await asyncpg.create_pool(
        host=os.environ.get("DB_HOST", "pgvector"),
        port=int(os.environ.get("DB_PORT", 5432)),
        user=os.environ.get("DB_USER", "admin"),
        password=os.environ.get("DB_PASS", ""),
        database=os.environ.get("DB_NAME", "ai_memory"),
        min_size=2,
        max_size=10,
    )
    log.info("salesforce_mcp_ready")
    yield
    await _pool.close()


# Lifespan, host, and port go in the constructor — not in run() or after construction.
mcp = FastMCP("salesforce-mcp", lifespan=_lifespan, host="0.0.0.0", port=PORT)


async def _get_salesforce_summary_impl(client_name: str) -> str:
    """
    Core implementation — queries the salesforce.* schema (real Salesforce
    object names) and returns a JSON string.

    Schema: salesforce."Account", "Contact", "Opportunity", "Task", "Event",
            "Case", "Contract"  (loaded from testdata/sfcrm/*.csv in test mode,
            or connected to the live SF integration table sync in production).
    """
    async with _pool.acquire() as conn:
        # 1. Account lookup — exact then fuzzy fallback
        account = await conn.fetchrow(
            """
            SELECT "Id"               AS account_id,
                   "Name"             AS account_name,
                   "Industry"         AS industry,
                   "Type"             AS account_type,
                   "Ownership"        AS ownership,
                   "AnnualRevenue"    AS annual_revenue,
                   "NumberOfEmployees" AS employee_count,
                   "Rating"           AS rating,
                   "Phone"            AS phone,
                   "Website"          AS website,
                   "BillingCity"      AS hq_city,
                   "BillingState"     AS hq_state,
                   "BillingCountry"   AS hq_country,
                   "AccountNumber"    AS account_number
            FROM salesforce."Account"
            WHERE "Name" ILIKE $1
            ORDER BY "Name"
            LIMIT 1
            """,
            f"%{client_name}%",
        )
        if not account:
            return json.dumps({
                "error": "client_not_found",
                "searched_name": client_name,
                "message": (
                    f"No Salesforce account matching '{client_name}'. "
                    "Try the exact company name as stored in CRM."
                ),
            })

        account_id = account["account_id"]
        account_name = account["account_name"]

        # 2. Key contacts
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

        # 3. Recent activities — union of Events and Tasks via Contact join
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

        # 5. Open tasks via Contact join
        tasks = await conn.fetch(
            """
            SELECT t."Subject"           AS subject,
                   t."Status"            AS status,
                   t."Priority"          AS priority,
                   t."ActivityDate"::text AS due_date,
                   t."Description"       AS description,
                   t."Type"              AS task_type
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
        # account_id at top level — consumed by payments-mcp and orchestrator state
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
                "email": c["email"],
                "phone": c["phone"],
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
        "retrieved_at": datetime.utcnow().isoformat() + "Z",
    }
    return json.dumps(result, default=str)


@mcp.tool()
async def get_salesforce_summary(client_name: str) -> str:
    """
    Get Salesforce CRM summary for a client.

    Returns account profile, key contacts, recent activities (90 days),
    open opportunities with pipeline stage and value, and pending tasks.

    The response includes account_id which is required by get_payment_summary.

    Args:
        client_name: Company name as known in Salesforce (partial match supported).

    Returns:
        JSON string with full CRM context, or error JSON if client not found.
    """
    if _cache:
        from platform_sdk.cache import make_cache_key
        key = make_cache_key("get_salesforce_summary", {"client_name": client_name})
        cached = await _cache.get(key)
        if cached:
            log.debug("salesforce_cache_hit", client=client_name)
            return cached

    log.info("salesforce_tool_call", client=client_name)
    result = await _get_salesforce_summary_impl(client_name)

    if _cache and not result.startswith('{"error"'):
        from platform_sdk.cache import make_cache_key
        key = make_cache_key("get_salesforce_summary", {"client_name": client_name})
        await _cache.set(key, result)

    return result


if __name__ == "__main__":
    log.info("mcp_server_starting", transport=TRANSPORT)
    mcp.run(transport=TRANSPORT)
