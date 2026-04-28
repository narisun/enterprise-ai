# Pass 3 — Findings (Policy / SQL / Commented Code)

**Branch:** `cleanup/pass-3-policy` (stacked on `cleanup/pass-2-wiring`)
**Date:** 2026-04-28
**Scans:** Rego call graph, SQL orphan tables, ruff ERA001
**Spec:** `docs/superpowers/specs/2026-04-27-dead-code-cleanup-design.md`

## Summary

| Category              | Total | Removed | Held | Notes                                |
|-----------------------|------:|--------:|-----:|--------------------------------------|
| Rego rules / packages |     1 |       0 |    0 | only package `mcp.tools`; all wired  |
| SQL tables            |    26 |       1 |    1 | `sample_data` removed; `agent_audit_log` held |
| Seed CSVs             |    22 |       0 |    0 | all referenced                       |
| ERA001 commented code |     1 |       0 |    0 | inline doc comment FP                |

---

## Section 1 — Rego (no candidates)

Single `.rego` source file: `tools/policies/opa/tool_auth.rego` (package `mcp.tools`). Consumed by 10 files including `docker-compose.yml`, `platform-sdk/platform_sdk/config/mcp_config.py`, `tests/integration/test_opa_policies.py`. **Kept.**

`opa test` skipped — `opa` binary not installed locally; CI runs the Rego tests.

---

## Section 2 — SQL tables (26 defined; 4 zero-ref candidates after FP filtering)

| Table | Verdict | Reason |
|---|---|---|
| `checkpoints` | `kept` | LangGraph runtime table — created by `AsyncPostgresSaver`, not via explicit SQL |
| `checkpoint_writes` | `kept` | LangGraph pair to above |
| `agent_audit_log` | `[?] hold` | Defined with indexes in `init.sql:43-64` but no INSERT/SELECT in code. Likely planned middleware scaffolding. Hold pending decision on whether the audit-logging pipe will be wired |
| `sample_data` | `[x] removed` | Example workspace fixture in `init.sql:84-105`. No code/test consumer. Workspace mechanism itself stays (used by `tools/data-mcp/src/data_query_service.py:102` per-session); only the static example workspace + table goes. |

Removal scope:
- [x] `platform/db/init.sql` lines 84-105 — example workspace schema + `sample_data` table + 3 INSERTs — removed
- [x] `platform/db/init.sql` line 81 — schema_version description trimmed (drop "workspace" suffix)
- [x] `agents/src/prompts/enterprise_agent.j2` lines 14-16 — "WORKSPACE TABLES" block listing `sample_data` — removed (kept the workspace concept paragraph since `data_query_service` uses dynamic workspace schemas)

---

## Section 3 — Seed CSVs (no candidates)

All 22 CSVs in `testdata/` are referenced by their corresponding seed-loading SQL. No orphans.

---

## Section 4 — ERA001 commented code (1 finding, false positive)

- [~] `agents/analytics-agent/tests/fakes/fake_conversation_store.py:15` — `# key = (tenant_id, conversation_id)` — kept (inline doc comment describing the `dict` key shape, not commented-out code; ruff ERA001 misclassifies)

---

## Decision log

- 2026-04-28 — SQL: removed `sample_data` example fixture; held `agent_audit_log` (planned scaffolding decision deferred).
- 2026-04-28 — `agents/src/prompts/enterprise_agent.j2`: removed the "WORKSPACE TABLES" block listing `sample_data`. The workspace concept paragraph was kept and reworded — workspaces are still active per-session (set by `data_query_service`), there's just no longer a fixed table inside them at init time.
- 2026-04-28 — Rego: no removals; only package `mcp.tools` is in active use.
- 2026-04-28 — ERA001: 1 finding, all kept (false positive).

## Closing notes

- **Commits in Pass 3:** 2 (this report + the SQL/prompt removal commit)
- **Net effect:** 1 SQL table + 1 example schema + 3 seed rows removed; 1 prompt block trimmed; no Rego or commented-code changes
- **Items deferred:** `agent_audit_log` (Hold — needs product decision)
