FROM python:3.11-slim AS base

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY platform-sdk/ /platform-sdk/
RUN pip install --no-cache-dir /platform-sdk/

COPY tools/payments-mcp/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY tools/payments-mcp/src/ /app/src/

RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8082

CMD ["python", "-m", "src.server"]
