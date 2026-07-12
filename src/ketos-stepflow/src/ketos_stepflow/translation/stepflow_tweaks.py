"""Stepflow-level tweaks for Ketos component configuration.

This module provides utilities for applying tweaks to Stepflow workflows
that were translated from Ketos. Tweaks are applied by modifying the
input fields of Ketos UDF executor steps before execution.

Key features:
- Apply tweaks to translated Stepflow workflows at execution time
- Target UDF executor steps using original Ketos node IDs
- Modify step input fields directly (not blob data)
- Compatible with Ketos API tweak format

Note: Test utilities and environment variable integration are in
tests/helpers/tweaks_builder.py to keep this production code lean.
"""

import copy
from typing import Any

from ketos_stepflow.protocol import validate_component_route, validate_step_id


def apply_stepflow_tweaks_to_dict(
    workflow_dict: dict[str, Any],
    tweaks: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Apply tweaks to a Stepflow workflow dict.

    Args:
        workflow_dict: Stepflow workflow as dict (from YAML)
        tweaks: Dict mapping ketos_node_id -> {field_name: new_value}

    Returns:
        Modified workflow dict with tweaks applied

    Examples:
        >>> tweaks = {
        ...     "LanguageModelComponent-kBOja": {
        ...         "api_key": "new_test_key",  # pragma: allowlist secret
        ...         "temperature": 0.8,
        ...     }
        ... }
        >>> modified_dict = apply_stepflow_tweaks_to_dict(workflow_dict, tweaks)
    """
    for step_dict in workflow_dict.get("steps", []):
        validate_step_id(str(step_dict.get("id", "")))
        validate_component_route(str(step_dict.get("component", "")))

    if not tweaks:
        return workflow_dict

    # Deep copy to avoid mutating original
    modified_dict = copy.deepcopy(workflow_dict)

    for step_dict in modified_dict.get("steps", []):
        step_id = step_dict.get("id", "")
        component = step_dict.get("component", "")

        # Check if this is a Ketos executor step (custom_code or core)
        is_ketos_step = (
            step_id.startswith("ketos_")
            and not step_id.endswith("_blob")
            and (component == "/ketos/custom_code" or component.startswith("/ketos/core/"))
        )

        if is_ketos_step:
            # Extract Ketos node ID
            ketos_node_id = step_id[len("ketos_") :]

            if ketos_node_id in tweaks:
                # Ensure step has input section
                if "input" not in step_dict:
                    step_dict["input"] = {}
                if "input" not in step_dict["input"]:
                    step_dict["input"]["input"] = {}

                # Apply tweaks
                for field_name, new_value in tweaks[ketos_node_id].items():
                    step_dict["input"]["input"][field_name] = new_value

    return modified_dict


def convert_tweaks_to_overrides(
    tweaks: dict[str, dict[str, Any]] | None = None,
) -> dict[str, dict[str, Any]] | None:
    """Convert Ketos tweaks format to Stepflow overrides format.

    This function transforms tweaks from the early binding format (modifying flow)
    to the late binding format (runtime overrides). Instead of modifying the flow
    directly, we create overrides that are applied at execution time.

    Args:
        tweaks: Dict mapping ketos_node_id -> {field_name: new_value}

    Returns:
        Dict mapping step_id to merge_patch format with field overrides
        or None if no tweaks provided

    Examples:
        >>> tweaks = {
        ...     "LanguageModelComponent-kBOja": {
        ...         "api_key": "new_test_key",  # pragma: allowlist secret
        ...         "temperature": 0.8,
        ...     }
        ... }
        >>> overrides = convert_tweaks_to_overrides(tweaks)
        >>> print(overrides)
        {
            "ketos_LanguageModelComponent-kBOja": {
                "$type": "merge_patch",
                "value": {
                    "input": {
                        "api_key": "new_test_key",  # pragma: allowlist secret
                        "temperature": 0.8,
                    }
                }
            }
        }
    """
    if not tweaks:
        return None

    overrides = {}

    for ketos_node_id, field_tweaks in tweaks.items():
        # Convert Ketos node ID to Stepflow step ID format
        step_id = f"ketos_{ketos_node_id}"

        # Create the override value structure that matches step.input structure
        # We need to wrap the field tweaks in an "input.input" key to match how
        # the current tweaks modify step.input["input"][field_name]
        override_value = {"input": {"input": field_tweaks}}

        # Create the override entry with merge patch type (snake_case for API)
        overrides[step_id] = {"$type": "merge_patch", "value": override_value}

    return overrides


# Export main functions for easy importing
__all__ = [
    "apply_stepflow_tweaks_to_dict",
    "convert_tweaks_to_overrides",
]
