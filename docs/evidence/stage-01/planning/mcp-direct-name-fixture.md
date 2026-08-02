# MCP direct-name fail-closed regression fixture

This is a Stage 02 test specification, not an implementation. It targets G-01
and G-05 and makes list/direct parity an executable acceptance contract.

## Fixture

Create two users, one Flow owned by user A, and API credentials/session state
for both users. Grant user A `Flow EXECUTE`; deny it to user B. Register a tool
whose deterministic direct-name is known. Run each case with the same Flow/tool
through both discovery/list and direct-name execution.

The success preconditions are evaluated at execution time, not cached from
discovery: authenticated current user, `Flow EXECUTE`, and
`mcp_enabled=true`. The actor is always server-derived.

## Required cases

| Case | List | direct-name | Required result |
| --- | --- | --- | --- |
| authenticated owner, EXECUTE, enabled | visible | callable | success with the same server-derived actor |
| unauthenticated | hidden/401 | denied 401 | no execution side effect |
| wrong owner | hidden/404 | denied 404 | anti-enumeration parity |
| owner without Flow EXECUTE | hidden/403 or approved 404 | identical denial | no execution side effect |
| `mcp_enabled=false` before discovery | hidden | denied | no execution side effect |
| enabled at discovery, disabled before execution | previously listed | denied | execution-time check proves no TOCTOU bypass |
| direct-name known without listing | not listed | denied unless all success preconditions hold | list/direct parity |
| alternate transport/session/API key | policy-equivalent | policy-equivalent | no AUTO_LOGIN shortcut |

## Assertions

- Direct invocation cannot bypass authentication, owner scope, Flow EXECUTE,
  or `mcp_enabled=true`.
- List and direct-name paths use the same authorization function or prove
  behaviorally identical checks.
- Wrong-owner responses follow the approved anti-enumeration contract.
- Denied calls produce no Job, trace, Flow mutation, tool effect, or secret in
  logs/errors.
- Tests run in `single_user_local`, `multi_user_network`, and
  `acceptance_secure`; only the explicit policy of each profile may differ.
