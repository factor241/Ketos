"""Fail-closed validation for Ketos-only Stepflow protocol values."""

from __future__ import annotations

_OLD_PRODUCT = "lang" + "flow"
_OLD_STEP_ID_PREFIX = _OLD_PRODUCT + "_"
_OLD_ROUTE_PREFIX = "/" + _OLD_PRODUCT + "/"


def validate_step_id(value: str) -> str:
    if value.lower().startswith(_OLD_STEP_ID_PREFIX):
        raise ValueError("Legacy Stepflow step ID is not supported")
    return value


def validate_component_route(value: str) -> str:
    if value.lower().startswith(_OLD_ROUTE_PREFIX):
        raise ValueError("Legacy Stepflow component route is not supported")
    return value


def validate_queue_name(value: str) -> str:
    if value.lower() == _OLD_PRODUCT:
        raise ValueError("Legacy Stepflow queue is not supported")
    if value != "ketos":
        raise ValueError("Stepflow queue must be 'ketos'")
    return value
