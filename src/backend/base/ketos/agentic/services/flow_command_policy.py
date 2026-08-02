from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

_ALLOWED_TOOL_NAMES = frozenset({"SearchComponentTypes", "DescribeComponentType", "ProposeFlowChanges"})
_FORBIDDEN_KEYS = frozenset(
    {
        "auto_apply",
        "autoapply",
        "skip_all",
        "skipall",
        "command_resume",
        "forwarded_props",
        "filesystem",
        "mcp",
        "model",
        "provider",
        "code",
        "python",
    }
)


class FlowCommandPolicyError(ValueError):
    pass


def reject_flow_command_bypass(value: Any) -> None:
    """Fail closed on nested authority and legacy-resume bypass attempts."""
    if isinstance(value, Mapping):
        for key, item in value.items():
            normalized = str(key).replace("-", "_").lower()
            compact = normalized.replace("_", "")
            if normalized in _FORBIDDEN_KEYS or compact in _FORBIDDEN_KEYS:
                message = "flow_command_bypass_denied"
                raise FlowCommandPolicyError(message)
            reject_flow_command_bypass(item)
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        for item in value:
            reject_flow_command_bypass(item)


def assert_proposal_toolkit_safe(tool_names: Sequence[str]) -> None:
    if not tool_names or any(name not in _ALLOWED_TOOL_NAMES for name in tool_names):
        message = "flow_command_toolkit_denied"
        raise FlowCommandPolicyError(message)


__all__ = ["FlowCommandPolicyError", "assert_proposal_toolkit_safe", "reject_flow_command_bypass"]
