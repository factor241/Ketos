"""JSON and Data classes for ketos - imports from kfx.

This maintains backward compatibility while using the kfx implementation.
JSON is the new base type; Data is an alias for backwards compatibility.
"""

from kfx.schema.data import JSON, Data, custom_serializer, serialize_data

__all__ = ["JSON", "Data", "custom_serializer", "serialize_data"]
