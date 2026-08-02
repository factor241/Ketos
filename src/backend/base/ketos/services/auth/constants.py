"""Auth-related constants shared by service and utils (avoids circular imports)."""

AUTO_LOGIN_WARNING = "In v2.0, KETOS_SKIP_AUTH_AUTO_LOGIN will be removed. Please update your authentication method."
AUTO_LOGIN_ERROR = (
    "Since v1.5, KETOS_AUTO_LOGIN requires a valid API key. "
    "Set KETOS_SKIP_AUTH_AUTO_LOGIN=true to skip this check. "
    "Please update your authentication method."
)
AUTO_LOGIN_SESSION_WARNING = (
    "KETOS_AUTO_LOGIN is enabled: /auto_login is issuing a superuser session "
    "without credentials. Disable AUTO_LOGIN and create a real superuser for any "
    "non-local or shared deployment."
)
