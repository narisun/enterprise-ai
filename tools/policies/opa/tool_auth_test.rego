# ============================================================
# tools/policies/opa/tool_auth_test.rego
#
# OPA unit tests — run with: opa test tools/policies/opa/ -v
#
# Every allow rule must have at least:
#   - A passing test (happy path)
#   - A test that verifies the default deny
#   - Tests for each guard condition
# ============================================================

package mcp.tools

import rego.v1

# ---- execute_read_query: Happy Path -----------------------------------------

test_authorized_select_query_is_allowed if {
    allow with input as {
        "tool": "execute_read_query",
        "session_id": "123e4567-e89b-12d3-a456-426614174000",
        "query": "SELECT * FROM accounts",
        "agent_role": "commercial_banking_agent",
        "environment": "prod",
    }
}

test_local_environment_bypasses_role_check if {
    allow with input as {
        "tool": "execute_read_query",
        "session_id": "123e4567-e89b-12d3-a456-426614174000",
        "query": "SELECT 1",
        "agent_role": "unknown_role",
        "environment": "local",
    }
}

test_case_insensitive_select_allowed if {
    allow with input as {
        "tool": "execute_read_query",
        "session_id": "123e4567-e89b-12d3-a456-426614174000",
        "query": "   select id from users",
        "agent_role": "data_analyst_agent",
        "environment": "prod",
    }
}

# ---- execute_read_query: Deny Cases -----------------------------------------

test_mutating_query_is_denied if {
    not allow with input as {
        "tool": "execute_read_query",
        "session_id": "123e4567-e89b-12d3-a456-426614174000",
        "query": "DROP TABLE accounts",
        "agent_role": "commercial_banking_agent",
        "environment": "prod",
    }
}

test_insert_is_denied if {
    not allow with input as {
        "tool": "execute_read_query",
        "session_id": "123e4567-e89b-12d3-a456-426614174000",
        "query": "INSERT INTO accounts VALUES (1, 'hacker')",
        "agent_role": "commercial_banking_agent",
        "environment": "prod",
    }
}

test_empty_session_id_is_denied if {
    not allow with input as {
        "tool": "execute_read_query",
        "session_id": "",
        "query": "SELECT 1",
        "agent_role": "commercial_banking_agent",
        "environment": "prod",
    }
}

test_unknown_role_in_prod_is_denied if {
    not allow with input as {
        "tool": "execute_read_query",
        "session_id": "123e4567-e89b-12d3-a456-426614174000",
        "query": "SELECT 1",
        "agent_role": "rogue_agent",
        "environment": "prod",
    }
}

test_unknown_tool_is_denied if {
    not allow with input as {
        "tool": "delete_all_records",
        "session_id": "123e4567-e89b-12d3-a456-426614174000",
        "query": "SELECT 1",
        "agent_role": "commercial_banking_agent",
        "environment": "prod",
    }
}

# ---- Default Deny -----------------------------------------------------------

test_empty_input_is_denied if {
    not allow with input as {}
}
