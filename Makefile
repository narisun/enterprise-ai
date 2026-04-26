# ============================================================
# enterprise-ai — Single-host dev stack
#
# Five lifecycle targets keep the mental model small:
#
#   make setup    Wipe ONLY the test-fixture volume (pgdata), rebuild
#                 images, reload bankdw + salesforce CSVs. Langfuse
#                 user accounts and API keys are PRESERVED so you do
#                 not have to re-register the dashboard after every run.
#
#   make start    Bring up anything that isn't already running.
#                 Idempotent. Preserves all data.
#
#   make stop     Stop every container in the stack. Preserves data
#                 (volumes stay), so `make start` resumes where you
#                 left off.
#
#   make restart  Stop, then start. Same as: make stop && make start.
#
#   make wipe     Nuke EVERYTHING — including the Langfuse database
#                 (you will need to re-register the dashboard and
#                 generate fresh API keys). Use only when you want a
#                 truly clean slate. Rare.
#
# Plus:
#
#   make logs     Tail logs for one or all services. Examples:
#                   make logs                    (all services, follow)
#                   make logs S=analytics-agent  (one service, follow)
#                   make logs S=data-mcp N=200   (last 200 lines, follow)
#
#   make help     List the targets.
#
# Notes:
#   - .env is required; copy from .env.example on first run.
#   - The same Make targets work on macOS (dev) and a Linux VM
#     in cloud. The compose file (docker-compose.yml) is the
#     single source of truth.
# ============================================================

.PHONY: setup start stop restart wipe logs help

VENV    := .venv
PYTHON  := $(VENV)/bin/python3
PIP     := $(PYTHON) -m pip
COMPOSE := docker compose
PROJECT := enterprise-ai

# Volumes that hold ephemeral test fixtures — wiped by `make setup`.
# Volumes NOT listed here (notably langfuse-db-data) survive `make setup`
# so you don't have to re-register the Langfuse dashboard after every
# fixture refresh.
WIPEABLE_VOLUMES := $(PROJECT)_pgdata

# Auto-create the venv + install platform-sdk on first run.
$(PYTHON):
	@echo "→ Creating Python venv ($(VENV))..."
	python3 -m venv $(VENV)
	$(PIP) install --upgrade pip --quiet
	@echo "→ Installing platform-sdk (editable)..."
	$(PIP) install -e platform-sdk/ --quiet
	@echo "✅ venv ready"

setup: $(PYTHON) ## Wipe test fixtures, rebuild images, reload data (preserves Langfuse login)
	@test -f .env || (echo "ERROR: .env not found — run: cp .env.example .env" && exit 1)
	@echo "→ Stopping containers (Langfuse data preserved)..."
	$(COMPOSE) down --remove-orphans
	@echo "→ Removing test-fixture volume so init scripts re-run..."
	-@docker volume rm $(WIPEABLE_VOLUMES) 2>/dev/null || true
	@echo "→ Building images and starting containers..."
	$(COMPOSE) up -d --build
	@echo ""
	@echo "✅ Stack ready — bankdw + salesforce fixtures loaded"
	@echo "   Dashboard:       http://localhost:3003"
	@echo "   Analytics agent: http://localhost:8086"
	@echo "   Generic agent:   http://localhost:8000"
	@echo "   LiteLLM proxy:   http://localhost:4000"
	@echo "   OPA:             http://localhost:8181"
	@echo "   PostgreSQL:      localhost:5432  (admin / \$$POSTGRES_PASSWORD)"
	@echo "   Langfuse:        http://localhost:3001  (login persisted across setup)"

wipe: ## Nuke everything (incl. Langfuse users/keys). Re-register required.
	@test -f .env || (echo "ERROR: .env not found — run: cp .env.example .env" && exit 1)
	@echo "⚠  This removes ALL volumes including Langfuse user accounts."
	@echo "→ Tearing down stack and removing every named volume..."
	$(COMPOSE) down -v --remove-orphans
	@echo "✅ Wipe complete — run \`make setup\` to bring up a fresh stack."

start: $(PYTHON) ## Start anything not yet running (preserves data)
	@test -f .env || (echo "ERROR: .env not found — run: cp .env.example .env" && exit 1)
	$(COMPOSE) up -d
	@echo "✅ Stack running — see 'docker ps' for status"

stop: ## Stop everything (preserves data)
	$(COMPOSE) down
	@echo "✅ Stack stopped — data volumes preserved"

restart: stop start ## Stop then start

# Override on the command line:  make logs S=analytics-agent N=200
S ?=
N ?= 100
logs: ## Tail logs (S=service, N=lines; defaults: all services, last 100)
	$(COMPOSE) logs -f --tail=$(N) $(S)

help: ## Show this help
	@awk 'BEGIN{FS=":.*## "} \
	     /^[a-z][a-zA-Z_-]*:.*## / {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}' \
	     $(MAKEFILE_LIST)

.DEFAULT_GOAL := help
