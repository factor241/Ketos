"""Typed additive API error envelopes used by localized first-party clients."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

JsonScalar = str | int | float | bool | None


class ApiFieldError(BaseModel):
    """One stable validation failure with a machine-readable field path."""

    model_config = ConfigDict(extra="forbid")

    code: str
    location: str
    path: list[str | int]
    message: str
    params: dict[str, JsonScalar] = Field(default_factory=dict)


class ApiErrorResponse(BaseModel):
    """New stable fields plus legacy English ``detail``/``message`` fallbacks."""

    model_config = ConfigDict(extra="forbid")

    code: str
    detail: str | list[dict[str, Any]] | dict[str, Any]
    message: str
    params: dict[str, JsonScalar] = Field(default_factory=dict)
    field_errors: list[ApiFieldError] = Field(default_factory=list, exclude_if=lambda value: not value)
