# ============================================================
# tools/policies/opa/tool_auth.rego
#
# Enterprise tool authorization policy.
#
# Every MCP tool call is evaluated here before execution.
# Default: DENY. Access must be explicitly granted.
#
# Input schema:
#   input.tool         string  — MCP tool name
#   input.session_id   string  — Agent session UUID
#   input.query        string  — SQL query (for data tools)
#   input.agent_role   string  — Role of the calling agent
#   input.environment  string  — "local" | "dev" | "prod"
# ============================================================

package mcp.tools

import rego.v1

# Default deny — explicit allow rules below
default allow := false

# ============================================================
# RULE: execute_read_query
#
# Authorised agents may run SELECT queries in their session schema.
# Mutating queries are blocked by the MCP server itself as a second
# layer of defence-in-depth (this policy is the first layer).
# ============================================================

allow if {
    input.tool == "execute_read_query"
    _valid_session_id
    _select_query_only
    _agent_is_authorized
}

# ============================================================
# RULE: Salesforce CRM Tools (get_salesforce_summary)
#
# RM Prep Agent retrieves Salesforce account, contact, activity,
# opportunity and task data for meeting preparation.
# ============================================================

allow if {
    input.tool == "get_salesforce_summary"
    _agent_is_authorized
}

# ============================================================
# RULE: Payment Transaction Tools (get_payment_summary)
#
# RM Prep Agent retrieves bank payment transaction data including
# volumes, corridors, and counterparty analysis.
# ============================================================

allow if {
    input.tool == "get_payment_summary"
    _agent_is_authorized
}

# ============================================================
# RULE: News Search Tools (search_company_news)
#
# RM Prep Agent searches internet news for company intelligence
# using Tavily API or mock data in development.
# ============================================================

allow if {
    input.tool == "search_company_news"
    _agent_is_authorized
}

# ============================================================
# FUTURE TOOLS — add rules here as new MCP servers are added
#
# allow if {
#     input.tool == "search_documents"
#     _valid_session_id
#     _agent_is_authorized
#     input.agent_role in {"research_agent", "commercial_banking_agent"}
# }
#
# allow if {
#     input.tool == "call_internal_api"
#     _valid_session_id
#     _agent_is_authorized
#     input.agent_role == "transaction_agent"
# }
# ============================================================

# ---- Helper Rules -----------------------------------------------------------

# L7: Session ID must be a well-formed UUID (both layers enforce the same constraint).
# The MCP server performs the same check; having it here makes the policy
# independently enforceable and self-documenting.
_UUID_PATTERN := `^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`

_valid_session_id if {
    input.session_id != ""
    input.session_id != null
    regex.match(_UUID_PATTERN, input.session_id)
}

# Only SELECT statements are authorised at policy level
_select_query_only if {
    regex.match(`(?i)^\s*SELECT`, input.query)
}

# Agent identity authorisation
# In production, agent_role is injected from a signed JWT or service account.
_agent_is_authorized if {
    input.agent_role in {
        "commercial_banking_agent",
        "data_analyst_agent",
        "compliance_agent",
        "rm_prep_agent",
    }
}

# Bypass for local development — any role is accepted in the local environment.
# H3: input.environment is ALWAYS stamped by the MCP server from its own
# ENVIRONMENT env var — it is never supplied by the calling agent.
# This makes the bypass safe: only a server configured with ENVIRONMENT=local
# (i.e. a local-dev instance) can trigger this rule.
_agent_is_authorized if {
    input.environment == "local"
}
