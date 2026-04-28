# Vulture allowlist — names that look unused but ARE reached at runtime.
# Run: vulture <paths> cleanup/vulture-allowlist.py --min-confidence 80
#
# Format: each line is a `_.<name>` reference. Vulture treats this file
# as code that uses the listed names, suppressing false positives.

# FastAPI route handlers (decorators register them; vulture can't see calls)
_.startup
_.shutdown
_.lifespan
_.health
_.root

# LangGraph node __call__ handlers — invoked by the StateGraph runtime
_.__call__

# Pydantic v2 model_config / model_validator hooks
_.model_config
_.model_post_init
_.model_validate
_.model_dump

# pytest fixtures and conftest hooks
_.pytest_collection_modifyitems
_.pytest_configure
_.pytest_sessionstart
_.pytest_sessionfinish

# MCP server handler decorators
_.list_tools
_.call_tool
_.list_resources
_.read_resource

# OpenTelemetry / structlog setup hooks called by string
_.configure_logging
_.configure_tracing
