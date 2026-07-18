# Emergency configuration rollback without bypasses

This record defines a fail-closed emergency posture. It does not authorize a
deployment or modify configuration.

- `AUTO_LOGIN=false` and `skip_auth_auto_login=false`.
- `WEBHOOK_AUTH_ENABLE=true`; contain webhook incidents at the proxy or by
  revoking scoped credentials, never by disabling authentication.
- `ssrf_protection_enabled=true` with an empty or explicitly reviewed bounded
  allow-list.
- `allow_public_custom_components=false`.
- If custom-code containment is required, set `allow_custom_components=false`
  together with `allow_components_paths_override=false`.
- Do not rely on `mcp_server_enabled=false` alone. At the baseline, the v1 MCP
  surface is unconditional and the flag adds a second `/api/mcp` surface.
  Deny both `/api/mcp/**` and `/api/v1/mcp/**` at a verified boundary until a
  safe application floor exists.
- Task-backend changes are availability operations, not authorization
  rollback. Validate Job ownership and event delivery before switching.

Known unsafe recovery actions are forbidden: enabling either auto-login path,
setting webhook authentication false, disabling SSRF protection, allowing
public custom components, or exposing a previously unreviewed MCP/plugin
route.
