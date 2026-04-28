# Dead-Code Cleanup — Pass 2 (Wiring / Infra) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Identify and remove unused infrastructure wiring across `docker-compose.yml`, `Makefile`, `scripts/`, and `.env.example`, shipping the work as one PR stacked on the Pass 1 branch.

**Architecture:** Same tiered-review workflow as Pass 1, but with grep- and yq-based scans instead of language-specific linters. Findings go into `cleanup/pass2-findings.md`. Each removal verified by either `make help`, `make setup` boot, or shell script lint as appropriate.

**Tech Stack:** `yq` (YAML query), `grep` / `ripgrep`, `bash`, `make`, Docker Compose. No new dependencies needed; if `yq` isn't installed, fall back to `python -c "import yaml; ..."`.

**Branch:** `cleanup/pass-2-wiring` off `cleanup/pass-1-code` (per user direction: ship Pass 1 + 2 together).

**Scope (this plan):** Pass 2 only. Pass 3 (Rego/SQL/comments) gets a separate plan after Pass 2 ships.

---

## Phase A — Setup

### Task A1: Create branch off cleanup/pass-1-code

- [ ] **Step 1: Verify clean tree on cleanup/pass-1-code**

```bash
cd /Users/admin-h26/enterprise-ai
git status --short
git branch --show-current
```

Expected: empty status, current branch `cleanup/pass-1-code`. If different, stop and surface.

- [ ] **Step 2: Branch off**

```bash
git checkout -b cleanup/pass-2-wiring
git branch --show-current
```

Expected: `cleanup/pass-2-wiring`.

---

## Phase B — Scan

All scans dump to `/tmp/cleanup-pass2/`. No source-code changes.

### Task B1: Compose service usage graph

- [ ] **Step 1: List declared services**

```bash
mkdir -p /tmp/cleanup-pass2
cd /Users/admin-h26/enterprise-ai

# Try yq first; fall back to python
if command -v yq >/dev/null; then
  yq '.services | keys | .[]' docker-compose.yml > /tmp/cleanup-pass2/services.txt
else
  .venv/bin/python -c "import yaml; print('\n'.join(sorted(yaml.safe_load(open('docker-compose.yml'))['services'].keys())))" > /tmp/cleanup-pass2/services.txt
fi
cat /tmp/cleanup-pass2/services.txt
```

Expected: list of service names (e.g. `analytics-agent`, `data-mcp`, `langfuse`, etc.).

- [ ] **Step 2: List `depends_on` edges**

```bash
cd /Users/admin-h26/enterprise-ai
if command -v yq >/dev/null; then
  yq '.services | to_entries | .[] | "\(.key): \(.value.depends_on // {} | keys)"' docker-compose.yml > /tmp/cleanup-pass2/depends.txt
else
  .venv/bin/python -c "
import yaml
d = yaml.safe_load(open('docker-compose.yml'))
for name, svc in d.get('services', {}).items():
    deps = svc.get('depends_on', {})
    if isinstance(deps, dict):
        deps = list(deps.keys())
    print(f'{name}: {deps}')
" > /tmp/cleanup-pass2/depends.txt
fi
cat /tmp/cleanup-pass2/depends.txt
```

- [ ] **Step 3: Find service-name references in non-compose files**

For each declared service, grep the repo for its name in code/config — to catch services referenced by hostname, env var, etc. even when no compose service depends_on them.

```bash
cd /Users/admin-h26/enterprise-ai
> /tmp/cleanup-pass2/service-refs.txt
while read -r svc; do
  count=$(grep -rn --include='*.py' --include='*.ts' --include='*.tsx' --include='*.yaml' --include='*.yml' --include='*.toml' --include='*.env*' --include='*.sh' --include='Makefile' --include='Dockerfile*' --include='*.md' \
    -l "$svc" . 2>/dev/null | grep -v node_modules | grep -v .venv | grep -v .next | grep -v 'docker-compose.yml' | wc -l | tr -d ' ')
  echo "$svc: $count file(s) reference" >> /tmp/cleanup-pass2/service-refs.txt
done < /tmp/cleanup-pass2/services.txt
cat /tmp/cleanup-pass2/service-refs.txt
```

A service with `0 file(s) reference` AND no inbound `depends_on` is a candidate for removal.

### Task B2: Makefile target usage

- [ ] **Step 1: List declared targets**

```bash
cd /Users/admin-h26/enterprise-ai
grep -E '^[a-zA-Z][a-zA-Z0-9_.-]*:' Makefile | cut -d: -f1 | sort -u > /tmp/cleanup-pass2/targets.txt
cat /tmp/cleanup-pass2/targets.txt
```

Note: ignore `.PHONY` lines and pattern targets. The grep above already does because `.PHONY:` starts with `.`.

- [ ] **Step 2: Find external references to each target**

```bash
cd /Users/admin-h26/enterprise-ai
> /tmp/cleanup-pass2/target-refs.txt
while read -r tgt; do
  hits=$(grep -rn -E "make\s+$tgt(\s|$|\b)" \
    --include='*.yml' --include='*.yaml' \
    --include='Makefile' --include='*.md' \
    --include='*.sh' --include='*.py' --include='*.ts' \
    .github/ scripts/ docs/ README.md docker-compose*.yml Makefile 2>/dev/null \
    | grep -v node_modules | grep -v .venv | wc -l | tr -d ' ')
  echo "$tgt: $hits hit(s)" >> /tmp/cleanup-pass2/target-refs.txt
done < /tmp/cleanup-pass2/targets.txt
cat /tmp/cleanup-pass2/target-refs.txt
```

A target with `0 hit(s)` is a candidate for removal — except for `help` (the default goal), which is invoked without `make help` on bare invocation.

### Task B3: Scripts usage

- [ ] **Step 1: List `scripts/`**

```bash
cd /Users/admin-h26/enterprise-ai
find scripts -type f \( -name '*.sh' -o -name '*.py' -o -name '*.bash' \) 2>/dev/null > /tmp/cleanup-pass2/scripts.txt
cat /tmp/cleanup-pass2/scripts.txt
```

If `scripts/` doesn't exist, note that and skip B3.

- [ ] **Step 2: Find references**

```bash
cd /Users/admin-h26/enterprise-ai
> /tmp/cleanup-pass2/script-refs.txt
while read -r script; do
  base=$(basename "$script")
  hits=$(grep -rn "$base" \
    --include='Makefile' --include='*.md' --include='*.yml' --include='*.yaml' \
    --include='*.sh' --include='*.py' --include='*.toml' --include='Dockerfile*' \
    .github/ docs/ README.md Makefile docker-compose*.yml pyproject.toml scripts/ 2>/dev/null \
    | grep -v ":${script}:" \
    | grep -v "$script:" \
    | wc -l | tr -d ' ')
  echo "$script: $hits hit(s)" >> /tmp/cleanup-pass2/script-refs.txt
done < /tmp/cleanup-pass2/scripts.txt
cat /tmp/cleanup-pass2/script-refs.txt
```

A script with `0 hit(s)` (excluding self-references) is a candidate.

### Task B4: Env var usage

- [ ] **Step 1: List `.env.example` keys**

```bash
cd /Users/admin-h26/enterprise-ai
grep -E '^[A-Z_][A-Z0-9_]*=' .env.example 2>/dev/null | cut -d= -f1 | sort -u > /tmp/cleanup-pass2/env-keys.txt
cat /tmp/cleanup-pass2/env-keys.txt
```

If `.env.example` doesn't exist, surface and stop.

- [ ] **Step 2: Find each key's consumers**

```bash
cd /Users/admin-h26/enterprise-ai
> /tmp/cleanup-pass2/env-refs.txt
while read -r key; do
  hits=$(grep -rn "$key" \
    --include='*.py' --include='*.ts' --include='*.tsx' \
    --include='*.yml' --include='*.yaml' --include='Dockerfile*' \
    --include='Makefile' --include='*.sh' \
    . 2>/dev/null \
    | grep -v node_modules | grep -v .venv | grep -v .next \
    | grep -v ".env.example" \
    | wc -l | tr -d ' ')
  echo "$key: $hits hit(s)" >> /tmp/cleanup-pass2/env-refs.txt
done < /tmp/cleanup-pass2/env-keys.txt
cat /tmp/cleanup-pass2/env-refs.txt
```

A key with `0 hit(s)` is a candidate — but cross-check with `.env` if it exists (live secrets aren't dead).

---

## Phase C — Normalize

### Task C1: Build the findings report

- [ ] **Step 1: Write `cleanup/pass2-findings.md`**

Skeleton with sections for compose / Makefile / scripts / env, and a Summary table. Populate from `/tmp/cleanup-pass2/` outputs.

For each candidate:
```
- [ ] `<artifact>` — <evidence: 0 hits across X y z files> — tier: `review`
```

Default tiers:
- Compose services: `review` (low confidence — services may be referenced by container hostnames)
- Make targets: `review` (some are convenience wrappers documented in README only — confirm)
- Scripts: `review`
- Env vars: `review` (often used at container start by orchestration, not Python)

Allowlist (auto-`review`-then-keep) — these are KNOWN to look orphan but aren't:
- Make `help` target — default goal
- Compose services tied to a port published to host (`ports: - 5432:5432`) — accessed externally
- Env vars matching `*_API_KEY`, `*_SECRET`, `*_PASSWORD` — set in real `.env`, used at boot

Add a Decision log section.

- [ ] **Step 2: Commit**

```bash
cd /Users/admin-h26/enterprise-ai
git add cleanup/pass2-findings.md
git commit -m "chore(cleanup): pass 2 findings report (pre-review)"
```

---

## Phase E — Review

### Task E1: Review compose service candidates with user

- [ ] **Step 1: Pause for user**

For each Section 1 candidate, present:
- Service name
- Image / build context
- Ports published (if any)
- depends_on inbound count
- Reference count from Step B1.3

User picks `delete` / `keep` / `hold`.

- [ ] **Step 2: Apply approved deletions**

For each `delete`, edit `docker-compose.yml` to remove the entire `services.<name>` block AND any `depends_on: <name>` edges from other services.

- [ ] **Step 3: Verify compose syntax**

```bash
cd /Users/admin-h26/enterprise-ai
docker compose config --quiet 2>&1 || echo "compose config invalid"
```

Expected: no output (silence is success).

- [ ] **Step 4: Boot the stack**

```bash
make setup
sleep 30
docker ps --format '{{.Names}}\t{{.Status}}'
make stop
```

Expected: every remaining container `Up`. If any container fails to start, the deleted service was a real dependency — restore it.

- [ ] **Step 5: Update report and commit per logical group**

```bash
cd /Users/admin-h26/enterprise-ai
git add docker-compose.yml cleanup/pass2-findings.md
git commit -m "chore(cleanup): remove unused compose services"
```

### Task E2: Review Makefile targets with user

- [ ] **Step 1: Pause for user, present each candidate**

- [ ] **Step 2: Apply approved deletions**

Edit `Makefile` to remove the target's recipe AND any `.PHONY` entries listing it.

- [ ] **Step 3: Verify**

```bash
cd /Users/admin-h26/enterprise-ai
make help  # default goal — should still print the help block
```

Also run a smoke `make start && make stop` if any infrastructure target was removed.

- [ ] **Step 4: Update report and commit**

```bash
git add Makefile cleanup/pass2-findings.md
git commit -m "chore(cleanup): remove unused Makefile targets"
```

### Task E3: Review scripts with user

- [ ] **Step 1: Pause for user**

For each script, present:
- Script path
- Top-of-file docstring/comment (a `head -10`)
- Reference count

User picks `delete` / `keep` / `hold`.

- [ ] **Step 2: Apply approved deletions**

```bash
cd /Users/admin-h26/enterprise-ai
git rm <path>
```

- [ ] **Step 3: Update report and commit**

```bash
git add cleanup/pass2-findings.md
git commit -m "chore(cleanup): remove unreferenced scripts"
```

### Task E4: Review env vars with user

- [ ] **Step 1: Pause for user**

For each candidate, present:
- Key name
- Value pattern in `.env.example` (e.g. `EXAMPLE_KEY=changeme`)
- Reference count
- Whether it matches the auto-keep regex (API_KEY / SECRET / PASSWORD)

User picks `delete` / `keep` / `hold`.

- [ ] **Step 2: Apply approved deletions**

Edit `.env.example` to remove the key line.

- [ ] **Step 3: Boot the stack**

```bash
cd /Users/admin-h26/enterprise-ai
make setup
sleep 30
docker ps --format '{{.Names}}\t{{.Status}}'
curl -fsS http://localhost:8086/health
make stop
```

Expected: all green. If a container fails with "missing env var X", restore X.

- [ ] **Step 4: Update report and commit**

```bash
git add .env.example cleanup/pass2-findings.md
git commit -m "chore(cleanup): remove unused .env.example keys"
```

---

## Phase F — Test gate

### Task F1: Run the full Pass 2 gate

Same gate as Pass 1, captured to `/tmp/cleanup-pass2/gate.log`.

- [ ] **Step 1: Lint, Python tests, Frontend** — same per-suite checks as Pass 1 F1; counts must match the Pass 1 baseline (we're stacking, so the Pass 1 baseline is now the post-Pass 1 state, which itself matches `main`).

- [ ] **Step 2: Stack smoke** — `make setup` + health curls.

- [ ] **Step 3: Integration tests** — `tests/integration/test_payments_sql.py`, `tests/integration/test_opa_policies.py`.

- [ ] **Step 4: Stop the stack** — `make stop`.

Fail conditions: any new test failure relative to the `cleanup/pass-1-code` tip; any container not Up; any health endpoint returning non-200; `make setup` non-zero exit.

---

## Phase G — Finalize and PR

### Task G1: Final report and PR

- [ ] **Step 1: Update findings report — final state**

Mark every finding `[x] removed` / `[~] kept` / `[?] hold`. Update Summary table. Write Closing notes (commits in Pass 2, lines net removed, gate status, items deferred).

- [ ] **Step 2: Commit final report**

```bash
git add cleanup/pass2-findings.md
git commit -m "chore(cleanup): pass 2 findings report (final, gate green)"
```

- [ ] **Step 3: Push branch**

```bash
git push -u origin cleanup/pass-2-wiring
```

- [ ] **Step 4: Open PR**

PR target = `cleanup/pass-1-code` (so the diff reads as Pass 2's own changes only). If `gh` CLI isn't installed, write the PR body to `/tmp/cleanup-pass2/pr-body.md` and report the GitHub URL the push response printed.

PR title: `chore(cleanup): pass 2 — docker/Make/scripts/env wiring`

PR body template:

```markdown
## Summary

- Pass 2 of the dead-code cleanup workstream defined in `docs/superpowers/specs/2026-04-27-dead-code-cleanup-design.md`.
- Removed N unused docker-compose services
- Removed N unused Makefile targets
- Removed N unreferenced scripts
- Removed N unused .env.example keys
- Findings tracked in `cleanup/pass2-findings.md`.

Stacked on `cleanup/pass-1-code`. Merge after Pass 1.

## Test plan

- [x] Lint — green
- [x] All Python suites — match baseline
- [x] Frontend tsc/lint/build — green
- [x] make setup boots full stack
- [x] Health endpoints return 200
- [x] Integration tests — payments_sql green
```

---

## Self-review checklist

- [ ] Every spec Pass 2 category has a B-task and an E-task.
- [ ] No "TBD" / "implement later" placeholders.
- [ ] Each removal is followed by a verification (compose config / make help / make setup / health check).
- [ ] Branch name (`cleanup/pass-2-wiring`) and PR base (`cleanup/pass-1-code`) reflect the user's stack-on-Pass-1 decision.
