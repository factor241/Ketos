"""Ketos Assistant API router.

This module provides the HTTP endpoints for the Ketos Assistant.
All business logic is delegated to service modules.
"""

import asyncio
import os
import uuid
from collections.abc import Callable, Mapping
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from ag_ui.core import (
    Interrupt as AgUiInterrupt,
)
from ag_ui.core import (
    MessagesSnapshotEvent,
    RunFinishedEvent,
    RunFinishedInterruptOutcome,
    RunStartedEvent,
)
from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from kfx.base.models.unified_models import (
    get_all_variables_for_provider,
    get_model_provider_variable_mapping,
    get_provider_required_variable_keys,
    get_unified_models_detailed,
)
from kfx.log.logger import logger
from kfx.services.settings.feature_flags import FEATURE_FLAGS
from sqlalchemy.ext.asyncio import AsyncSession

from ketos.agentic.api.ag_ui_router import create_ag_ui_router
from ketos.agentic.api.schemas import AssistantRequest
from ketos.agentic.services.assistant_service import (
    execute_flow_with_validation,
    execute_flow_with_validation_streaming,
)
from ketos.agentic.services.flow_executor import execute_flow_file
from ketos.agentic.services.flow_types import (
    KETOS_ASSISTANT_FLOW,
    MAX_VALIDATION_RETRIES,
)
from ketos.agentic.services.provider_service import (
    PREFERRED_PROVIDERS,
    get_default_model,
    get_enabled_providers_for_user,
    list_installed_tool_calling_models,
)
from ketos.api.utils.core import CurrentActiveUser, DbSession

if TYPE_CHECKING:
    from ag_ui.core.types import RunAgentInput
    from ag_ui_langgraph import LangGraphAgent
    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

    from ketos.agentic.services.ag_ui.stage01_runtime import Stage01AgUiRuntime

router = APIRouter(prefix="/agentic", tags=["Agentic"])

_STAGE01_REGISTERED_STATE_KEY = "_ketos_stage01_ag_ui_registered"
_STAGE01_ROUTES_STATE_KEY = "_ketos_stage01_ag_ui_routes"
_RECOVERY_MARKER_LIMIT = 4096


def _resolved_rejection(input_data: "RunAgentInput") -> tuple[str, bool] | None:
    entries = tuple(input_data.resume or ())
    if len(entries) != 1:
        return None
    entry = entries[0]
    payload = entry.payload
    if entry.status != "resolved" or not isinstance(payload, Mapping) or set(payload) != {"approved"}:
        return None
    if payload.get("approved") is not False:
        return None
    return entry.interrupt_id, False


def create_stage09_recovery_before_dispatch(
    original_before_dispatch: Callable,
    *,
    checkpointer: "AsyncSqliteSaver",
) -> Callable:
    """Resolve an exact persisted command rejection before model assembly.

    Non-recovery requests continue through the frozen Stage-05 durable binding.
    """
    from ketos.agentic.services.ag_ui.auth import AG_UI_ACTOR_STATE_KEY
    from ketos.services.chat_threads.messages import build_messages_snapshot
    from ketos.services.commands import service as command_service
    from ketos.services.commands.recovery import (
        CommandCheckpointInspector,
        CommandRecoveryProofError,
        recover_pending_command,
        resolve_recovered_command,
    )
    from ketos.services.deps import session_scope

    inspector = CommandCheckpointInspector()
    recovery_resolution_lock = asyncio.Lock()
    recovered_interrupts: dict[tuple[str, str], bool] = {}

    async def before_dispatch(
        input_data: "RunAgentInput",
        request: Request,
        request_agent: "LangGraphAgent",
    ) -> None:
        rejection = _resolved_rejection(input_data)
        if rejection is None and input_data.resume:
            await original_before_dispatch(input_data, request, request_agent)
            return
        try:
            actor_id = UUID(str(getattr(request.state, AG_UI_ACTOR_STATE_KEY, None)))
            chat_id = UUID(input_data.thread_id)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=403, detail="Invalid AG-UI recovery owner binding") from exc

        recovery_key: tuple[str, str] | None = None
        if rejection is not None:
            recovery_key = (str(chat_id), rejection[0])
            async with recovery_resolution_lock:
                recovery_state = recovered_interrupts.get(recovery_key)
            if recovery_state is False:
                raise HTTPException(status_code=409, detail="AG-UI recovery decision is no longer open")
            if recovery_state is not True:
                await original_before_dispatch(input_data, request, request_agent)
                return

        if rejection is None:
            open_interrupts = await inspector.open_interrupts(checkpointer, str(chat_id))
            if len(open_interrupts) != 1:
                await original_before_dispatch(input_data, request, request_agent)
                return
            proof = open_interrupts[0]
            async with session_scope() as session:
                proposal = await command_service.load_authorized_proposal(
                    session,
                    proposal_id=proof.proposal_id,
                    actor_id=actor_id,
                )
                try:
                    await recover_pending_command(
                        session=session,
                        checkpointer=checkpointer,
                        checkpoint_inspector=inspector,
                        command_service=command_service,
                        actor_id=actor_id,
                        chat_run_id=proposal.chat_run_id,
                        proposal_id=proposal.id,
                    )
                except CommandRecoveryProofError as exc:
                    raise HTTPException(
                        status_code=409,
                        detail="AG-UI recovery decision is no longer open",
                    ) from exc
                snapshot = await build_messages_snapshot(
                    session=session,
                    owner_id=actor_id,
                    chat_id=chat_id,
                )
            value = proof.value
            interrupt = AgUiInterrupt(
                id=proof.interrupt_id,
                reason=str(value["reason"]),
                message=str(value["message"]),
                responseSchema=dict(value["responseSchema"]),
                metadata=dict(value["metadata"]),
            )

            async def recovered_pending_run(_input: "RunAgentInput"):
                yield RunStartedEvent(threadId=str(chat_id), runId=input_data.run_id)
                yield MessagesSnapshotEvent(messages=list(snapshot.messages))
                yield RunFinishedEvent(
                    threadId=str(chat_id),
                    runId=input_data.run_id,
                    outcome=RunFinishedInterruptOutcome(interrupts=[interrupt]),
                )

            async with recovery_resolution_lock:
                recovery_key = (str(chat_id), proof.interrupt_id)
                if (
                    recovery_key not in recovered_interrupts
                    and len(recovered_interrupts) >= _RECOVERY_MARKER_LIMIT
                ):
                    raise HTTPException(status_code=503, detail="AG-UI recovery capacity unavailable")
                recovered_interrupts[recovery_key] = True
            request_agent.run = recovered_pending_run  # type: ignore[method-assign]
            return

        interrupt_id, approved = rejection

        async with recovery_resolution_lock:
            if recovery_key is None or recovered_interrupts.get(recovery_key) is not True:
                raise HTTPException(status_code=409, detail="AG-UI recovery decision is no longer open")
            open_interrupts = await inspector.open_interrupts(checkpointer, str(chat_id))
            matches = tuple(item for item in open_interrupts if item.interrupt_id == interrupt_id)
            if len(matches) != 1:
                raise HTTPException(status_code=409, detail="AG-UI recovery interrupt is not open")
            proof = matches[0]
            async with session_scope() as session:
                proposal = await command_service.load_authorized_proposal(
                    session,
                    proposal_id=proof.proposal_id,
                    actor_id=actor_id,
                )
                try:
                    resolved = await resolve_recovered_command(
                        session=session,
                        checkpointer=checkpointer,
                        checkpoint_inspector=inspector,
                        command_service=command_service,
                        actor_id=actor_id,
                        chat_run_id=proposal.chat_run_id,
                        proposal_id=proposal.id,
                        approved=approved,
                        component_registry={},
                    )
                except CommandRecoveryProofError as exc:
                    raise HTTPException(
                        status_code=409,
                        detail="AG-UI recovery decision is no longer open",
                    ) from exc
                await session.commit()
                snapshot = await build_messages_snapshot(
                    session=session,
                    owner_id=actor_id,
                    chat_id=chat_id,
                )
            if recovery_key is not None:
                recovered_interrupts[recovery_key] = False

        async def recovered_run(_input: "RunAgentInput"):
            yield RunStartedEvent(threadId=str(chat_id), runId=input_data.run_id)
            yield MessagesSnapshotEvent(messages=list(snapshot.messages))
            yield RunFinishedEvent(
                threadId=str(chat_id),
                runId=input_data.run_id,
                result={
                    "proposalId": str(resolved.id),
                    "status": str(getattr(resolved.status, "value", resolved.status)),
                    "recovered": True,
                },
            )

        request_agent.run = recovered_run  # type: ignore[method-assign]

    return before_dispatch


def compose_stage09_lifespan(
    base_lifespan: Callable[[FastAPI], AbstractAsyncContextManager[None]],
) -> Callable[[FastAPI], AbstractAsyncContextManager[None]]:
    """Open one canonical saver, reconcile bounded restart state, then serve."""

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        async with base_lifespan(app):
            if not (FEATURE_FLAGS.mvp_workspace is True and FEATURE_FLAGS.mvp_chat is True):
                yield
                return

            from ketos.agentic.persistence.checkpointer import (
                AgenticCheckpointer,
                checkpoint_path,
            )
            from ketos.agentic.services.ag_ui.stage01_runtime import Stage05AgUiRuntime
            from ketos.services.chat_threads.recovery import reconcile_nonterminal_chat_runs
            from ketos.services.deps import get_settings_service, session_scope
            from ketos.services.jobs.recovery import reconcile_board_jobs_after_restart

            data_dir = get_settings_service().settings.data_dir
            if not data_dir:
                message = "Ketos data_dir is required for Stage 09 recovery"
                raise RuntimeError(message)
            data_root = Path(data_dir)
            runtime = Stage05AgUiRuntime(
                checkpoint=AgenticCheckpointer(
                    data_dir=data_root,
                    path=checkpoint_path(data_root),
                )  # type: ignore[arg-type]
            )
            worker_instance_id = uuid4()
            async with runtime:
                saver = runtime.checkpoint.saver
                async with session_scope() as session:
                    chat_summary = await reconcile_nonterminal_chat_runs(
                        session=session,
                        checkpointer=saver,
                        owner_id=None,
                    )
                async with session_scope() as session:
                    job_summary = await reconcile_board_jobs_after_restart(
                        session=session,
                        current_worker_instance_id=worker_instance_id,
                        current_pid=os.getpid(),
                    )
                app.state.stage09_worker_instance_id = worker_instance_id
                app.state.stage09_chat_recovery = chat_summary
                app.state.stage09_job_recovery = job_summary
                runtime.before_dispatch = create_stage09_recovery_before_dispatch(
                    runtime.before_dispatch,
                    checkpointer=saver,
                )
                registered = register_stage01_ag_ui(app, runtime)
                try:
                    yield
                finally:
                    if registered:
                        unregister_stage01_ag_ui(app)

    return lifespan


def register_stage01_ag_ui(app: FastAPI, runtime: "Stage01AgUiRuntime") -> bool:
    """Mount the sole Stage 01 AG-UI route once, only when both flags are on."""
    if not (FEATURE_FLAGS.mvp_workspace is True and FEATURE_FLAGS.mvp_chat is True):
        return False
    if getattr(app.state, _STAGE01_REGISTERED_STATE_KEY, False):
        return False
    if runtime.agent is None:
        message = "Stage 01 AG-UI runtime must be open before registration"
        raise RuntimeError(message)

    from ketos.agentic.services.ag_ui.auth import get_current_ag_ui_user

    stage01_router = create_ag_ui_router(
        runtime.agent,
        before_dispatch=runtime.before_dispatch,
        auth_dependency=get_current_ag_ui_user,
    )
    existing_route_ids = {id(route) for route in app.router.routes}
    app.include_router(stage01_router, prefix="/api/v1/agentic", tags=["Agentic"])
    added_routes = tuple(route for route in app.router.routes if id(route) not in existing_route_ids)
    if not added_routes:
        message = "Stage 01 AG-UI registrar added no routes"
        raise RuntimeError(message)
    setattr(app.state, _STAGE01_ROUTES_STATE_KEY, added_routes)
    setattr(app.state, _STAGE01_REGISTERED_STATE_KEY, True)
    return True


def unregister_stage01_ag_ui(app: FastAPI) -> None:
    """Remove only routes added by the Stage 01 lifespan registrar."""
    added_routes = tuple(getattr(app.state, _STAGE01_ROUTES_STATE_KEY, ()))
    if added_routes:
        app.router.routes[:] = [
            route for route in app.router.routes if all(route is not added_route for added_route in added_routes)
        ]
    setattr(app.state, _STAGE01_ROUTES_STATE_KEY, ())
    setattr(app.state, _STAGE01_REGISTERED_STATE_KEY, False)


@dataclass(frozen=True)
class _AssistantContext:
    """Resolved provider, model, and execution context for assistant endpoints."""

    provider: str
    model_name: str
    api_key_name: str
    session_id: str
    global_vars: dict[str, str]
    max_retries: int


async def _resolve_assistant_context(
    request: AssistantRequest,
    user_id: UUID,
    session: AsyncSession,
) -> _AssistantContext:
    """Resolve provider, model, API key, and build execution context.

    Raises:
        HTTPException: If provider is not configured or API key is missing.
    """
    provider_variable_map = get_model_provider_variable_mapping()
    enabled_providers, _ = await get_enabled_providers_for_user(user_id, session)

    if not enabled_providers:
        raise HTTPException(
            status_code=400,
            detail="No model provider is configured. Please configure at least one model provider in Settings.",
        )

    provider = request.provider
    if not provider:
        for preferred in PREFERRED_PROVIDERS:
            if preferred in enabled_providers:
                provider = preferred
                break
        if not provider:
            provider = enabled_providers[0]

    if provider not in enabled_providers:
        raise HTTPException(
            status_code=400,
            detail=f"Provider '{provider}' is not configured. Available providers: {enabled_providers}",
        )

    api_key_name = provider_variable_map.get(provider)
    if not api_key_name:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")

    model_name = request.model_name or get_default_model(provider, user_id=user_id) or ""

    # Get all configured variables for the provider
    provider_vars = get_all_variables_for_provider(user_id, provider)

    # Validate all required variables are present
    required_keys = get_provider_required_variable_keys(provider)
    missing_keys = [key for key in required_keys if not provider_vars.get(key)]

    if missing_keys:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Missing required configuration for {provider}: {', '.join(missing_keys)}. "
                "Please configure these in Settings > Model Providers."
            ),
        )

    global_vars: dict[str, str] = {
        "USER_ID": str(user_id),
        "FLOW_ID": request.flow_id,
        "MODEL_NAME": model_name,
        "PROVIDER": provider,
    }

    # Inject all provider variables into the global context
    global_vars.update(provider_vars)

    session_id = request.session_id or str(uuid.uuid4())
    max_retries = request.max_retries if request.max_retries is not None else MAX_VALIDATION_RETRIES

    return _AssistantContext(
        provider=provider,
        model_name=model_name,
        api_key_name=api_key_name,
        session_id=session_id,
        global_vars=global_vars,
        max_retries=max_retries,
    )


async def _validate_flow_access(flow_id: str | None, user_id: UUID, session: AsyncSession) -> None:
    """Reject an unknown or not-owned flow_id before the model is invoked.

    A missing flow_id is allowed (the assistant runs with no canvas context).
    A supplied id must reference a flow the caller can access, mirroring the
    per-user 404 of the /run and webhook endpoints; not-found and cross-user
    both surface 404 so a flow's existence is not leaked by id.
    """
    if not flow_id:
        return

    from ketos.services.database.models.flow import Flow

    try:
        flow_uuid = UUID(flow_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid flow_id: not a valid UUID.") from exc

    flow = await session.get(Flow, flow_uuid)
    if flow is None or (flow.user_id is not None and str(flow.user_id) != str(user_id)):
        raise HTTPException(status_code=404, detail="Flow not found.")


@router.post("/execute/{flow_name}")
async def execute_named_flow(
    flow_name: str,
    request: AssistantRequest,
    current_user: CurrentActiveUser,
    session: DbSession,
) -> dict:
    """Execute a named flow from the flows directory.

    Named assistant flows embed an Agent that needs provider/model/api-key
    context. Resolving it here (instead of running the raw file) turns a
    silent 500 into a successful run, or a clear 4xx when no provider is set.
    """
    ctx = await _resolve_assistant_context(request, current_user.id, session)

    global_vars = dict(ctx.global_vars)
    if request.component_id:
        global_vars["COMPONENT_ID"] = request.component_id
    if request.field_name:
        global_vars["FIELD_NAME"] = request.field_name

    return await execute_flow_file(
        flow_filename=f"{flow_name}.json",
        input_value=request.input_value,
        global_variables=global_vars,
        verbose=True,
        user_id=str(current_user.id),
        session_id=ctx.session_id,
        provider=ctx.provider,
        model_name=ctx.model_name,
        api_key_var=ctx.api_key_name,
    )


@router.get("/check-config")
async def check_assistant_config(
    current_user: CurrentActiveUser,
    session: DbSession,
) -> dict:
    """Check if the Ketos Assistant is properly configured.

    Returns available providers with their configured status and available models.
    """
    user_id = current_user.id
    enabled_providers, _ = await get_enabled_providers_for_user(user_id, session)

    all_providers = []

    if enabled_providers:
        models_by_provider = get_unified_models_detailed(
            providers=enabled_providers,
            include_unsupported=False,
            include_deprecated=False,
            model_type="llm",
        )
        for provider_dict in models_by_provider:
            provider_name = provider_dict.get("provider")
            if not provider_name:
                continue
            installed = list_installed_tool_calling_models(provider_name, user_id)
            if installed:
                provider_dict["models"] = [{"model_name": name, "metadata": {}} for name in installed]
            models = provider_dict.get("models", [])

            model_list = []
            for model in models:
                model_name = model.get("model_name")
                display_name = model.get("display_name", model_name)
                metadata = model.get("metadata", {})

                is_deprecated = metadata.get("deprecated", False)
                is_not_supported = metadata.get("not_supported", False)

                if not is_deprecated and not is_not_supported:
                    model_list.append(
                        {
                            "name": model_name,
                            "display_name": display_name,
                        }
                    )

            default_model = get_default_model(provider_name)
            if model_list and default_model not in {m["name"] for m in model_list}:
                default_model = model_list[0]["name"]

            if model_list:
                all_providers.append(
                    {
                        "name": provider_name,
                        "configured": True,
                        "default_model": default_model,
                        "models": model_list,
                    }
                )

    default_provider = None
    default_model = None

    providers_with_models = [p["name"] for p in all_providers]

    for preferred in PREFERRED_PROVIDERS:
        if preferred in providers_with_models:
            default_provider = preferred
            for p in all_providers:
                if p["name"] == preferred:
                    default_model = p["default_model"]
                    break
            break

    if not default_provider and all_providers:
        default_provider = all_providers[0]["name"]
        default_model = all_providers[0]["default_model"]

    return {
        "configured": len(enabled_providers) > 0,
        "configured_providers": enabled_providers,
        "providers": all_providers,
        "default_provider": default_provider,
        "default_model": default_model,
    }


@router.post("/assist")
async def assist(
    request: AssistantRequest,
    current_user: CurrentActiveUser,
    session: DbSession,
) -> dict:
    """Chat with the Ketos Assistant."""
    await _validate_flow_access(request.flow_id, current_user.id, session)
    ctx = await _resolve_assistant_context(request, current_user.id, session)

    logger.info(f"Executing {KETOS_ASSISTANT_FLOW} with {ctx.provider}/{ctx.model_name}")

    return await execute_flow_with_validation(
        flow_filename=KETOS_ASSISTANT_FLOW,
        input_value=request.input_value or "",
        global_variables=ctx.global_vars,
        max_retries=ctx.max_retries,
        user_id=str(current_user.id),
        session_id=ctx.session_id,
        provider=ctx.provider,
        model_name=ctx.model_name,
        api_key_var=ctx.api_key_name,
    )


@router.post("/assist/stream")
async def assist_stream(
    request: AssistantRequest,
    http_request: Request,
    current_user: CurrentActiveUser,
    session: DbSession,
) -> StreamingResponse:
    """Chat with the Ketos Assistant with streaming progress updates."""
    await _validate_flow_access(request.flow_id, current_user.id, session)
    ctx = await _resolve_assistant_context(request, current_user.id, session)

    return StreamingResponse(
        execute_flow_with_validation_streaming(
            flow_filename=KETOS_ASSISTANT_FLOW,
            input_value=request.input_value or "",
            global_variables=ctx.global_vars,
            max_retries=ctx.max_retries,
            user_id=str(current_user.id),
            session_id=ctx.session_id,
            provider=ctx.provider,
            model_name=ctx.model_name,
            api_key_var=ctx.api_key_name,
            is_disconnected=http_request.is_disconnected,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )
