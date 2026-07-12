"""Standalone Stepflow component server for Ketos integration.

Run with: python -m ketos_stepflow.worker
"""

from typing import Any

from stepflow_py.worker import StepflowContext, StepflowServer

from ketos_stepflow.worker import DEFAULT_OTEL_SERVICE_NAME
from ketos_stepflow.worker.component_tool import component_tool_executor
from ketos_stepflow.worker.core_executor import CoreExecutor
from ketos_stepflow.worker.custom_code_executor import CustomCodeExecutor


def get_service_name() -> str:
    """Return the explicit OTel resource identity for this worker."""
    import os

    return os.environ.get("STEPFLOW_SERVICE_NAME", DEFAULT_OTEL_SERVICE_NAME)


def configure_observability_environment() -> str:
    """Install the Ketos OTel identity before Stepflow constructs its config."""
    import os

    os.environ.setdefault("STEPFLOW_SERVICE_NAME", DEFAULT_OTEL_SERVICE_NAME)
    return os.environ["STEPFLOW_SERVICE_NAME"]

# Create server instance
server = StepflowServer()

# Create executors
custom_code_executor = CustomCodeExecutor()
core_executor = CoreExecutor()


@server.component(name="custom_code")
async def custom_code_component(input_data: dict[str, Any], context: StepflowContext) -> dict[str, Any]:
    """Execute a Ketos custom code component."""
    return await custom_code_executor.execute(input_data, context)


@server.component(name="core/{*component}")
async def core_component(
    input_data: dict[str, Any],
    context: StepflowContext,
    component: str,
) -> dict[str, Any]:
    """Execute a known core Ketos component by module path."""
    return await core_executor.execute(component, input_data, context)


@server.component(name="component_tool")
async def component_tool_component(input_data: dict[str, Any], context: StepflowContext) -> dict[str, Any]:
    """Create tool wrappers from Ketos components."""
    return await component_tool_executor(input_data, context)


def main():
    """Main entry point for the Ketos component server.

    Logging is automatically configured by the SDK via setup_observability().
    Configure via environment variables:
    - STEPFLOW_TASKS_URL: TasksService gRPC address (default: localhost:7837)
    - STEPFLOW_QUEUE_NAME: Queue name for gRPC transport (default: ketos)
    - STEPFLOW_MAX_CONCURRENT: Max concurrent tasks (default: 4)
    - STEPFLOW_LOG_LEVEL: Log level (DEBUG, INFO, WARNING, ERROR, default: INFO)
    - STEPFLOW_LOG_DESTINATION: Log destination (stderr, file, otlp)
    - STEPFLOW_OTLP_ENDPOINT: OTLP endpoint for tracing/logging
    - STEPFLOW_SERVICE_NAME: Service name (default: ketos-stepflow)
    """
    import argparse
    import asyncio
    import os

    import nest_asyncio  # type: ignore
    from stepflow_py.worker.observability import setup_observability

    configure_observability_environment()
    setup_observability()

    nest_asyncio.apply()

    if os.environ.get("KETOS_DATABASE_URL"):
        from ketos.services.utils import initialize_services, teardown_services

        # Teardown first to clear any stale state from a previous run,
        # then initialize fresh services for this worker process.
        asyncio.run(teardown_services())
        asyncio.run(initialize_services())

    parser = argparse.ArgumentParser(description="Ketos Stepflow Component Server")
    parser.add_argument(
        "--tasks-url",
        type=str,
        default=os.environ.get("STEPFLOW_TASKS_URL", "localhost:7837"),
        help="TasksService gRPC address (env: STEPFLOW_TASKS_URL)",
    )
    parser.add_argument(
        "--queue-name",
        type=str,
        default=os.environ.get("STEPFLOW_QUEUE_NAME", "ketos"),
        help="Queue name for gRPC transport (env: STEPFLOW_QUEUE_NAME)",
    )
    parser.add_argument(
        "--max-concurrent",
        type=int,
        default=int(os.environ.get("STEPFLOW_MAX_CONCURRENT", "4")),
        help="Max concurrent tasks (env: STEPFLOW_MAX_CONCURRENT)",
    )
    args = parser.parse_args()

    from ketos_stepflow.protocol import validate_queue_name

    validate_queue_name(args.queue_name)

    from stepflow_py.worker.grpc_worker import run_grpc_worker

    asyncio.run(
        run_grpc_worker(
            server=server,
            tasks_url=args.tasks_url,
            queue_name=args.queue_name,
            max_concurrent=args.max_concurrent,
        )
    )


if __name__ == "__main__":
    main()
