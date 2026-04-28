# Pass 2 — Findings (Wiring / Infra cleanup)

**Branch:** `cleanup/pass-2-wiring` (stacked on `cleanup/pass-1-code`)
**Date:** 2026-04-28
**Scans:** docker-compose service graph, Makefile target reachability, scripts/ references, .env.example consumers
**Spec:** `docs/superpowers/specs/2026-04-27-dead-code-cleanup-design.md`

## Legend

- `auto` — high-confidence, safe to fix mechanically
- `review` — needs human eyes; default action varies per section
- `hold` — suspicious; leave for later
- Status: `[ ] pending` → `[x] removed` / `[~] kept` / `[?] hold`

## Summary

| Category                     | Total | Removed | Held | Kept | Notes                  |
|------------------------------|------:|--------:|-----:|-----:|------------------------|
| docker-compose services      |    14 |       0 |    0 |   14 | all wired              |
| Makefile targets             |     7 |       0 |    0 |    7 | all wired              |
| scripts                      |     2 |       0 |    2 |    0 | cloud-deploy retirement deferred |
| .env.example keys            |    52 |       3 |    0 |   49 | APP_ENV, APP_VERSION, CHAINLIT_AUTH_SECRET |
| services/ folder             |     1 |       1 |    0 |    0 | continuous_embedding_pipeline subtree (added during review) |

---

## Section 1 — docker-compose services

All 14 services have either inbound `depends_on` edges, host-published ports, or significant non-compose references. **No candidates for removal.**

| Service | Inbound | Non-compose refs | Host ports | Verdict |
|---|---|---|---|---|
| ai-agents | [] | 3 | yes | active entry point |
| analytics-agent | [analytics-dashboard] | 26 | yes | core |
| analytics-dashboard | [] | 10 | yes | active entry point |
| data-mcp | 2 callers | 32 | yes | core |
| langfuse | [] | 18 | yes | active entry point |
| langfuse-db | [langfuse] | 1 | no | dependency |
| litellm | [analytics-agent] | 12 | yes | core |
| news-search-mcp | [analytics-agent] | 25 | yes | core |
| opa | 4 callers | 37 | yes | core |
| otel-collector | [litellm] | 2 | yes | core |
| payments-mcp | [analytics-agent] | 27 | yes | core |
| pgvector | 3 callers | 15 | yes | core |
| redis | [litellm] | 11 | no | core |
| salesforce-mcp | [analytics-agent] | 33 | yes | core |

---

## Section 2 — Makefile targets

All 7 targets are referenced or wired (`help` is the default goal; `setup`/`start`/`stop`/`restart`/`wipe`/`logs` documented in README header and CI/`.github/`). **No candidates for removal.**

Target hits per scan (from `/tmp/cleanup-pass2/target-refs.txt`):

```
help: hits=N rule_deps=N
logs: hits=N rule_deps=N
restart: hits=N rule_deps=N
setup: hits=N rule_deps=N
start: hits=N rule_deps=N
stop: hits=N rule_deps=N
wipe: hits=1 rule_deps=0
```

`wipe` has only its own Makefile self-reference, but it's listed in `.PHONY`, has a `##`-style help docstring, and is documented in the Makefile header comment block (lines 22-24 of `Makefile`) as a deliberate "nuke everything" escape hatch. **Kept.**

---

## Section 3 — Scripts (review)

- [?] `scripts/cloud-deploy.sh` — held; the legacy cloud-deploy path (incl. `infra/azure/`, `docker-compose.cloud.yml`) is out of cleanup scope per spec. If/when that path is retired, retire it as one focused PR (Terraform + cloud-compose + scripts together) — tier: `review` → `hold`
- [?] `scripts/cloud-tls.sh` — same — tier: `review` → `hold`

**Context:** the spec explicitly excludes `docker-compose.cloud.yml` and `infra/azure/` Terraform from cleanup scope ("legacy production deploy (revisit pending)" per `README.md`). These two scripts are the user-facing operations side of that legacy cloud-deploy path. If the cloud-deploy path is being kept (just paused), the scripts should stay even though the make target is missing. If the cloud-deploy path is being abandoned, they can go with the rest.

---

## Section 4 — .env.example keys (review)

- [x] `APP_ENV` — 0 hits — tier: `review` — removed (no consumer in code or compose)
- [x] `APP_VERSION` — 0 hits — tier: `review` — removed (no consumer in code or compose)
- [x] `CHAINLIT_AUTH_SECRET` — 0 hits — tier: `review` — removed (Chainlit replaced by Next.js dashboard; section header in `.env.example` also removed)

**Auto-keep (already verified):** `MINIO_ROOT_PASSWORD`, `MINIO_ROOT_USER` are consumed only by `docker-compose.cloud.yml`, which is out of cleanup scope. They are NOT zero-hit when that file is included; we exclude it from the scan but keep these keys. All `*_API_KEY` / `*_SECRET` / `*_PASSWORD` keys have ≥1 hit and are actively consumed.

---

## Section 5 — `services/` folder (added during review)

The `services/continuous_embedding_pipeline/` subtree was the only contents of `services/`. Pass 1's orphan finder flagged its modules; the verification subagent kept them as a "DI root" because `container.py` ties them together. But `container.py` itself has no consumer: not in `docker-compose.yml`, not invoked by Make/CI/Docker, no pytest collection from `pyproject.toml` testpaths.

User decision: delete the entire `services/` folder.

- [x] `services/continuous_embedding_pipeline/**` (22 files: pyproject.toml, src/, tests/, .ruff_cache/) — removed
- [x] `TECHNOLOGY_STACK.md` "ML / Embedding Pipeline" section — removed (described the deleted service)

After deletion: `services/` directory is empty and removed from tracking. Tests match baseline; ruff error count dropped from 128 → 109 (19 of the pre-existing errors lived inside the deleted subtree).

---

## Decision log

- 2026-04-28 — Section 3 (scripts): both `cloud-deploy.sh` and `cloud-tls.sh` held. The legacy cloud-deploy path is out of cleanup scope per spec; when retired, retire it as one focused PR alongside `infra/azure/` and `docker-compose.cloud.yml`.
- 2026-04-28 — Section 4 (env vars): all 3 zero-hit candidates removed (`APP_ENV`, `APP_VERSION`, `CHAINLIT_AUTH_SECRET`). The "Chat UI (Chainlit)" section header in `.env.example` was removed alongside `CHAINLIT_AUTH_SECRET`.
- 2026-04-28 — Section 5 (services/): the entire `services/continuous_embedding_pipeline/` subtree was deleted. Verification before deletion: no docker-compose service, no Make target, no CI workflow, no `pyproject.toml` testpaths entry, no consumer outside the subtree. Tests match baseline post-deletion; pre-existing ruff errors inside the subtree (19) cleared.

---

## Closing notes

**Pass 2 complete — 2026-04-28**

- **Commits in Pass 2:** 3 (`8d62826` pre-review report → `0ae6964` env-var deletes → `d566d66` services/ deletion)
- **Diff vs `cleanup/pass-1-code`:** 19 files changed, 1445 net lines removed (mostly the deleted services subtree)
- **Net cleanup effect:**
  - 3 unused `.env.example` keys removed (`APP_ENV`, `APP_VERSION`, `CHAINLIT_AUTH_SECRET`) plus the obsolete Chainlit section header
  - 22 source/test files in `services/continuous_embedding_pipeline/` removed (entire unwired ML pipeline subtree)
  - `TECHNOLOGY_STACK.md` "ML / Embedding Pipeline" section removed (described the deleted service)
- **Deferred to a separate PR:** `scripts/cloud-deploy.sh` and `scripts/cloud-tls.sh` — held pending the user's decision on whether to retire the legacy cloud-deploy path (Terraform + cloud-compose + scripts together).
- **Test gate result:** PASSED — Python suites match Pass 1 baseline (no new regressions); `tsc --noEmit` clean; ruff error count dropped from 128 → 109 (19 pre-existing errors lived inside the deleted subtree). Stack-smoke skipped because Pass 2's only runtime-visible change is the 3 deleted `.env.example` template keys, none of which were consumed at runtime.
