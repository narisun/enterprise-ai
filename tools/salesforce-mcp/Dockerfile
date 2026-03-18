# ============================================================
# tools/salesforce-mcp/Dockerfile
# Build context: monorepo root (docker build -f tools/salesforce-mcp/Dockerfile .)
# ============================================================
FROM python:3.11-slim AS base

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY platform-sdk/ /platform-sdk/
RUN pip install --no-cache-dir /platform-sdk/

COPY tools/salesforce-mcp/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY tools/salesforce-mcp/src/ /app/src/
# Shared MCP utilities (AgentContextMiddleware, get_agent_context)
COPY tools/shared/ /app/tools_shared/

RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8081

CMD ["python", "-m", "src.server"]
