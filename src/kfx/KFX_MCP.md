# KFX MCP Server

`kfx-mcp` is an MCP (Model Context Protocol) server that lets an
MCP-compatible client create and manage flows, configure components and
connections, validate and build graphs, and run workflows on a Ketos instance.
It does not expose every application screen or every Board interaction.

The server is implemented in `src/kfx/src/kfx/mcp/` using
[FastMCP](https://github.com/jlowin/fastmcp) and connects to the Ketos REST
API. Flow data is not cached by the MCP server: each mutating tool reads the
current flow, applies its change, and writes the updated flow back. Component
type metadata is cached for the MCP session.

## Prerequisites

- A local Ketos source checkout initialized with `make init`
- A running Ketos instance
- A Ketos API key, or username and password for the `login` tool
- `uv`

> **Package-name note:** the project currently published as `kfx` on PyPI is
> unrelated to Ketos KFX. Do not use `pip install kfx`, `uv pip install kfx`,
> or `uvx --from kfx` for this server.

Prepare the local command from source:

```bash
git clone https://github.com/factor241/Ketos.git
cd Ketos
make init
uv run kfx-mcp
```

The last command starts the stdio server and waits for an MCP client. It does
not open an HTTP port.

## Connect a client

`kfx-mcp` runs over **stdio**: the MCP client spawns it as a subprocess and
communicates over stdin and stdout. The subprocess then calls the configured
Ketos HTTP API.

Any client that supports stdio MCP servers can start `kfx-mcp` from an
initialized source checkout. Replace `/absolute/path/to/Ketos` with the
absolute path to that checkout and pass these environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `KETOS_SERVER_URL` | URL of your Ketos instance | `http://localhost:7860` |
| `KETOS_API_KEY` | API key for authentication | — |

For example, to connect to Claude Desktop, add the following to the Claude Desktop configuration file at `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ketos": {
      "command": "uv",
      "args": [
        "run",
        "--project",
        "/absolute/path/to/Ketos",
        "kfx-mcp"
      ],
      "env": {
        "KETOS_SERVER_URL": "http://localhost:7860",
        "KETOS_API_KEY": "<your-api-key>"
      }
    }
  }
}
```

## Server tools

The server exposes the following tool groups to the connected MCP client.

### Auth

| Tool | Description |
|------|-------------|
| `login` | Authenticate with a Ketos server using username and password. Not needed if `KETOS_API_KEY` is set. |

### Flows

| Tool | Description |
|------|-------------|
| `create_flow` | Create a new empty flow |
| `create_flow_from_spec` | Create a complete flow from a compact text spec (nodes, edges, config in one call) |
| `list_flows` | List flows on the server, with ASCII graph diagrams |
| `get_flow_info` | Get detailed info about a flow: components, connections, graph |
| `delete_flow` | Delete a flow |
| `duplicate_flow` | Copy an existing flow |
| `rename_flow` | Update a flow's name or description |
| `update_flow_from_spec` | Replace an existing flow's nodes, edges, and config from a spec |
| `export_flow` | Export a flow as JSON with sensitive fields redacted |

### Starter projects

| Tool | Description |
|------|-------------|
| `list_starter_projects` | List Ketos's built-in example flows |
| `use_starter_project` | Create a new flow from a starter project template |

### Components

| Tool | Description |
|------|-------------|
| `search_component_types` | Find component types by name, category, or output type |
| `describe_component_type` | Get a component type's inputs, outputs, fields, and advanced fields |
| `components` | Search or describe component types in one call |
| `add_component` | Add a component to a flow |
| `remove_component` | Remove a component and its connections from a flow |
| `configure_component` | Set parameter values on a component. Returns a `warnings` field if a server-side refresh failed for a parameter, such an API key not yet configured on the component. |
| `list_components` | List all components in a flow |
| `get_component_info` | Get a component's current parameter values (sensitive fields redacted) |
| `freeze_component` | Freeze a component so it uses cached output and skips re-execution |
| `unfreeze_component` | Unfreeze a component so it re-executes on the next run |

### Connections

| Tool | Description |
|------|-------------|
| `connect_components` | Connect an output of one component to an input of another |
| `disconnect_components` | Remove connections between two components |

### Execution

| Tool | Description |
|------|-------------|
| `run_flow` | Run a flow and return the output; streams progress events when the client supports it. Accepts `input_type` (default: `"chat"`), `output_type` (default: `"chat"`), and `tweaks` (dict of component param overrides at runtime, e.g. `{"MyComponent": {"temperature": 0.2}}`). |
| `build_flow` | Trigger a server-side build to validate components and connections (async, returns `job_id`; poll separately for results) |
| `validate_flow` | Validate a flow inline; fast-fails on the first component error and returns the structured result (blocks until done, unlike `build_flow`) |
| `get_build_results` | Get per-component build results from the last run |
| `get_component_output` | Get a specific component's output from the last run |

### Utility

| Tool | Description |
|------|-------------|
| `layout_flow` | Re-layout a flow's components using the Sugiyama algorithm |
| `notify_done` | Emit a `flow_settled` UI event after modifying a flow. An optional `summary` string is forwarded in the event payload (for example, `"Built a RAG pipeline with OpenAI and Pinecone"`). |
| `batch` | Execute multiple actions in sequence; use `$N.field` to reference results from previous steps. Cannot nest `batch` inside another `batch` (excluded from its own tool map). |

## How to use the server

The server's instructions describe the intended usage pattern:

1. Authenticate — call `login`, or set `KETOS_API_KEY` before starting
2. Discover components — use `search_component_types` or `describe_component_type`
3. Build a flow — use `create_flow_from_spec` for a complete flow in one call, or step-by-step with `create_flow` → `add_component` → `configure_component` → `connect_components`
4. Run the flow — call `run_flow`

The `batch` tool lets you send multiple actions in a single call, with `$N.field` references to chain results:

```json
[
  {"tool": "create_flow", "args": {"name": "My Chatbot"}},
  {"tool": "add_component", "args": {"flow_id": "$0.id", "component_type": "ChatInput"}},
  {"tool": "add_component", "args": {"flow_id": "$0.id", "component_type": "OpenAIModel"}},
  {"tool": "add_component", "args": {"flow_id": "$0.id", "component_type": "ChatOutput"}},
  {"tool": "connect_components", "args": {
    "flow_id": "$0.id", "source_id": "$1.id", "source_output": "message",
    "target_id": "$2.id", "target_input": "input_value"
  }},
  {"tool": "connect_components", "args": {
    "flow_id": "$0.id", "source_id": "$2.id", "source_output": "text_output",
    "target_id": "$3.id", "target_input": "input_value"
  }}
]
```

## Quickstart: build and run a flow with Claude Code

This example shows how to connect Claude Code to a running Ketos instance using `kfx-mcp`, then build, validate, and run a chatbot flow from your terminal.

### Prerequisites

- A Ketos server running at `http://localhost:7860`
- A Ketos API key. Create one in the Ketos UI under **Settings → Ketos API → Create new API key**.
- An OpenAI API key. This example uses Ketos's Agent component with OpenAI. Add your OpenAI API key as a Global Variable in Ketos under **Settings → Global Variables** so all flows can use it automatically, or pass it explicitly when prompted. If you prefer a different provider, adjust the prompt accordingly.
- An initialized Ketos source checkout at an absolute local path.
- `uv` installed. For more information, see the [uv docs](https://docs.astral.sh/uv/getting-started/installation/).
- Claude Code installed. For more information, see the [Claude Code docs](https://docs.anthropic.com/en/docs/claude-code).

1. Add `kfx-mcp` to Claude Code.

Run the following commands in your terminal. Replace the checkout path, and
read the API key into the current shell without echoing it or placing it in
shell history:

```bash
read -rs KETOS_API_KEY && export KETOS_API_KEY

claude mcp add ketos \
  -e KETOS_SERVER_URL=http://localhost:7860 \
  -e KETOS_API_KEY="$KETOS_API_KEY" \
  -- uv run --project /absolute/path/to/Ketos kfx-mcp
```

To authenticate later through the MCP `login` tool instead, omit the API key:

```bash
claude mcp add ketos \
  -e KETOS_SERVER_URL=http://localhost:7860 \
  -- uv run --project /absolute/path/to/Ketos kfx-mcp
```

2. Verify `kfx-mcp` was added to Claude Code:

```bash
claude mcp list
```

The output should include:

```
ketos: uv run --project /absolute/path/to/Ketos kfx-mcp
```

This confirms that Claude Code knows to spawn an `kfx-mcp` process when it needs to talk to Ketos.

3. Start Claude Code in your terminal:

```bash
claude
```

4. Give Claude Code instructions.
For example:

```
Create a simple agent chatbot flow in Ketos using OpenAI, validate the flow, and then run it with the message "What is Ketos?"
```

Given this instruction, Claude Code will typically do the following:

    1. Discover the available components using `search_component_types` or `describe_component_type`.
    2. Create the flow with all nodes and connections in one request using `create_flow_from_spec`.
    3. Validate that every component is correctly connected using `validate_flow`.
    4. Run the flow using `run_flow` and return the response.

`kfx-mcp` stores the flow through the Ketos API, so the same flow is available
in the visual editor after the interface refreshes. The model response is
returned to the MCP client; its exact text depends on the selected provider,
model, component configuration, and prompt.

### Troubleshooting

* `kfx-mcp` is not found when the client starts the server

Confirm that the path supplied to `--project` is the initialized Ketos
checkout, then run this from any directory:

```bash
uv run --project /absolute/path/to/Ketos \
  python -c "import shutil; print(shutil.which('kfx-mcp'))"
```

The command must print a path inside the Ketos virtual environment. If it
prints `None`, return to the checkout and run `make init`.

* 403 Forbidden when Claude Code tries to use tools
The API key is invalid or expired. Create a new API key in Ketos under **Settings → Ketos API**, and then remove and re-add the MCP server:
```bash
read -rs KETOS_API_KEY && export KETOS_API_KEY

claude mcp remove ketos
claude mcp add ketos \
  -e KETOS_SERVER_URL=http://localhost:7860 \
  -e KETOS_API_KEY="$KETOS_API_KEY" \
  -- uv run --project /absolute/path/to/Ketos kfx-mcp
```

* Flow validation fails with an LLM provider error
The API key for your LLM provider is not configured. Add it as a Global Variable in Ketos (**Settings → Global Variables → Add**), and then ask Claude Code to validate the flow again.
