FROM python:3.11-slim AS base

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY frontends/rm-prep-ui/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY frontends/rm-prep-ui/app.py .

RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8502

CMD ["streamlit", "run", "app.py", "--server.port=8502", "--server.address=0.0.0.0", "--server.headless=true"]
