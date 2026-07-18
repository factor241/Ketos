# Minimum safe rollback floor

Decision: **NOT_SAFE_AT_BASELINE_SHA** `80878261d07c21ad257de017d98069f211ada2c2`.

This is a Stage 01 decision record, not a product change or deployment action.
The baseline cannot be selected as a safe rollback floor because current-source
evidence confirms credential-less MCP superuser resolution under `AUTO_LOGIN`,
owner impersonation when webhook authentication is disabled, and protected
build event/cancel access to NULL-owner Jobs.

The minimum safe floor is the first later application revision that proves all
of these contracts with current-SHA negative tests:

1. Protected Job reads, event streams, cancellation and mutation require an
   explicit non-NULL owner equal to the actor. Public jobs use a distinct,
   reviewed capability and never a NULL-owner compatibility branch.
2. Global and project MCP SSE, streamable and post-back routes require valid
   credentials or a cryptographically bound authenticated transport session;
   `AUTO_LOGIN` cannot create an MCP actor.
3. Webhooks always authenticate a flow-scoped principal. A normal or rollback
   profile cannot set `WEBHOOK_AUTH_ENABLE=false`.
4. Public Flow execution remains restricted to stored public Flows and rejects
   unknown public custom code.
5. SSRF protection remains enabled, public custom components remain disabled,
   and external MCP URL/subprocess configuration has reviewed enforcement.
6. A runtime route dump and installed-plugin census contain zero unreviewed
   execution or mutation surfaces.

No such revision is established by Stage 01 evidence. Selecting a concrete
release therefore remains owned by Stage 02 security containment and release
operations after the tests above pass.
