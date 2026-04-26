# ============================================================
# enterprise-ai — Single-host dev stack
#
# Four lifecycle targets keep the mental model small:
#
#   make setup    Wipe volumes, rebuild images, start everything,
#                 reload bankdw + salesforce test fixtures from CSVs.
#                 Use after changing Dockerfiles or seed SQL, or when
#                 you want a clean slate.
#
#   make start    Bring up anything that isn't already running.
#                 Idempotent. Preserves data.
#
#   make stop     Stop every container in the stack. Preserves data
#                 (volumes stay), so `make start` resumes where you
#                 left off.
#
#   make restart  Stop, then start. Same as: make stop && make start.
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

.PHONY: setup start stop restart logs help

VENV    := .venv
PYTHON  := $(VENV)/bin/python3
PIP     := $(PYTHON) -m pip
COMPOSE := docker compose

# Auto-create the venv + install platform-sdk on first run.
$(PYTHON):
	@echo "→ Creating Python venv ($(VENV))..."
	python3 -m venv $(VENV)
	$(PIP) install --upgrade pip --quiet
	@echo "→ Installing platform-sdk (editable)..."
	$(PIP) install -e platform-sdk/ --quiet
	@echo "✅ venv ready"

setup: $(PYTHON) ## Wipe volumes, rebuild images, load fresh test data
	@test -f .env || (echo "ERROR: .env not found — run: cp .env.example .env" && exit 1)
	@echo "→ Tearing down existing stack and removing volumes..."
	$(COMPOSE) down -v --remove-orphans
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
