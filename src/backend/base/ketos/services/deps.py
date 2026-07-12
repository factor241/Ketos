from __future__ import annotations

from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Union

from ketos.services.schema import ServiceType

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

    from sqlmodel.ext.asyncio.session import AsyncSession

    from ketos.services.cache.service import AsyncBaseCacheService, CacheService
    from ketos.services.chat.service import ChatService
    from ketos.services.database.service import DatabaseService
    from ketos.services.session.service import SessionService
    from ketos.services.state.service import StateService
    from ketos.services.store.service import StoreService
    from ketos.services.task.service import TaskService
    from ketos.services.tracing.service import TracingService
    from ketos.services.variable.service import VariableService

# These imports MUST be outside TYPE_CHECKING because FastAPI uses eval_str=True
# to evaluate type annotations, and these types are used as return types for
# dependency functions that FastAPI evaluates at module load time.
from kfx.services.auth.base import BaseAuthService  # noqa: TC002
from kfx.services.authorization.base import BaseAuthorizationService  # noqa: TC002
from kfx.services.settings.service import SettingsService  # noqa: TC002

from ketos.services.job_queue.service import JobQueueService  # noqa: TC001
from ketos.services.storage.service import StorageService  # noqa: TC001
from ketos.services.telemetry.service import TelemetryService  # noqa: TC001


def get_service(service_type: ServiceType, default=None):
    """Retrieves the service instance for the given service type.

    Args:
        service_type (ServiceType): The type of service to retrieve.
        default (ServiceFactory, optional): The default ServiceFactory to use if the service is not found.
            Defaults to None.

    Returns:
        Any: The service instance.

    """
    from kfx.services.manager import get_service_manager

    service_manager = get_service_manager()

    if not service_manager.are_factories_registered():
        # ! This is a workaround to ensure that the service manager is initialized
        # ! Not optimal, but it works for now
        from ketos.services.manager import ServiceManager

        service_manager.register_factories(ServiceManager.get_factories())
    return service_manager.get(service_type, default)


def get_telemetry_service() -> TelemetryService:
    """Retrieves the TelemetryService instance from the service manager.

    Returns:
        TelemetryService: The TelemetryService instance.
    """
    from ketos.services.telemetry.factory import TelemetryServiceFactory

    return get_service(ServiceType.TELEMETRY_SERVICE, TelemetryServiceFactory())


def get_tracing_service() -> TracingService:
    """Retrieves the TracingService instance from the service manager.

    Returns:
        TracingService: The TracingService instance.
    """
    from ketos.services.tracing.factory import TracingServiceFactory

    return get_service(ServiceType.TRACING_SERVICE, TracingServiceFactory())


def get_state_service() -> StateService:
    """Retrieves the StateService instance from the service manager.

    Returns:
        The StateService instance.
    """
    from ketos.services.state.factory import StateServiceFactory

    return get_service(ServiceType.STATE_SERVICE, StateServiceFactory())


def get_storage_service() -> StorageService:
    """Retrieves the storage service instance.

    Returns:
        The storage service instance.
    """
    from ketos.services.storage.factory import StorageServiceFactory

    return get_service(ServiceType.STORAGE_SERVICE, default=StorageServiceFactory())


def get_variable_service() -> VariableService:
    """Retrieves the VariableService instance from the service manager.

    Returns:
        The VariableService instance.

    """
    from ketos.services.variable.factory import VariableServiceFactory

    return get_service(ServiceType.VARIABLE_SERVICE, VariableServiceFactory())


def is_settings_service_initialized() -> bool:
    """Check if the SettingsService is already initialized without triggering initialization.

    Returns:
        bool: True if the SettingsService is already initialized, False otherwise.
    """
    from kfx.services.manager import get_service_manager

    return ServiceType.SETTINGS_SERVICE in get_service_manager().services


def get_settings_service() -> SettingsService:
    """Retrieves the SettingsService instance.

    If the service is not yet initialized, it will be initialized before returning.

    Returns:
        The SettingsService instance.

    Raises:
        ValueError: If the service cannot be retrieved or initialized.
    """
    from kfx.services.settings.factory import SettingsServiceFactory

    return get_service(ServiceType.SETTINGS_SERVICE, SettingsServiceFactory())


def get_db_service() -> DatabaseService:
    """Retrieves the DatabaseService instance from the service manager.

    Returns:
        The DatabaseService instance.

    """
    from ketos.services.database.factory import DatabaseServiceFactory

    return get_service(ServiceType.DATABASE_SERVICE, DatabaseServiceFactory())


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    msg = "get_session is deprecated, use session_scope instead"
    raise NotImplementedError(msg)


@asynccontextmanager
async def session_scope() -> AsyncGenerator[AsyncSession, None]:
    """Context manager for managing an async session scope.

    This context manager is used to manage an async session scope for database operations.
    It ensures that the session is properly committed if no exceptions occur,
    and rolled back if an exception is raised.

    Yields:
        AsyncSession: The async session object.

    Raises:
        Exception: If an error occurs during the session scope.

    """
    from kfx.services.deps import session_scope as kfx_session_scope

    async with kfx_session_scope() as session:
        yield session


def get_cache_service() -> Union[CacheService, AsyncBaseCacheService]:  # noqa: UP007
    """Retrieves the cache service from the service manager.

    Returns:
        The cache service instance.
    """
    from ketos.services.cache.factory import CacheServiceFactory

    return get_service(ServiceType.CACHE_SERVICE, CacheServiceFactory())


def get_shared_component_cache_service() -> CacheService:
    """Retrieves the cache service from the service manager.

    Returns:
        The cache service instance.
    """
    from ketos.services.shared_component_cache.factory import SharedComponentCacheServiceFactory

    return get_service(ServiceType.SHARED_COMPONENT_CACHE_SERVICE, SharedComponentCacheServiceFactory())


def get_session_service() -> SessionService:
    """Retrieves the session service from the service manager.

    Returns:
        The session service instance.
    """
    from ketos.services.session.factory import SessionServiceFactory

    return get_service(ServiceType.SESSION_SERVICE, SessionServiceFactory())


def get_task_service() -> TaskService:
    """Retrieves the TaskService instance from the service manager.

    Returns:
        The TaskService instance.

    """
    from ketos.services.task.factory import TaskServiceFactory

    return get_service(ServiceType.TASK_SERVICE, TaskServiceFactory())


def get_chat_service() -> ChatService:
    """Get the chat service instance.

    Returns:
        ChatService: The chat service instance.
    """
    return get_service(ServiceType.CHAT_SERVICE)


def get_store_service() -> StoreService:
    """Retrieves the StoreService instance from the service manager.

    Returns:
        StoreService: The StoreService instance.
    """
    return get_service(ServiceType.STORE_SERVICE)


def get_queue_service() -> JobQueueService:
    """Retrieves the QueueService instance from the service manager."""
    from ketos.services.job_queue.factory import JobQueueServiceFactory

    return get_service(ServiceType.JOB_QUEUE_SERVICE, JobQueueServiceFactory())


def get_auth_service() -> BaseAuthService:
    """Retrieve the authentication service."""
    from ketos.services.auth.factory import AuthServiceFactory

    return get_service(ServiceType.AUTH_SERVICE, AuthServiceFactory())


def get_authorization_service() -> BaseAuthorizationService:
    """Retrieve the authorization service."""
    from ketos.services.authorization.factory import AuthorizationServiceFactory

    return get_service(ServiceType.AUTHORIZATION_SERVICE, AuthorizationServiceFactory())


def get_job_service():
    """Retrieves the JobService instance from the service manager.

    Returns:
        JobService: The JobService instance.
    """
    from ketos.services.jobs.factory import JobServiceFactory

    return get_service(ServiceType.JOB_SERVICE, JobServiceFactory())


def get_flow_events_service():
    from ketos.services.flow_events.factory import FlowEventsServiceFactory

    return get_service(ServiceType.FLOW_EVENTS_SERVICE, FlowEventsServiceFactory())


def get_memory_base_service():
    """Retrieves the MemoryBaseService instance from the service manager."""
    from ketos.services.memory_base.factory import MemoryBaseServiceFactory

    return get_service(ServiceType.MEMORY_BASE_SERVICE, MemoryBaseServiceFactory())


def get_telemetry_writer_service():
    """Return the TelemetryWriterService instance (always registered when ketos is installed)."""
    from ketos.services.telemetry_writer.factory import TelemetryWriterServiceFactory

    return get_service(ServiceType.TELEMETRY_WRITER_SERVICE, TelemetryWriterServiceFactory())
