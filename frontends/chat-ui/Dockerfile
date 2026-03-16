# ============================================================
# frontends/chat-ui/Dockerfile
# Build context: monorepo root (docker build -f frontends/chat-ui/Dockerfile .)
# ============================================================
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
    && rm -rf /var/lib/apt/lists/*

# ---- Shared SDK (logging, telemetry, config, security, agent factory) -------
COPY platform-sdk/ /platform-sdk/
RUN pip install --no-cache-dir /platform-sdk/

# ---- Service dependencies -------------------------------------------
COPY frontends/chat-ui/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ---- Reuse agent source (MCPToolBridge + graph builder) -------------
# Copying agents/src/ means the chat-ui shares the exact same MCP
# bridge and LangGraph agent builder — no code duplication.
COPY agents/src/ /app/agent_src/

# ---- Copy Chainlit app and config -----------------------------------
COPY frontends/chat-ui/ /app/

# ---- Make agent_src importable --------------------------------------
ENV PYTHONPATH=/app

# ---- Entrypoint — runs DB migration before starting the server ------
COPY frontends/chat-ui/entrypoint.sh /entrypoint.sh
# Strip Windows CRLF line endings (safe no-op on files already using LF)
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

# ---- Non-root user --------------------------------------------------
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8501

# entrypoint.sh runs `chainlit db upgrade` (creates Chainlit schema tables
# in PostgreSQL on first boot, idempotent on subsequent starts), then execs
# the Chainlit server.
ENTRYPOINT ["/entrypoint.sh"]
