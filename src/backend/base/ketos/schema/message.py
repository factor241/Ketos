"""Message class for ketos - imports from kfx.

This maintains backward compatibility while using the kfx implementation.
"""

# Import and re-export to ensure class identity is preserved
from kfx.schema.message import (
    MAX_ATTACHMENT_SIZE_BYTES,
    ContentBlock,
    DefaultModel,
    ErrorMessage,
    Message,
    MessageResponse,
)

__all__ = [
    "MAX_ATTACHMENT_SIZE_BYTES",
    "ContentBlock",
    "DefaultModel",
    "ErrorMessage",
    "Message",
    "MessageResponse",
]
