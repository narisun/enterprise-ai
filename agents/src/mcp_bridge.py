"""
MCPToolBridge — connects to an MCP server over SSE and converts every
registered tool into a LangChain StructuredTool with a dynamically
generated Pydantic schema.

Key improvements over the original:
- Reads each tool's inputSchema and builds a proper Pydantic args model
  instead of assuming (query, session_id) for every tool.
- Uses a factory function to capture the closure variable correctly.
- Structured logging throughout.
"""
from typing import Any, Optional

from langchain_core.tools import StructuredTool
from mcp.client.sse import sse_client
from mcp.client.session import ClientSession
from platform_sdk import get_logger
from pydantic import create_model

# Use structlog logger (supports keyword args) rather than standard logging.getLogger()
log = get_logger(__name__)

# Maps JSON Schema primitive types to Python types
_JSON_TYPE_MAP: dict[str, type] = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
    "object": dict,
    "array": list,
}


def _build_args_model(tool_name: str, input_schema: dict) -> type:
    """
    Dynamically create a Pydantic BaseModel from a JSON Schema object.

    This makes the MCP bridge truly generic — it works with any tool
    regardless of its parameter names or types.
    """
    fields: dict[str, Any] = {}
    properties = input_schema.get("properties", {})
    required_fields = set(input_schema.get("required", []))

    for field_name, field_schema in properties.items():
        python_type = _JSON_TYPE_MAP.get(field_schema.get("type", "string"), str)
        description = field_schema.get("description", "")
        if field_name in required_fields:
            from pydantic import Field
            fields[field_name] = (python_type, Field(..., description=description))
        else:
            default = field_schema.get("default")
            from pydantic import Field
            fields[field_name] = (Optional[python_type], Field(default=default, description=description))

    model_name = "".join(word.title() for word in tool_name.split("_")) + "Args"
    return create_model(model_name, **fields)


def _make_invoke_fn(session: ClientSession, tool_name: str):
    """
    Factory that returns an async callable bound to a specific tool name.

    Using a factory avoids the classic loop-closure bug where all tools
    end up calling the last tool in the list.
    """
    async def invoke(**kwargs: Any) -> str:
        try:
            log.debug("mcp_tool_call", tool=tool_name, args=list(kwargs.keys()))
            result = await session.call_tool(tool_name, arguments=kwargs)
            if result.content:
                return result.content[0].text
            return "Tool returned no content."
        except Exception as exc:
            log.error("mcp_tool_error", tool=tool_name, error=str(exc))
            return f"Tool execution error: {exc}"

    invoke.__name__ = tool_name
    return invoke


class MCPToolBridge:
    """Manages the SSE connection lifecycle to one MCP server."""

    def __init__(self, sse_url: str) -> None:
        self.sse_url = sse_url
        self._session: Optional[ClientSession] = None
        self._exit_stack = None

    async def connect(self) -> "MCPToolBridge":
        """Establish the SSE connection and run the MCP handshake."""
        from contextlib import AsyncExitStack
        self._exit_stack = AsyncExitStack()
        streams = await self._exit_stack.enter_async_context(sse_client(self.sse_url))
        self._session = await self._exit_stack.enter_async_context(
            ClientSession(streams[0], streams[1])
        )
        await self._session.initialize()
        log.info("mcp_connected", url=self.sse_url)
        return self

    async def disconnect(self) -> None:
        """Cleanly close all streams."""
        if self._exit_stack:
            await self._exit_stack.aclose()
            log.info("mcp_disconnected", url=self.sse_url)

    async def get_langchain_tools(self) -> list[StructuredTool]:
        """
        Fetch all tools from the MCP server and return them as LangChain tools.

        Each tool's JSON Schema is used to build a typed Pydantic model,
        so LangGraph can validate arguments before dispatching.
        """
        if not self._session:
            raise RuntimeError("Call connect() before get_langchain_tools()")

        mcp_tools = await self._session.list_tools()
        langchain_tools: list[StructuredTool] = []

        for tool in mcp_tools.tools:
            input_schema = getattr(tool, "inputSchema", None) or {}
            invoke_fn = _make_invoke_fn(self._session, tool.name)

            kwargs: dict[str, Any] = dict(
                coroutine=invoke_fn,
                name=tool.name,
                description=tool.description or f"Executes the {tool.name} tool.",
            )
            if input_schema.get("properties"):
                kwargs["args_schema"] = _build_args_model(tool.name, input_schema)

            langchain_tools.append(StructuredTool.from_function(**kwargs))
            log.debug("mcp_tool_registered", tool=tool.name)

        log.info("mcp_tools_loaded", count=len(langchain_tools))
        return langchain_tools
