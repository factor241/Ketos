from collections.abc import Iterator

from fastapi import APIRouter, FastAPI
from fastapi.routing import APIRoute
from ketos.main import create_app
from kfx.services.settings.feature_flags import FEATURE_FLAGS

BOARD_ROUTES = {
    ("POST", "/api/v1/projects/{project_id}/boards"),
    ("GET", "/api/v1/projects/{project_id}/boards"),
    ("GET", "/api/v1/boards/{board_id}"),
    ("PATCH", "/api/v1/boards/{board_id}"),
    ("DELETE", "/api/v1/boards/{board_id}"),
    ("PUT", "/api/v1/boards/{board_id}/viewport"),
}


def _assembled_routes(router: APIRouter | FastAPI, parent_prefix: str = "") -> Iterator[tuple[str, APIRoute]]:
    """Flatten FastAPI 0.137 lazy routers while retaining assembled prefixes."""
    current_prefix = parent_prefix + getattr(router, "prefix", "")
    for route in router.routes:
        if isinstance(route, APIRoute):
            # APIRoute.path already contains its immediate router prefix.
            yield parent_prefix + route.path, route
            continue
        original = getattr(route, "original_router", None)
        if original is not None:
            yield from _assembled_routes(original, current_prefix)


def _board_route_counts(app: FastAPI) -> dict[tuple[str, str], int]:
    counts = dict.fromkeys(BOARD_ROUTES, 0)
    for path, route in _assembled_routes(app):
        for method in route.methods or set():
            contract = (method, path)
            if contract in counts:
                counts[contract] += 1
    return counts


def test_assembled_app_registers_each_board_route_once_and_publishes_openapi():
    app = create_app()
    assert _board_route_counts(app) == dict.fromkeys(BOARD_ROUTES, 1)

    paths = app.openapi()["paths"]
    for method, path in BOARD_ROUTES:
        assert method.lower() in paths[path]


def test_workspace_flag_off_keeps_board_api_registered(monkeypatch):
    monkeypatch.setattr(FEATURE_FLAGS, "mvp_workspace", False)
    app = create_app()
    assert _board_route_counts(app) == dict.fromkeys(BOARD_ROUTES, 1)
