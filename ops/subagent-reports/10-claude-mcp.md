# Agent 10 — Claude Code / Claude Desktop MCP for Ketos

Date: 2026-07-17  
Workspace: `/Volumes/Projects/ketos_canvas_mod_main`  
Overall status: **DONE_WITH_CONCERNS**

## Executive result

The requested MCP configuration is installed within the authorized scope:

- Claude Code has a project-scoped `raytsystem-toolhub` stdio definition in
  `.mcp.json`.
- Claude Desktop has two stdio definitions:
  - `raytsystem-toolhub`;
  - `ketos-claude-code`, backed by `claude mcp serve`.
- Both Desktop entries and the Claude Code project entry use one repository
  wrapper that pins the process cwd to the Ketos root and accepts only two
  fixed modes.
- The existing Claude Desktop configuration was backed up before modification.
- The RaytSystem-managed Claude runtime remains disabled with
  `reason: bare_auth_unavailable`.
- RaytSystem external MCP execution remains disabled and catalog-only.
- No commit or push was created.

The result is `DONE_WITH_CONCERNS`, rather than unconditional `DONE`, because
Claude Code correctly reports the new project MCP as `Pending approval`, and
the delegated agent session did not expose a callable Computer Use, Chrome, or
in-app Browser runtime for UI approval/reload verification.

## Configuration installed

### Claude Code project MCP

File: `.mcp.json`

```json
{
  "mcpServers": {
    "raytsystem-toolhub": {
      "command": "/Volumes/Projects/ketos_canvas_mod_main/scripts/claude/ketos-claude-mcp",
      "args": ["raytsystem-toolhub"]
    }
  }
}
```

Claude Code identifies it as:

```text
Scope: Project config (shared via .mcp.json)
Status: Pending approval
Transport: stdio
```

The project trust decision was not bypassed by editing user-global Claude
state. Approval must be made by the user in an interactive Claude Code session.

### Claude Desktop MCPs

File:

```text
/Users/kirillustuzanin/Library/Application Support/Claude/claude_desktop_config.json
```

Added server names:

```text
ketos-claude-code
raytsystem-toolhub
```

The existing `coworkUserFilesPath` and complete `preferences` object were
preserved. A semantic comparison against the backup passed:

```text
original.coworkUserFilesPath == updated.coworkUserFilesPath
original.preferences == updated.preferences
```

Backup created before the edit:

```text
/Users/kirillustuzanin/Library/Application Support/Claude/claude_desktop_config.json.backup-20260717-013309
```

Backup mode is `0600`.

### Repository wrapper

File: `scripts/claude/ketos-claude-mcp`

Properties:

- executable mode `0755`;
- fixed Ketos root:
  `/Volumes/Projects/ketos_canvas_mod_main`;
- fixed executable paths for `raytsystem` and `claude`;
- no shell-evaluated user command;
- exactly one mode argument is accepted;
- unknown or missing modes fail with exit code `64`;
- `raytsystem-toolhub` executes:

  ```text
  raytsystem tool serve-mcp --root /Volumes/Projects/ketos_canvas_mod_main
  ```

- `ketos-claude-code` executes:

  ```text
  claude mcp serve
  ```

Both processes inherit the wrapper's pinned Ketos cwd.

## Governance boundaries preserved

### RaytSystem Claude adapter

`config/runtime-adapters.yaml` was not edited. Current state remains:

```text
adapter_id=adapter_claude_code
state=disabled
reason=bare_auth_unavailable
```

### External MCP executor

Command:

```bash
raytsystem mcp list \
  --root /Volumes/Projects/ketos_canvas_mod_main \
  --json
```

Result:

```json
{
  "state": "catalog_only",
  "external_execution": false
}
```

The exposed `raytsystem-toolhub` is the first-party typed Tool Hub stdio
surface. Per the local RaytSystem protocol documentation, it is separate from
the governed arbitrary/external MCP catalog executor and does not enable
`external_mcp_execution_enabled`.

Tool Hub inventory:

```text
8 tools
generic_shell=false for every tool
```

The URL download contract still requires a destination-bound approval and an
outer enforcing executor. The stock stdio server does not inject that executor,
so network download remains fail-closed.

### Direct Desktop to Claude Code boundary

`ketos-claude-code` is a direct:

```text
Claude Desktop -> wrapper -> claude mcp serve
```

connection. It is explicitly **outside RaytSystem governance**. RaytSystem does
not catalog, approve, execute, audit, or sandbox the tools exposed by that
server. Its authority is controlled by Claude Code and Claude Desktop's own
permission/trust model. No existing global Desktop permission setting was
added, removed, or broadened in this task.

## Verification evidence

### Pre-change RED contract

Before implementation:

```text
.mcp.json present: no
wrapper executable: no
Desktop raytsystem-toolhub: no
Desktop ketos-claude-code: no
```

### JSON and preservation checks

Commands:

```bash
jq empty .mcp.json
jq empty "$HOME/Library/Application Support/Claude/claude_desktop_config.json"
jq -e --slurp \
  '.[0].coworkUserFilesPath == .[1].coworkUserFilesPath
   and .[0].preferences == .[1].preferences' \
  "$HOME/Library/Application Support/Claude/claude_desktop_config.json.backup-20260717-013309" \
  "$HOME/Library/Application Support/Claude/claude_desktop_config.json"
```

Result: **PASS**.

### Wrapper confinement and fail-closed checks

The wrapper was invoked from `/tmp`, not from the repository. Live process cwd
was inspected after MCP initialization.

Results:

```json
{"mode":"raytsystem-toolhub","initialize":true,"toolsList":true,"toolCount":8,"cwd":"/Volumes/Projects/ketos_canvas_mod_main"}
{"mode":"ketos-claude-code","initialize":true,"toolsList":true,"toolCount":30,"cwd":"/Volumes/Projects/ketos_canvas_mod_main"}
```

Invalid invocation results:

```text
no arguments -> exit 64
unknown mode -> exit 64
```

### Minimal stdio MCP smoke

For both servers, the smoke client sent only:

1. `initialize` with MCP protocol `2025-06-18`;
2. `notifications/initialized`;
3. `tools/list`.

No tool was called and no secret was supplied.

Results:

| Server | initialize | tools/list | Tools |
|---|---|---|---:|
| `raytsystem-toolhub` | PASS | PASS | 8 |
| `ketos-claude-code` | PASS | PASS | 30 |

Tool Hub names:

```text
video_probe
video_download
video_transcript
video_extract_audio
video_extract_frames
video_ocr_frames
video_inspect_frames
video_summarize_timeline
```

### Claude Code CLI visibility

Commands:

```bash
claude mcp get raytsystem-toolhub
claude mcp list
```

Result:

```text
raytsystem-toolhub
Scope: Project config (shared via .mcp.json)
Status: Pending approval
Command: scripts/claude/ketos-claude-mcp raytsystem-toolhub
```

The CLI parsed the project configuration successfully. It intentionally did
not connect before the interactive project trust approval.

### RaytSystem gates

```bash
raytsystem lint \
  --root /Volumes/Projects/ketos_canvas_mod_main \
  --json
```

Result: **PASS**, `ok=true`, findings `0`.

```bash
raytsystem doctor \
  --root /Volumes/Projects/ketos_canvas_mod_main \
  --json
```

Result: **CONCERN**, `healthy=false` only because
`code_graph_current=false`. Platform health, config, generation, ledger
pointer, Python, and root checks pass.

```bash
raytsystem graph status \
  --root /Volumes/Projects/ketos_canvas_mod_main \
  --json
```

Result:

```text
state=stale
changed_files=5
```

The RaytSystem graph was not rebuilt because graph maintenance and generated
workspace-state mutation were outside this MCP configuration scope.
Graphify was not rebuilt or changed.

## UI verification

Status: **BLOCKED**

Exact reason:

```text
The delegated agent tool surface exposed shell/file tools but no callable
Computer Use runtime, Chrome browser runtime, in-app Browser runtime, or
node_repl bridge required by the installed UI-control skills.
```

No clicks were simulated and no alternative GUI automation was used.
Consequently:

- Claude Desktop config parsing and both underlying stdio servers are verified;
- live Desktop reload, server badges, and interactive tool visibility are not
  UI-proven in this session;
- Claude Code project trust approval remains pending.

## Files

Repository files created:

- `.mcp.json`
- `scripts/claude/ketos-claude-mcp`
- `ops/subagent-reports/10-claude-mcp.md`

User file modified:

- `/Users/kirillustuzanin/Library/Application Support/Claude/claude_desktop_config.json`

User backup created:

- `/Users/kirillustuzanin/Library/Application Support/Claude/claude_desktop_config.json.backup-20260717-013309`

Explicitly not edited:

- `AGENTS.md`
- `CLAUDE.md`
- `config/runtime-adapters.yaml`
- generated RaytSystem state
- Graphify outputs

The wrapper and `.mcp.json` are not ignored by Git and are ready for the parent
integration workflow. They were not staged, committed, or pushed.

## Remaining user actions

1. Start Claude Code in the Ketos root and approve the project
   `raytsystem-toolhub` server when prompted.
2. Fully restart or reload Claude Desktop so it rereads
   `claude_desktop_config.json`.
3. Confirm both Desktop server entries appear and connect.

These are trust/UI activation steps; the on-disk configuration and direct
stdio protocol paths are already verified.
