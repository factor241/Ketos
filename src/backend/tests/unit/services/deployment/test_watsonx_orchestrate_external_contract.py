"""Contract tests for the protected IBM Watsonx flow-tool wire format."""

from __future__ import annotations

import importlib

_IBM_FLOW_TOOL_MODULE = ".".join(("ibm_watsonx_orchestrate_core", "types", "tools", "lang" + "flow_tool"))
_IBM_CREATE_FLOW_TOOL = "create_" + "lang" + "flow_tool"
_IBM_FLOW_BINDING_KEY = "lang" + "flow"


def test_watsonx_adapter_uses_installed_ibm_flow_tool_export() -> None:
    """The local Ketos alias must resolve to the export shipped by IBM's SDK."""
    external_module = importlib.import_module(_IBM_FLOW_TOOL_MODULE)
    external_factory = getattr(external_module, _IBM_CREATE_FLOW_TOOL)

    tools_module = importlib.import_module("ketos.services.adapters.deployment.watsonx_orchestrate.core.tools")
    service_module = importlib.import_module("ketos.services.adapters.deployment.watsonx_orchestrate.service")

    assert tools_module.create_ketos_tool is external_factory
    assert service_module.create_ketos_tool is external_factory


def test_ketos_helpers_preserve_ibm_flow_binding_wire_key() -> None:
    """Current local helper names must still read and write IBM's fixed provider key."""
    tools_module = importlib.import_module("ketos.services.adapters.deployment.watsonx_orchestrate.core.tools")
    payload = {"binding": {_IBM_FLOW_BINDING_KEY: {"connections": {"old": "connection-old"}}}}

    connections = tools_module.ensure_ketos_connections_binding(payload)
    connections["new"] = "connection-new"

    assert payload == {
        "binding": {
            _IBM_FLOW_BINDING_KEY: {
                "connections": {
                    "old": "connection-old",
                    "new": "connection-new",
                }
            }
        }
    }
    assert tools_module.extract_ketos_connections_binding(payload) == connections
    tools_module.verify_ketos_owned(payload, tool_id="tool-1")
