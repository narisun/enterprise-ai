"""P0 regression: MCPToolBridge._convert_schema raises on unsupported JSON Schema keywords."""
import pytest

from platform_sdk.errors import UnsupportedSchemaError
from platform_sdk.mcp_bridge import MCPToolBridge

pytestmark = pytest.mark.unit


def test_ref_raises():
    bridge = MCPToolBridge(sse_url="http://127.0.0.1:0")
    with pytest.raises(UnsupportedSchemaError) as exc:
        bridge._convert_schema("fetch_x", {"$ref": "#/defs/foo"})
    assert exc.value.tool_name == "fetch_x"
    assert exc.value.keyword == "$ref"


def test_allof_raises():
    bridge = MCPToolBridge(sse_url="http://127.0.0.1:0")
    with pytest.raises(UnsupportedSchemaError) as exc:
        bridge._convert_schema("fetch_x", {"allOf": [{}, {}]})
    assert exc.value.keyword == "allOf"


def test_anyof_raises():
    bridge = MCPToolBridge(sse_url="http://127.0.0.1:0")
    with pytest.raises(UnsupportedSchemaError) as exc:
        bridge._convert_schema("fetch_x", {"anyOf": [{}, {}]})
    assert exc.value.keyword == "anyOf"


def test_oneof_raises():
    bridge = MCPToolBridge(sse_url="http://127.0.0.1:0")
    with pytest.raises(UnsupportedSchemaError) as exc:
        bridge._convert_schema("fetch_x", {"oneOf": [{}, {}]})
    assert exc.value.keyword == "oneOf"


def test_plain_object_passes():
    bridge = MCPToolBridge(sse_url="http://127.0.0.1:0")
    # Standard object schema must NOT raise; method returns the args model.
    model = bridge._convert_schema(
        "fetch_x",
        {"type": "object", "properties": {"q": {"type": "string"}}, "required": ["q"]},
    )
    # _build_args_model returns a dynamic Pydantic class.
    assert model is not None


def test_empty_schema_passes():
    bridge = MCPToolBridge(sse_url="http://127.0.0.1:0")
    # Empty schema is valid — no top-level unsupported keywords.
    model = bridge._convert_schema("fetch_x", {})
    assert model is not None
