"""Access-token-only authentication for the Stage 01 AG-UI endpoint."""

from __future__ import annotations

from typing import TYPE_CHECKING, Annotated

from fastapi import Depends, Request, Security
from kfx.services.deps import injectable_session_scope

from ketos.services.auth import utils as auth_utils
from ketos.services.auth.exceptions import AuthenticationError, InvalidCredentialsError, MissingCredentialsError
from ketos.services.auth.utils import oauth2_login
from ketos.services.database.models.user.model import User
from ketos.services.deps import get_auth_service

if TYPE_CHECKING:
    from sqlmodel.ext.asyncio.session import AsyncSession

AG_UI_ACTOR_STATE_KEY = "_ketos_ag_ui_actor_id"
_FORBIDDEN_QUERY_CREDENTIALS = frozenset({"api_key", "x-api-key"})


def _forbidden_api_key_present(request: Request) -> bool:
    return (
        "x-api-key" in request.headers
        or any(name in request.query_params for name in _FORBIDDEN_QUERY_CREDENTIALS)
        or "apikey_tkn_lflw" in request.cookies
    )


async def get_current_ag_ui_user(
    request: Request,
    token: Annotated[str | None, Security(oauth2_login)],
    db: AsyncSession = Depends(injectable_session_scope),
) -> User:
    """Authenticate one AG-UI request using only a Bearer/access cookie token."""
    if _forbidden_api_key_present(request):
        error = InvalidCredentialsError("API key credentials are not accepted by the AG-UI endpoint")
        raise auth_utils._auth_error_to_http(error)  # noqa: SLF001

    if not isinstance(token, str) or not token.strip():
        error = MissingCredentialsError("An access token is required by the AG-UI endpoint")
        raise auth_utils._auth_error_to_http(error)  # noqa: SLF001

    try:
        user = await get_auth_service().get_current_user_from_access_token(token, db)
    except AuthenticationError as exc:
        raise auth_utils._auth_error_to_http(exc) from exc  # noqa: SLF001

    if not user.is_active:
        error = InvalidCredentialsError("User account is inactive")
        raise auth_utils._auth_error_to_http(error)  # noqa: SLF001

    actor_id = getattr(user, "id", None)
    if actor_id is None:
        error = InvalidCredentialsError("Authenticated user has no actor identifier")
        raise auth_utils._auth_error_to_http(error)  # noqa: SLF001

    setattr(request.state, AG_UI_ACTOR_STATE_KEY, str(actor_id))
    return user


CurrentAgUiUser = Annotated[User, Depends(get_current_ag_ui_user)]

__all__ = ["AG_UI_ACTOR_STATE_KEY", "CurrentAgUiUser", "get_current_ag_ui_user"]
