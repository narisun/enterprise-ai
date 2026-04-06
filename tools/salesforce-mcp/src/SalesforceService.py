"""Pure business logic for Salesforce CRM operations.

Handles:
- Account lookup with exact match preference and fuzzy fallback
- Contact retrieval with PII protection
- Recent activities (Events + Tasks) aggregation
- Opportunity, task, case, and contract queries
- Row-level access control for RM role
"""
import json
from datetime import datetime, timezone

import asyncpg

# Roles that may see contact PII (email, phone)
_PII_ALLOWED_ROLES = {"rm", "senior_rm", "manager", "compliance_officer"}


class SalesforceService:
    """Pure business logic for Salesforce CRM operations."""

    def __init__(self, db_pool: asyncpg.Pool) -> None:
        """
        Initialize the Salesforce service.

        Args:
            db_pool: AsyncPG connection pool for database access.
        """
        self.db_pool = db_pool

    async def get_summary(
        self,
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

        Args:
            client_name: Company name to look up (partial match supported).
            allow_pii: Whether to include contact email and phone.
            assigned_account_ids: For RM role — restrict to these account IDs.
            unrestricted: True for senior_rm / manager / compliance_officer.

        Returns:
            JSON string with full CRM context, or error JSON if client not found.
        """
        async with self.db_pool.acquire() as conn:
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
