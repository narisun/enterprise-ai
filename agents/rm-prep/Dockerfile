# ============================================================
# agents/rm-prep/Dockerfile
# Build context: monorepo root
# ============================================================
FROM python:3.11-slim AS base

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY platform-sdk/ /platform-sdk/
RUN pip install --no-cache-dir /platform-sdk/

COPY agents/rm-prep/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY agents/rm-prep/src/ /app/src/
# MCPToolBridge now lives in platform-sdk (installed above)
# The src/mcp_bridge.py shim re-exports from platform_sdk.mcp_bridge

RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8003

CMD ["uvicorn", "src.server:app", "--host", "0.0.0.0", "--port", "8003"]
