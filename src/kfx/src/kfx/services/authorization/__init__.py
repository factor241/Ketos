"""KFX authorization service package (abstract base + default no-op allow-all implementation)."""

from kfx.services.authorization.base import BaseAuthorizationService
from kfx.services.authorization.service import AuthorizationService

__all__ = ["AuthorizationService", "BaseAuthorizationService"]
