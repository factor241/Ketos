"""Input and output handlers for Ketos type transformations.

Input handlers dispatch on template field metadata and/or runtime value content
to transform parameter values before component execution.

Output handlers dispatch on Python type to serialize execution results back to
JSON-compatible formats with type markers.
"""

from .base import InputHandler, OutputHandler
from .base_model import BaseModelInputHandler, BaseModelOutputHandler
from .dataframe import DataFrameConversionInputHandler, DataFrameOutputHandler
from .ketos_types import KetosTypeInputHandler, KetosTypeOutputHandler
from .string_coercion import StringCoercionInputHandler
from .tool_wrapper import ToolWrapperInputHandler

__all__ = [
    "InputHandler",
    "OutputHandler",
    "BaseModelInputHandler",
    "BaseModelOutputHandler",
    "DataFrameConversionInputHandler",
    "DataFrameOutputHandler",
    "KetosTypeInputHandler",
    "KetosTypeOutputHandler",
    "StringCoercionInputHandler",
    "ToolWrapperInputHandler",
]
