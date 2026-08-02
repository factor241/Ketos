from collections.abc import Iterator

from fastapi import APIRouter, FastAPI
from fastapi.routing import APIRoute
from ketos.api.router import router


def _flatten(router: APIRouter) -> Iterator[APIRoute]:
    for route in router.routes:
        if isinstance(route, APIRoute):
            yield route
            continue
        original = getattr(route, "original_router", None)
        if original is not None:
            yield from _flatten(original)


def test_board_automation_routes_are_registered_once_in_assembled_openapi() -> None:
    app = FastAPI()
    app.include_router(router)

    schema = app.openapi()
    board_runs = "/api/v1/boards/{board_id}/automations/{flow_id}/runs"
    board_run = f"{board_runs}/{{job_id}}"
    cancel = f"{board_run}/cancel"

    assert set(schema["paths"][board_runs]) == {"get", "post"}
    assert set(schema["paths"][board_run]) == {"get"}
    assert set(schema["paths"][cancel]) == {"post"}

    route_pairs = [(route.path, method) for route in _flatten(router) for method in route.methods]
    local_runs = "/boards/{board_id}/automations/{flow_id}/runs"
    local_run = f"{local_runs}/{{job_id}}"
    assert route_pairs.count((local_runs, "GET")) == 1
    assert route_pairs.count((local_runs, "POST")) == 1
    assert route_pairs.count((local_run, "GET")) == 1
    assert route_pairs.count((f"{local_run}/cancel", "POST")) == 1
