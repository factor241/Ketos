"""Authorization service factory."""

from __future__ import annotations

from typing import TYPE_CHECKING

from ketos.services.factory import ServiceFactory
from ketos.services.schema import ServiceType

if TYPE_CHECKING:
    from kfx.services.authorization.base import BaseAuthorizationService
    from kfx.services.settings.service import SettingsService

    from ketos.services.authorization.service import KetosAuthorizationService


class AuthorizationServiceFactory(ServiceFactory):
    """Factory that creates the Ketos authorization service."""

    name = ServiceType.AUTHORIZATION_SERVICE.value

    service_class: type[KetosAuthorizationService]

    def __init__(self) -> None:
        """Bind the factory to the KetosAuthorizationService implementation."""
        from ketos.services.authorization.service import KetosAuthorizationService

        super().__init__(KetosAuthorizationService)

    def create(self, settings_service: SettingsService) -> BaseAuthorizationService:
        """Build a KetosAuthorizationService using the injected settings service."""
        return self.service_class(settings_service)
