# Enterprise AI Assistant

Welcome to the **Enterprise AI Platform**.

This assistant has secure, policy-governed access to your workspace database. Every data retrieval is authorised in real time by the Open Policy Agent policy engine — you can expand the tool call steps below each response to see exactly what query was run and what was returned.

## What you can ask

- *"Show me all active projects in the workspace"*
- *"What tasks are assigned to the engineering team?"*
- *"Summarise the status of projects created this month"*
- *"How many items are in the backlog?"*

## How it works

Each response goes through this pipeline:

1. **LangGraph ReAct loop** — the AI reasons about whether it needs data before answering
2. **MCP tool call** — if data is needed, a structured SQL query is prepared
3. **OPA policy check** — the query is authorised against your organisation's access policies
4. **Database query** — results are fetched from your workspace schema
5. **AI synthesis** — the model composes a clear answer from the retrieved data

---

*All conversations are logged for compliance. Queries are read-only.*
