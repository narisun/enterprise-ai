"""
RM Prep Chat UI — Streamlit interface for the RM Prep Agent.

Features:
- Chat-style interface with conversation history
- Real-time streaming progress indicators as each pipeline stage runs
- Session persistence via session_id (follow-up questions work across turns)
- Formatted markdown brief rendering

Usage:
  Open http://localhost:8502 in your browser.
  Type: "Prepare me for my meeting with Acme Manufacturing"
"""
import json
import os
import uuid

import httpx
import streamlit as st

RM_PREP_AGENT_URL = os.environ.get("RM_PREP_AGENT_URL", "http://rm-prep-agent:8003")
INTERNAL_API_KEY = os.environ.get("INTERNAL_API_KEY", "")
APP_ENV = os.environ.get("APP_ENV", "development")
APP_VERSION = os.environ.get("APP_VERSION", "1.0.0")

# ─── Page config ─────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="RM Meeting Prep",
    page_icon="📋",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ─── Sidebar ─────────────────────────────────────────────────────────────────
with st.sidebar:
    st.title("📋 RM Meeting Prep")
    st.caption(f"v{APP_VERSION} · {APP_ENV.upper()}")
    st.divider()
    st.markdown("**How to use**")
    st.markdown(
        "Ask about any client to instantly generate a meeting preparation brief.\n\n"
        "**Example prompts:**\n"
        "- *Prepare me for tomorrow's meeting with Acme Manufacturing*\n"
        "- *What should I discuss with ABC Logistics today?*\n"
        "- *What's new with GlobalTech Corp since last month?*\n"
        "- *Any recent news about Meridian Healthcare?*"
    )
    st.divider()
    st.markdown("**Data sources**")
    st.markdown("🏢 Salesforce CRM\n\n💰 Payments System\n\n📰 Internet News")
    st.divider()

    rm_id = st.text_input("Your name / RM ID", value="RM", max_chars=64)

    if st.button("🔄 New Session", use_container_width=True):
        st.session_state.messages = []
        st.session_state.session_id = str(uuid.uuid4())
        st.rerun()

    st.caption(f"Session: `{st.session_state.get('session_id', 'new')[:8]}...`")

# ─── Session state ───────────────────────────────────────────────────────────
if "messages" not in st.session_state:
    st.session_state.messages = []

if "session_id" not in st.session_state:
    st.session_state.session_id = str(uuid.uuid4())

# ─── Chat history ────────────────────────────────────────────────────────────
for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])

# ─── Chat input ──────────────────────────────────────────────────────────────
if prompt := st.chat_input("Ask about a client (e.g. 'Prepare me for Acme Manufacturing meeting')"):

    # Render user message immediately
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    # Stream the brief
    with st.chat_message("assistant"):
        status_area = st.empty()
        brief_area = st.empty()
        brief_content = ""

        headers = {"Authorization": f"Bearer {INTERNAL_API_KEY}"}
        payload = {
            "prompt": prompt,
            "rm_id": rm_id or "RM",
            "session_id": st.session_state.session_id,
        }

        try:
            with httpx.Client(timeout=120.0) as client:
                with client.stream(
                    "POST",
                    f"{RM_PREP_AGENT_URL}/brief",
                    json=payload,
                    headers=headers,
                ) as response:
                    response.raise_for_status()
                    for line in response.iter_lines():
                        line = line.strip()
                        if not line:
                            continue
                        if line.startswith("event:"):
                            current_event = line[6:].strip()
                            continue
                        if line.startswith("data:"):
                            data_str = line[5:].strip()
                            try:
                                data = json.loads(data_str)
                            except json.JSONDecodeError:
                                continue

                            # Infer event type from data keys when event: line not present
                            if "message" in data and "markdown" not in data:
                                status_area.info(data["message"])
                            elif "markdown" in data:
                                brief_content = data["markdown"]
                                status_area.empty()
                                brief_area.markdown(brief_content)
                            elif "message" in data and brief_content == "":
                                # error event
                                status_area.error(f"Error: {data['message']}")

        except httpx.ConnectError:
            status_area.error(
                "Cannot connect to RM Prep Agent. "
                f"Check that the service is running at {RM_PREP_AGENT_URL}."
            )
            brief_content = "Connection failed — see error above."
        except httpx.HTTPStatusError as exc:
            status_area.error(f"Agent returned error {exc.response.status_code}.")
            brief_content = f"HTTP error {exc.response.status_code}"
        except Exception as exc:
            status_area.error(f"Unexpected error: {exc}")
            brief_content = f"Error: {exc}"

    # Save to history so follow-ups have context
    if brief_content:
        st.session_state.messages.append({"role": "assistant", "content": brief_content})
