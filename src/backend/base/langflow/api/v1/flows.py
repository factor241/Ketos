from __future__ import annotations

import asyncio
import io
import threading
import zipfile
from typing import Annotated
from uuid import UUID

import orjson
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.encoders import jsonable_encoder
from fastapi_pagination import Page, Params
from fastapi_pagination.ext.sqlmodel import apaginate
from lfx.services.cache.utils import CACHE_MISS
from pydantic import ValidationError
from sqlmodel import and_, col, select

from langflow.api.error_codes import ApiErrorCode, coded_http_error
from langflow.api.utils import (
    CurrentActiveUser,
    DbSession,
    cascade_delete_flow,
    normalize_code_for_import,
    validate_is_component,
)
from langflow.api.utils.zip_utils import extract_flows_from_zip
from langflow.api.v1.authz_route_dependencies import (
    AuthorizedDeleteFlow,
    AuthorizedReadFlow,
    AuthorizedWriteFlow,
    RequireFlowCreate,
)
from langflow.api.v1.flows_helpers import (
    _build_flows_download_response,
    _get_safe_flow_path,
    _new_flow,
    _patch_flow,
    _read_flow,
    _save_flow_to_fs,
    _update_existing_flow,
    _upsert_flow_list,
    _verify_fs_path,
)
from langflow.api.v1.mappers.deployments.sync import retry_flow_operation_on_deployment_guard
from langflow.api.v1.schemas import FlowListCreate
from langflow.initial_setup.constants import STARTER_FOLDER_NAME
from langflow.services.auth.utils import get_current_active_user
from langflow.services.authorization import FlowAction, ensure_flow_permission, filter_visible_resources
from langflow.services.authorization.utils import _resolve_authz_domain
from langflow.services.cache.service import ThreadingInMemoryCache
from langflow.services.database.models.deployment.exceptions import (
    araise_if_deployment_guard_error_or_skip,
)
from langflow.services.database.models.flow.model import (
    AccessTypeEnum,
    Flow,
    FlowCreate,
    FlowHeader,
    FlowRead,
    FlowUpdate,
)

# TODO: Full-version import/export is planned as a follow-up feature. When implemented,
# re-add imports for create_flow_version_entry, get_flow_versions_with_provider_status, strip_version_data,
# and FlowVersionError from the flow_version modules.
from langflow.services.database.models.folder.constants import DEFAULT_FOLDER_NAME
from langflow.services.database.models.folder.model import Folder
from langflow.services.deps import get_settings_service, get_storage_service
from langflow.services.storage.service import StorageService
from langflow.utils.compression import compress_response
from langflow.utils.i18n import translate_flow_notes, translate_starter_flows

# Re-export helpers so existing ``from langflow.api.v1.flows import ...`` still works.
__all__ = [
    "_get_safe_flow_path",
    "_new_flow",
    "_read_flow",
    "_save_flow_to_fs",
    "_update_existing_flow",
    "_verify_fs_path",
]


def _handle_unique_constraint_error(exc: Exception, *, status_code: int = 400) -> HTTPException:
    """Map database diagnostics to a stable public envelope and keep raw text private."""
    technical_detail = str(exc)
    if "UNIQUE constraint failed" not in technical_detail:
        return coded_http_error(
            ApiErrorCode.SERVER_INTERNAL_ERROR,
            detail="An internal error occurred while saving the flow.",
            technical_detail=technical_detail,
        )

    normalized_detail = technical_detail.casefold()
    if ".endpoint_name" in normalized_detail:
        detail = "A flow with this endpoint already exists."
    elif ".name" in normalized_detail:
        detail = "A flow with this name already exists."
    else:
        detail = "Flow already exists."
    return coded_http_error(
        ApiErrorCode.FLOW_ALREADY_EXISTS,
        detail=detail,
        technical_detail=technical_detail,
        status_code=status_code,
    )


# build router
router = APIRouter(prefix="/flows", tags=["Flows"])


def _flow_not_found_error(flow_id: UUID, *, detail: str = "Flow not found") -> HTTPException:
    return coded_http_error(
        ApiErrorCode.FLOW_NOT_FOUND,
        params={"flow_id": str(flow_id)},
        detail=detail,
    )


def _deny_to_flow_not_found(exc: HTTPException, flow_id: UUID, *, detail: str = "Flow not found") -> HTTPException:
    """Preserve non-denial errors while hiding denied flow UUIDs behind a coded 404."""
    if exc.status_code == status.HTTP_403_FORBIDDEN:
        return _flow_not_found_error(flow_id, detail=detail)
    return exc


@router.post("/", response_model=FlowRead, status_code=201)
async def create_flow(
    *,
    session: DbSession,
    flow: FlowCreate,
    current_user: CurrentActiveUser,
    _create: RequireFlowCreate,
    storage_service: Annotated[StorageService, Depends(get_storage_service)],
):
    try:
        return await _new_flow(session=session, flow=flow, user_id=current_user.id, storage_service=storage_service)
    except HTTPException:
        raise
    except Exception as e:
        raise _handle_unique_constraint_error(e) from e


@router.get("/", response_model=list[FlowRead] | Page[FlowRead] | list[FlowHeader], status_code=200)
async def read_flows(
    *,
    current_user: CurrentActiveUser,
    session: DbSession,
    remove_example_flows: bool = False,
    components_only: bool = False,
    get_all: bool = True,
    folder_id: UUID | None = None,
    params: Annotated[Params, Depends()],
    header_flows: bool = False,
):
    """Retrieve a list of flows with optional pagination, filtering, and header-only mode."""
    try:
        auth_settings = get_settings_service().auth_settings

        default_folder = (await session.exec(select(Folder).where(Folder.name == DEFAULT_FOLDER_NAME))).first()
        default_folder_id = default_folder.id if default_folder else None

        starter_folder = (await session.exec(select(Folder).where(Folder.name == STARTER_FOLDER_NAME))).first()
        starter_folder_id = starter_folder.id if starter_folder else None

        if not starter_folder and not default_folder:
            raise coded_http_error(
                ApiErrorCode.REQUEST_BAD_REQUEST,
                status_code=404,
                detail="Starter project and default project not found. Please create a project and add flows to it.",
            )

        if not folder_id:
            folder_id = default_folder_id

        if auth_settings.AUTO_LOGIN:
            stmt = select(Flow).where(
                (Flow.user_id == None) | (Flow.user_id == current_user.id)  # noqa: E711
            )
        else:
            stmt = select(Flow).where(Flow.user_id == current_user.id)

        if remove_example_flows:
            stmt = stmt.where(Flow.folder_id != starter_folder_id)

        if components_only:
            stmt = stmt.where(Flow.is_component == True)  # noqa: E712

        if get_all:
            flows = (await session.exec(stmt)).all()
            flows = validate_is_component(flows)
            if components_only:
                flows = [flow for flow in flows if flow.is_component]
            if remove_example_flows and starter_folder_id:
                flows = [flow for flow in flows if flow.folder_id != starter_folder_id]
            # Filter list rows when AUTHZ_ENABLED (per-flow domain_extractor).
            flows = await filter_visible_resources(
                current_user,
                resource_type="flow",
                candidates=list(flows),
                domain_extractor=lambda flow: _resolve_authz_domain(flow.workspace_id, flow.folder_id),
                owner_extractor=lambda flow: flow.user_id,
                act=FlowAction.READ,
            )
            if header_flows:
                # Convert to FlowHeader objects and compress the response
                flow_headers = [FlowHeader.model_validate(flow, from_attributes=True) for flow in flows]
                return compress_response(flow_headers)

            # Convert to FlowRead while session is still active to avoid detached instance errors
            flow_reads = [FlowRead.model_validate(flow, from_attributes=True) for flow in flows]
            return compress_response(flow_reads)

        stmt = stmt.where(Flow.folder_id == folder_id)

        import warnings

        with warnings.catch_warnings():
            warnings.filterwarnings(
                "ignore", category=DeprecationWarning, module=r"fastapi_pagination\.ext\.sqlalchemy"
            )
            page = await apaginate(session, stmt, params=params)

        # Same authz filter as get_all (page.total may overcount denied rows).
        page.items = await filter_visible_resources(
            current_user,
            resource_type="flow",
            candidates=list(page.items),
            domain_extractor=lambda flow: _resolve_authz_domain(flow.workspace_id, flow.folder_id),
            owner_extractor=lambda flow: flow.user_id,
            act=FlowAction.READ,
        )
        return page  # noqa: TRY300 — final return inside try matches the existing style of this handler

    except Exception as e:
        import logging as _logging

        _logging.getLogger(__name__).exception("Error listing flows")
        raise coded_http_error(
            ApiErrorCode.SERVER_INTERNAL_ERROR,
            detail="An internal error occurred while listing flows.",
            technical_detail=str(e),
        ) from e


@router.get("/{flow_id}", response_model=FlowRead, status_code=200)
async def read_flow(
    *,
    flow_id: UUID,  # noqa: ARG001
    flow: AuthorizedReadFlow,
):
    """Read a flow."""
    return FlowRead.model_validate(flow, from_attributes=True)


@router.get("/{flow_id}/note_translations", status_code=200)
async def get_note_translations(
    *,
    flow_id: UUID,  # noqa: ARG001
    flow: AuthorizedReadFlow,
    request: Request,
) -> dict[str, str]:
    """Return translated note node descriptions for the current locale.

    Returns a mapping of node_id → translated markdown text.  Only nodes
    with a matching translation key are included; nodes without translations
    are omitted so the caller can leave them unchanged.

    A missing or inaccessible flow yields 404 (via ``AuthorizedReadFlow``),
    consistent with ``GET /flows/{id}``; the sole frontend caller (NoteNode)
    treats that as "no translations" and renders the original text.
    """
    from langflow.utils.i18n import translate

    if not flow.data:
        return {}

    locale = getattr(request.state, "locale", "en")
    nodes = flow.data.get("nodes", [])
    result: dict[str, str] = {}
    for node in nodes:
        if node.get("type") == "noteNode":
            i18n_key = node.get("data", {}).get("node", {}).get("i18n_key")
            if i18n_key:
                translated = translate(i18n_key, locale, "")
                if translated:
                    result[node.get("id")] = translated
    return result


@router.get("/public_flow/{flow_id}", response_model=FlowRead, status_code=200)
async def read_public_flow(
    *,
    session: DbSession,
    flow_id: UUID,
):
    """Read a public flow without requiring authorization (public means public)."""
    flow = (await session.exec(select(Flow).where(Flow.id == flow_id))).first()
    if flow is None:
        raise _flow_not_found_error(flow_id)
    if flow.access_type is not AccessTypeEnum.PUBLIC:
        raise coded_http_error(
            ApiErrorCode.FLOW_INVALID,
            params={"flow_id": str(flow_id)},
            detail="Flow is not public",
            status_code=403,
        )
    return FlowRead.model_validate(flow, from_attributes=True)


@router.patch("/{flow_id}", response_model=FlowRead, status_code=200)
async def update_flow(
    *,
    session: DbSession,
    flow_id: UUID,
    db_flow: AuthorizedWriteFlow,
    flow: FlowUpdate,
    current_user: CurrentActiveUser,
    storage_service: Annotated[StorageService, Depends(get_storage_service)],
):
    """Update a flow."""
    try:
        # Destination check: if the payload moves the flow into a new
        # workspace/folder, the caller must also be authorized to write at the
        # destination scope. ``_patch_flow`` applies payload values via
        # ``model_dump(exclude_unset=True, exclude_none=True)``, so None means
        # "no change" and falls back to the existing scope.
        target_workspace_id = flow.workspace_id if flow.workspace_id is not None else db_flow.workspace_id
        target_folder_id = flow.folder_id if flow.folder_id is not None else db_flow.folder_id
        if target_workspace_id != db_flow.workspace_id or target_folder_id != db_flow.folder_id:
            try:
                await ensure_flow_permission(
                    current_user,
                    FlowAction.WRITE,
                    flow_id=flow_id,
                    flow_user_id=db_flow.user_id,
                    workspace_id=target_workspace_id,
                    folder_id=target_folder_id,
                )
            except HTTPException as exc:
                raise _deny_to_flow_not_found(exc, flow_id) from exc

        # Explicit folder_id=None is ignored here because _patch_flow builds
        # update_data with exclude_none=True, so null folder_id is a no-op.
        folder_id_will_change = (
            "folder_id" in flow.model_fields_set and flow.folder_id is not None and flow.folder_id != db_flow.folder_id
        )

        async def operation() -> FlowRead:
            # Re-load inside each attempt so retry after nested rollback never uses an expired ORM instance.
            db_flow_for_attempt = await _read_flow(session=session, flow_id=flow_id, user_id=current_user.id)
            if not db_flow_for_attempt:
                raise _flow_not_found_error(flow_id)
            # TOCTOU: a concurrent PATCH could have moved this flow to a
            # different workspace/folder between the destination check above
            # and this retry attempt. Re-authorize against the freshly
            # reloaded source AND destination so the writer cannot ride a
            # stale check across a race.
            try:
                await ensure_flow_permission(
                    current_user,
                    FlowAction.WRITE,
                    flow_id=flow_id,
                    flow_user_id=db_flow_for_attempt.user_id,
                    workspace_id=db_flow_for_attempt.workspace_id,
                    folder_id=db_flow_for_attempt.folder_id,
                )
            except HTTPException as exc:
                raise _deny_to_flow_not_found(exc, flow_id) from exc
            attempt_target_workspace_id = (
                flow.workspace_id if flow.workspace_id is not None else db_flow_for_attempt.workspace_id
            )
            attempt_target_folder_id = flow.folder_id if flow.folder_id is not None else db_flow_for_attempt.folder_id
            if (
                attempt_target_workspace_id != db_flow_for_attempt.workspace_id
                or attempt_target_folder_id != db_flow_for_attempt.folder_id
            ):
                try:
                    await ensure_flow_permission(
                        current_user,
                        FlowAction.WRITE,
                        flow_id=flow_id,
                        flow_user_id=db_flow_for_attempt.user_id,
                        workspace_id=attempt_target_workspace_id,
                        folder_id=attempt_target_folder_id,
                    )
                except HTTPException as exc:
                    raise _deny_to_flow_not_found(exc, flow_id) from exc
            return await _patch_flow(
                session=session,
                db_flow=db_flow_for_attempt,
                flow=flow,
                user_id=current_user.id,
                storage_service=storage_service,
            )

        if folder_id_will_change:
            return await retry_flow_operation_on_deployment_guard(
                db=session,
                user_id=current_user.id,
                flow_ids=[flow_id],
                operation=operation,
            )
        return await operation()
    except HTTPException:
        raise
    except Exception as e:
        await araise_if_deployment_guard_error_or_skip(
            e,
            log_message=f"op=update_flow flow_id={flow_id}",
        )
        raise _handle_unique_constraint_error(e) from e


@router.put("/{flow_id}", response_model=FlowRead)
async def upsert_flow(
    *,
    session: DbSession,
    flow_id: UUID,
    flow: FlowCreate,
    current_user: CurrentActiveUser,
    storage_service: Annotated[StorageService, Depends(get_storage_service)],
):
    """Create or update a flow with a specific ID (upsert).

    Returns 201 for creation, 200 for update.  Returns 404 if owned by another user.
    """
    from fastapi.responses import JSONResponse

    try:
        # Check if flow exists (without user filter to distinguish ownership vs CREATE)
        existing_flow = (await session.exec(select(Flow).where(Flow.id == flow_id))).first()

        if existing_flow is not None:
            # Block non-owner upsert when cross-user fetch is off (UUID privacy).
            from langflow.services.deps import get_authorization_service

            authz = get_authorization_service()
            can_widen = await authz.supports_cross_user_fetch() and await authz.is_enabled()
            if not can_widen and existing_flow.user_id != current_user.id:
                raise _flow_not_found_error(flow_id)

            try:
                await ensure_flow_permission(
                    current_user,
                    FlowAction.WRITE,
                    flow_id=flow_id,
                    flow_user_id=existing_flow.user_id,
                    workspace_id=existing_flow.workspace_id,
                    folder_id=existing_flow.folder_id,
                )
            except HTTPException as exc:
                raise _deny_to_flow_not_found(exc, flow_id) from exc

            # Destination check (see update_flow above): if the payload moves
            # the flow into a new workspace/folder, also authorize WRITE at the
            # destination. ``_update_existing_flow`` applies payload values via
            # ``model_dump(exclude_unset=True, exclude_none=True)``, so None
            # means "keep existing" and a non-None differing value means "move".
            target_workspace_id = flow.workspace_id if flow.workspace_id is not None else existing_flow.workspace_id
            target_folder_id = flow.folder_id if flow.folder_id is not None else existing_flow.folder_id
            if target_workspace_id != existing_flow.workspace_id or target_folder_id != existing_flow.folder_id:
                try:
                    await ensure_flow_permission(
                        current_user,
                        FlowAction.WRITE,
                        flow_id=flow_id,
                        flow_user_id=existing_flow.user_id,
                        workspace_id=target_workspace_id,
                        folder_id=target_folder_id,
                    )
                except HTTPException as exc:
                    raise _deny_to_flow_not_found(exc, flow_id) from exc

            # Sync deployment state before folder changes
            # Explicit folder_id=None is ignored here because _update_existing_flow
            # also uses exclude_none=True for update_data.
            folder_id_will_change = (
                "folder_id" in flow.model_fields_set
                and flow.folder_id is not None
                and flow.folder_id != existing_flow.folder_id
            )

            async def update_operation() -> FlowRead:
                # Re-load inside each attempt so retry after nested rollback never uses an expired ORM instance.
                existing_flow_for_attempt = await _read_flow(session=session, flow_id=flow_id, user_id=current_user.id)
                if existing_flow_for_attempt is None:
                    raise _flow_not_found_error(flow_id)
                return await _update_existing_flow(
                    session=session,
                    existing_flow=existing_flow_for_attempt,
                    flow=flow,
                    current_user=current_user,
                    storage_service=storage_service,
                )

            if folder_id_will_change:
                flow_read = await retry_flow_operation_on_deployment_guard(
                    db=session,
                    user_id=current_user.id,
                    flow_ids=[existing_flow.id],
                    operation=update_operation,
                )
            else:
                flow_read = await update_operation()
            status_code = 200
        else:
            # CREATE path - flow doesn't exist
            await ensure_flow_permission(
                current_user, FlowAction.CREATE, workspace_id=flow.workspace_id, folder_id=flow.folder_id
            )
            flow_read = await _new_flow(
                session=session,
                flow=flow,
                user_id=current_user.id,
                storage_service=storage_service,
                flow_id=flow_id,
                fail_on_endpoint_conflict=True,
                validate_folder=True,
            )
            status_code = 201

        return JSONResponse(status_code=status_code, content=jsonable_encoder(flow_read))

    except HTTPException:
        raise
    except Exception as e:
        await araise_if_deployment_guard_error_or_skip(
            e,
            log_message=f"op=upsert_flow flow_id={flow_id}",
        )
        raise _handle_unique_constraint_error(e, status_code=409) from e


@router.delete("/{flow_id}", status_code=200)
async def delete_flow(
    *,
    session: DbSession,
    flow_id: UUID,  # noqa: ARG001
    flow: AuthorizedDeleteFlow,
    current_user: CurrentActiveUser,
):
    """Delete a flow."""
    await retry_flow_operation_on_deployment_guard(
        db=session,
        user_id=current_user.id,
        flow_ids=[flow.id],
        operation=lambda: cascade_delete_flow(session, flow.id),
    )
    return {"message": "Flow deleted successfully"}


@router.post("/batch/", response_model=list[FlowRead], status_code=201)
async def create_flows(
    *,
    session: DbSession,
    flow_list: FlowListCreate,
    current_user: CurrentActiveUser,
):
    """Create multiple new flows."""
    # Per-flow CREATE check: each flow's destination (workspace_id + folder_id) is
    # caller-supplied, so we must authorize the actual target instead of trusting
    # a single coarse check at the route boundary.
    for flow in flow_list.flows:
        await ensure_flow_permission(
            current_user,
            FlowAction.CREATE,
            workspace_id=flow.workspace_id,
            folder_id=flow.folder_id,
        )
    # Guard against duplicate IDs up-front so callers get a clean 422 instead
    # of an unhandled DB IntegrityError.  Use upload_file() for upsert semantics.
    requested_ids = [f.id for f in flow_list.flows if f.id is not None]
    if requested_ids:
        existing_ids = (await session.exec(select(Flow.id).where(col(Flow.id).in_(requested_ids)))).all()
        if existing_ids:
            first_conflict = existing_ids[0]
            raise coded_http_error(
                ApiErrorCode.FLOW_ALREADY_EXISTS,
                params={"flow_id": str(first_conflict)},
                detail="One or more flows already exist. Use the update endpoint or upload for upsert semantics.",
                status_code=422,
            )

    db_flows = []
    for flow in flow_list.flows:
        flow.user_id = current_user.id
        # Exclude id from model_validate (same reasoning as _new_flow) and apply separately.
        db_flow = Flow.model_validate(flow.model_dump(exclude={"id"}))
        if flow.id is not None:
            db_flow.id = flow.id
        session.add(db_flow)
        db_flows.append(db_flow)

    await session.flush()
    for db_flow in db_flows:
        await session.refresh(db_flow)

    return [FlowRead.model_validate(db_flow, from_attributes=True) for db_flow in db_flows]


@router.post("/upload/", response_model=list[FlowRead], status_code=201)
async def upload_file(
    *,
    session: DbSession,
    file: Annotated[UploadFile | None, File()] = None,
    current_user: CurrentActiveUser,
    folder_id: UUID | None = None,
    storage_service: Annotated[StorageService, Depends(get_storage_service)],
):
    """Upload flows from a JSON or ZIP file (upsert semantics for flows with stable IDs)."""
    # Authorization is enforced per-flow below, after parsing — the per-flow
    # check uses the actual workspace_id/folder_id each uploaded flow targets.
    # A coarse pre-parse check here would over-reject (it would authorize the
    # caller against ``domain="*", obj="flow:*"`` regardless of where the
    # uploaded flows actually land).
    if file is None:
        raise coded_http_error(ApiErrorCode.REQUEST_BAD_REQUEST, detail="No file provided")

    contents = await file.read()

    if not contents:
        raise coded_http_error(ApiErrorCode.REQUEST_BAD_REQUEST, detail="The uploaded file is empty")

    if zipfile.is_zipfile(io.BytesIO(contents)):
        try:
            flows_data = await extract_flows_from_zip(contents)
        except ValueError as e:
            raise coded_http_error(
                ApiErrorCode.FLOW_INVALID,
                detail="The uploaded file is not a valid ZIP archive.",
                technical_detail=str(e),
            ) from e
        if not flows_data:
            raise coded_http_error(
                ApiErrorCode.FLOW_INVALID,
                detail="No valid flow JSON files found in the ZIP",
            )
        data = {"flows": flows_data}
    else:
        try:
            data = orjson.loads(contents)
        except orjson.JSONDecodeError as e:
            raise coded_http_error(
                ApiErrorCode.FLOW_INVALID,
                detail="Invalid JSON file.",
                technical_detail=str(e),
            ) from e

    # Normalise code fields: if exported with code-as-lines format, rejoin to
    # strings before creating the Pydantic models so the DB always stores strings.
    if not isinstance(data, dict):
        raise coded_http_error(
            ApiErrorCode.FLOW_INVALID,
            status_code=422,
            detail="Invalid JSON: expected an object with 'flows' or a single flow object",
        )
    try:
        if "flows" in data:
            if not isinstance(data["flows"], list):
                raise coded_http_error(
                    ApiErrorCode.FLOW_INVALID,
                    status_code=422,
                    detail="Invalid JSON: 'flows' must be a list of flow objects",
                )
            non_dict = [i for i, f in enumerate(data["flows"]) if not isinstance(f, dict)]
            if non_dict:
                raise coded_http_error(
                    ApiErrorCode.FLOW_INVALID,
                    status_code=422,
                    detail="Invalid JSON: an item in 'flows' is not an object",
                )
            data = {**data, "flows": [normalize_code_for_import(f) for f in data["flows"]]}
            flow_list = FlowListCreate(**data)
        else:
            flow_list = FlowListCreate(flows=[FlowCreate(**normalize_code_for_import(data))])
    except HTTPException:
        raise
    except ValidationError as e:
        raise coded_http_error(
            ApiErrorCode.FLOW_INVALID,
            detail="The uploaded flow data failed validation.",
            technical_detail=str(e),
            status_code=422,
        ) from e

    # TODO: Full-version import is planned as a follow-up feature.
    # When implemented, extract raw flow dicts here to read embedded "version"
    # arrays and create FlowVersion entries for each imported flow.

    # Per-flow CREATE check on the effective destination. _upsert_flow_list lets
    # the query `folder_id` override each flow's `folder_id`, but it preserves
    # each flow's `workspace_id`, so a payload could otherwise route flows into
    # workspaces the caller has no create permission on.
    for flow in flow_list.flows:
        effective_folder_id = folder_id if folder_id is not None else flow.folder_id
        await ensure_flow_permission(
            current_user,
            FlowAction.CREATE,
            workspace_id=flow.workspace_id,
            folder_id=effective_folder_id,
        )

    try:
        return await _upsert_flow_list(
            session=session,
            flows=flow_list.flows,
            current_user=current_user,
            storage_service=storage_service,
            folder_id=folder_id,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise _handle_unique_constraint_error(e) from e


@router.delete("/")
async def delete_multiple_flows(
    flow_ids: list[UUID],
    user: CurrentActiveUser,
    db: DbSession,
):
    """Delete multiple flows by their IDs."""
    try:

        async def _delete_operation() -> int:
            if not flow_ids:
                return 0
            # Widen fetch when cross-user DELETE is supported; else owner-scoped.
            from langflow.services.deps import get_authorization_service

            authz = get_authorization_service()
            base_stmt = select(Flow).where(col(Flow.id).in_(flow_ids))
            if await authz.supports_cross_user_fetch() and await authz.is_enabled():
                stmt = base_stmt
            else:
                stmt = base_stmt.where(Flow.user_id == user.id)
            flows_to_delete = (await db.exec(stmt)).all()
            for flow in flows_to_delete:
                # Propagate plugin deny (403) so bulk delete fails audibly.
                await ensure_flow_permission(
                    user,
                    FlowAction.DELETE,
                    flow_id=flow.id,
                    flow_user_id=flow.user_id,
                    workspace_id=flow.workspace_id,
                    folder_id=flow.folder_id,
                )
            for flow in flows_to_delete:
                await cascade_delete_flow(db, flow.id)
            await db.flush()
            return len(flows_to_delete)

        deleted_count = await retry_flow_operation_on_deployment_guard(
            db=db,
            user_id=user.id,
            flow_ids=flow_ids,
            operation=_delete_operation,
        )
    except Exception as exc:
        await araise_if_deployment_guard_error_or_skip(
            exc,
            log_message=f"op=delete_multiple_flows flow_ids_count={len(flow_ids)}",
        )
        import logging as _logging

        _logging.getLogger(__name__).exception("Error deleting multiple flows")
        raise coded_http_error(
            ApiErrorCode.SERVER_INTERNAL_ERROR,
            detail="An internal error occurred while deleting flows.",
            technical_detail=str(exc),
        ) from exc

    return {"deleted": deleted_count}


@router.post("/download/", status_code=200)
async def download_multiple_file(
    flow_ids: list[UUID],
    user: CurrentActiveUser,
    db: DbSession,
):
    """Download all flows as a zip file."""
    # TODO: Full-version download (include_version parameter) is planned as a follow-up feature.
    # When implemented, add an include_version: bool = False parameter and embed version
    # entries in each flow dict using get_flow_versions_with_provider_status and strip_version_data.
    # Widen fetch when cross-user READ is supported; else owner-scoped.
    from langflow.services.deps import get_authorization_service

    authz = get_authorization_service()
    base_stmt = select(Flow).where(col(Flow.id).in_(flow_ids))  # type: ignore[attr-defined]
    if await authz.supports_cross_user_fetch() and await authz.is_enabled():
        stmt = base_stmt
    else:
        stmt = base_stmt.where(and_(Flow.user_id == user.id))
    flows = (await db.exec(stmt)).all()

    if not flows:
        raise coded_http_error(
            ApiErrorCode.REQUEST_BAD_REQUEST,
            detail="No flows found.",
            status_code=404,
        )

    for flow in flows:
        # Plugin deny → 404 (UUID privacy).
        try:
            await ensure_flow_permission(
                user,
                FlowAction.READ,
                flow_id=flow.id,
                flow_user_id=flow.user_id,
                workspace_id=flow.workspace_id,
                folder_id=flow.folder_id,
            )
        except HTTPException as exc:
            raise _deny_to_flow_not_found(exc, flow.id, detail="No flows found.") from exc

    return _build_flows_download_response(flows)


# 5 minutes
_STARTER_FLOWS_TTL_SECONDS: float = 300.0
_starter_flows_cache: ThreadingInMemoryCache[threading.RLock] = ThreadingInMemoryCache(
    max_size=1,
    expiration_time=int(_STARTER_FLOWS_TTL_SECONDS),
)
_starter_flows_translated_cache: ThreadingInMemoryCache[threading.RLock] = ThreadingInMemoryCache(
    max_size=16,  # Why: 16 > 7 current supported locales, leaves headroom for future additions
    expiration_time=int(_STARTER_FLOWS_TTL_SECONDS),
)
_starter_flows_lock = asyncio.Lock()


@router.get("/basic_examples/", response_model=list[FlowRead], status_code=200)
async def read_basic_examples(
    *,
    session: DbSession,
    request: Request,
):
    """Retrieve a list of basic example flows."""
    locale = getattr(request.state, "locale", "en")
    translated_cache_key = f"starter_flows_{locale}"

    # Fast path: translated result already cached for this locale
    cached_translated = _starter_flows_translated_cache.get(translated_cache_key)
    if cached_translated is not CACHE_MISS:
        return compress_response(cached_translated)

    async with _starter_flows_lock:
        # Double-check inside lock to prevent thundering herd
        cached_translated = _starter_flows_translated_cache.get(translated_cache_key)
        if cached_translated is not CACHE_MISS:
            return compress_response(cached_translated)

        # Ensure raw DB data is cached
        cached_flow_reads = _starter_flows_cache.get("starter_flows")
        if cached_flow_reads is CACHE_MISS:
            try:
                starter_folder = (await session.exec(select(Folder).where(Folder.name == STARTER_FOLDER_NAME))).first()

                if not starter_folder:
                    return compress_response([])

                all_starter_folder_flows = (
                    await session.exec(select(Flow).where(Flow.folder_id == starter_folder.id))
                ).all()

                cached_flow_reads = [
                    FlowRead.model_validate(flow, from_attributes=True) for flow in all_starter_folder_flows
                ]
                _starter_flows_cache.set("starter_flows", cached_flow_reads)

            except Exception as e:
                import logging as _logging

                _logging.getLogger(__name__).exception("Error loading basic examples")
                raise coded_http_error(
                    ApiErrorCode.SERVER_INTERNAL_ERROR,
                    detail="An internal error occurred while loading examples.",
                    technical_detail=str(e),
                ) from e

        # Translate once per locale and cache the result
        # Why: cached uncompressed so the same result can be re-compressed per
        # response — keeps locale-switching working without storing per-locale
        # compressed blobs.
        translated = translate_starter_flows(cached_flow_reads, locale)
        result = []
        for flow in translated:
            flow_copy = flow.model_copy()
            if flow_copy.data and isinstance(flow_copy.data, dict):
                nodes = flow_copy.data.get("nodes", [])
                translated_nodes = translate_flow_notes(nodes, locale)
                flow_copy.data = {**flow_copy.data, "nodes": translated_nodes}
            result.append(flow_copy)

        _starter_flows_translated_cache.set(translated_cache_key, result)

    return compress_response(result)


@router.post("/expand/", status_code=200, dependencies=[Depends(get_current_active_user)], include_in_schema=False)
async def expand_compact_flow_endpoint(
    compact_data: dict,
):
    """Expand a compact flow format (minimal nodes/edges) to the full flow format."""
    from lfx.interface.components import component_cache, get_and_cache_all_types_dict

    from langflow.processing.expand_flow import expand_compact_flow

    # Ensure component cache is loaded
    if component_cache.all_types_dict is None:
        settings_service = get_settings_service()
        await get_and_cache_all_types_dict(settings_service)

    if component_cache.all_types_dict is None:
        raise coded_http_error(
            ApiErrorCode.SERVER_INTERNAL_ERROR,
            detail="Component cache not initialized",
        )

    try:
        return expand_compact_flow(compact_data, component_cache.all_types_dict)
    except ValueError as e:
        raise coded_http_error(
            ApiErrorCode.FLOW_INVALID,
            detail="Compact flow is invalid or references a component that was not found.",
            technical_detail=str(e),
        ) from e
    except Exception as e:
        raise coded_http_error(
            ApiErrorCode.SERVER_INTERNAL_ERROR,
            detail="An internal error occurred while expanding the flow.",
            technical_detail=str(e),
        ) from e
