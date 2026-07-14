# KFX - Ketos Executor

The Ketos Executor (KFX) is a command-line tool that serves and runs flows statelessly from flow JSON files with minimal dependencies.

Running a flow with KFX is similar to running flows with the `--backend-only` environment variable enabled, but even more lightweight because the Ketos package and all of its dependencies don't need to be installed.

KFX uses a no-op database interface called [`NoopSession`](https://git.ketos.test/ketos/ketos/blob/main/src/kfx/src/kfx/services/session.py) for all operations that require persistent state.
There is no `ketos.db` database file when using KFX.
You can run flows with the API, but any stateful operations that depend on the Ketos database, like saving flows, storing messages, or managing users **will not** persist data.
Operations that depend on `ketos.db` will not work as they do in the full Ketos application.

Memory operations are dispatched at call time, not at import time.
If the `ketos` package is installed in the same Python environment as `kfx` and a real database service is registered, memory operations are routed to the full `ketos.memory` implementation instead. This applies when `kfx` is used as a Python library inside a running Ketos server, not when running `kfx run` or `kfx serve` from the command line.

## Commands

**Runtime commands** — documented in this README:

| Command | Description |
|---------|-------------|
| [`kfx serve`](#serve-the-simple-agent-starter-flow-with-kfx-serve) | Serve one or more flows as FastAPI endpoints at `/flows/{flow_id}/run` |
| [`kfx run`](#run-the-simple-agent-flow-with-kfx-run) | Execute a flow locally and stream results to `stdout` |
| [`kfx-mcp`](#kfx-mcp) | Start an MCP server that connects to a running Ketos instance |

**Flow DevOps SDK commands** — documented in the [Flow DevOps Toolkit](https://docs.ketos.test/flow-devops-sdk):

| Command | Description |
|---------|-------------|
| `kfx init` | Scaffold a versioned flow project with CI templates |
| `kfx login` | Validate credentials against a remote Ketos instance |
| `kfx create` | Create a new flow JSON from a built-in or custom template |
| `kfx validate` | Validate flow JSON before pushing |
| `kfx requirements` | Generate `requirements.txt` from a flow's component dependencies |
| `kfx status` | Compare local flow files against a remote Ketos instance |
| `kfx push` | Push flows to a remote instance by stable ID |
| `kfx pull` | Pull flows from a remote instance to local files |
| `kfx export` | Normalize flow JSON for clean git diffs |

## Prerequisites

- Install [Python](https://www.python.org/downloads/release/python-3100/).
- Install [uv](https://docs.astral.sh/uv/getting-started/installation/).
- Create or download a flow JSON file. For example, download the Simple Agent flow from the repository:

  ```bash
  curl -o simple-agent-flow.json "https://git.ketos.test/ketos/ketos/raw/main/src/backend/base/ketos/initial_setup/starter_projects/Simple%20Agent.json"
  ```

- Create an [OpenAI API key](https://platform.openai.com/api-keys).
- Create a Ketos API key. For KFX, you can generate a secure token locally (see [Serve the simple agent starter flow with `kfx serve`](#serve-the-simple-agent-starter-flow-with-kfx-serve)), or create one through the Ketos server UI or CLI.

## Install KFX

KFX can be installed in multiple ways. If you have installed Ketos OSS version >=1.6, `kfx` is already included.

### Clone repository

1. Clone the Ketos repository:

   ```bash
   git clone https://git.ketos.test/ketos/ketos
   ```

2. Change directory to `ketos/src/kfx`:

   ```bash
   cd ketos/src/kfx
   ```

   From this directory, you can run `kfx` commands using `uv run kfx` as shown in [kfx serve](#serve-the-simple-agent-starter-flow-with-kfx-serve) or [kfx run](#run-the-simple-agent-flow-with-kfx-run).

### Install from PyPI

1. Create and activate a virtual environment:

   ```bash
   uv venv kfx-venv
   source kfx-venv/bin/activate
   ```

2. Install the KFX package from PyPI:

   ```bash
   uv pip install kfx
   ```

   To install the latest nightly (pre-release) version of KFX:

   ```bash
   uv pip install --pre kfx
   ```

   To run `kfx` commands, continue to [kfx serve](#serve-the-simple-agent-starter-flow-with-kfx-serve) or [kfx run](#run-the-simple-agent-flow-with-kfx-run).

### Run without installing

Run KFX without installing it locally using `uvx`.

1. Create a Ketos API key (see [Serve](#serve-the-simple-agent-starter-flow-with-kfx-serve)), and set `KETOS_API_KEY` in the same terminal session as `kfx`:

   ```bash
   export KETOS_API_KEY="sk..."
   ```

2. Run `kfx serve` using `uvx`:

   ```bash
   uvx kfx serve simple-agent-flow.json
   ```

   This command downloads and runs KFX in a temporary environment without permanent installation. From the same environment, you can also run flows directly with [kfx run](#run-the-simple-agent-flow-with-kfx-run).

## Serve the simple agent starter flow with `kfx serve`

`kfx serve` starts a FastAPI server that hosts one or more flows. You can load flows at startup from files or a directory, or start with an empty registry and upload flows via the API. Once running, flows are available at `POST /flows/{flow_id}/run`.

`kfx serve` accepts a `.json` flow file or a `.py` Python script (same as `kfx run`), as well as inline JSON via `--flow-json` or piped input via `--stdin`.

`kfx serve` accepts a `.json` flow file or a `.py` Python script (same as `kfx run`), as well as inline JSON via `--flow-json` or piped input via `--stdin`.

The API key is required for security because `kfx serve` can create a publicly accessible FastAPI server.

This example uses the **Agent** component's built-in OpenAI model, which requires an OpenAI API key. If you want to use a different provider, edit the model provider, model name, and credentials accordingly.

1. Generate a Ketos API key.

   For KFX, you can generate a secure token locally to use as your `KETOS_API_KEY`:

   ```bash
   uv run python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

   This is different from creating a Ketos API key through the Ketos server UI or CLI, which stores the key in the Ketos database. For KFX, you only need a secure token string to authenticate requests to your KFX server.

2. Set up your environment variables using one of the following options.

   **Option: .env file**

   Create a `.env` file and populate it with your flow's variables. The `KETOS_API_KEY` is required. This example assumes the flow requires an OpenAI API key.

   ```bash
   KETOS_API_KEY="sk..."
   OPENAI_API_KEY="sk-..."
   ```

   **Option: Export variables**

   Export your variables in the same terminal session where you'll start the server. You must declare your variables before the server starts for the server to pick them up.

   ```bash
   export KETOS_API_KEY="sk..."
   export OPENAI_API_KEY="sk-..."
   ```

3. Install dependencies.

   If you already have Ketos installed, or if you're running from source at `src/kfx`, KFX is included with Ketos and all dependencies are already available. You don't need to install additional dependencies.

   If you install the standalone `kfx` package from [PyPI](https://pypi.org/project/kfx/) or run KFX with `uvx`, you need to manually install the dependencies required by the components in your flow.

   To find which dependencies your flow requires:

   1. Run your flow with [kfx run](#run-the-simple-agent-flow-with-kfx-run):

      ```bash
      uv run kfx run simple-agent-flow.json "test input"
      ```

      KFX reports any missing dependencies in the subsequent error message.
   2. Install the missing dependencies that KFX reports.

   For example, to run the simple agent template flow, install these dependencies in your environment before running the simple agent flow:

   ```bash
   uv pip install "langchain~=0.3.23" "langchain-core<1.0.0" "langchain-community" "langchain-openai" "langchain-text-splitters" beautifulsoup4 lxml requests
   ```

4. Start the server with your variable values using one of the following options.

   **Option: .env file**

   This example assumes your flow file and `.env` file are in the current directory:

   ```bash
   uv run kfx serve simple-agent-flow.json --env-file .env
   ```

   If your `.env` file is in a different location, provide the full or relative path:

   ```bash
   uv run kfx serve simple-agent-flow.json --env-file /path/to/.env
   ```

   **Option: Export variables**

   If you exported your variables, the command to start the server automatically picks up the values when it starts:

   ```bash
   uv run kfx serve simple-agent-flow.json
   ```

   To export new values, stop the server, export the variables, and then start the server again.

5. The startup process displays a `flow_id` value in the output. Copy the `flow_id` to use in the test API call in the next step. In this example, the `flow_id` is `c1dab29d-3364-58ef-8fef-99311d32ee42`:

   ```
    KFX Server
    Flow loaded: simple-agent-flow.json (c1dab29d-3364-58ef-8fef-99311d32ee42)
    Server:      http://127.0.0.1:8000
    Run flows at: POST /flows/{flow_id}/run
    API key:     x-api-key header or ?x-api-key= query parameter
   ```

6. To send a test request to the server, open a new terminal and export your `flow_id` and Ketos API key values as variables:

   ```bash
   export KETOS_API_KEY="sk..."
   export FLOW_ID="c1dab29d-3364-58ef-8fef-99311d32ee42"
   ```

7. Test the server with an API call to the `/flows/flow_id/run` endpoint:

   ```bash
   curl -X POST http://localhost:8000/flows/$FLOW_ID/run \
     -H "Content-Type: application/json" \
     -H "x-api-key: $KETOS_API_KEY" \
     -d '{"input_value": "Hello, world!"}'
   ```

   Successful response example:

   ```json
   {
     "result": "Hello world! 👋\n\nHow can I help you today? If you have any questions or need assistance, just let me know!",
     "success": true,
     "logs": "\n\n\u001b[1m> Entering new None chain...\u001b[0m\n\u001b[32;1m\u001b[1;3mHello world! 👋\n\nHow can I help you today?...\u001b[0m\n\n\u001b[1m> Finished chain.\u001b[0m\n",
     "type": "message",
     "component": "Chat Output"
   }
   ```

Your flow is now running as a lightweight API endpoint, with only the flow's required dependencies and no visual builder installed. Users who call your endpoint don't need to install Ketos or configure their own LLM provider keys.

To make your server publicly accessible, use a tunneling service like ngrok or deploy to a public cloud provider.

### HTTP endpoints

The KFX server exposes the following endpoints. All `/flows/{flow_id}` routes require the `x-api-key` header or `?x-api-key=` query parameter.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/flows` | GET | List all served flows and their metadata |
| `/flows/upload/` | POST | Upload a flow JSON to the registry (accepts full Ketos export format) |
| `/flows/{flow_id}/run` | POST | Run the flow and return a single response |
| `/flows/{flow_id}/stream` | POST | Run the flow and stream output as server-sent events |
| `/flows/{flow_id}/info` | GET | Return flow metadata (title, description, input/output types) |
| `/health` | GET | Global health check — returns `{"status": "ok"}` |
| `/docs` | GET | Auto-generated OpenAPI/Swagger UI |

### Request body schema

**`POST /flows/{flow_id}/run`**

```json
{
  "input_value": "Your message here",
  "session_id": "optional-conversation-id"
}
```

`session_id` is optional. When set, Agent and Memory components use it to maintain conversation history across multiple calls. If omitted, a new session ID is generated for each request.

**`POST /flows/{flow_id}/stream`**

```json
{
  "input_value": "Your message here",
  "input_type": "chat",
  "output_type": "chat",
  "output_component": null,
  "session_id": "optional-conversation-id",
  "tweaks": {"ComponentName": {"param": "value"}}
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `input_value` | — | Required. Input passed to the flow. |
| `input_type` | `"chat"` | Input type: `chat` or `text`. |
| `output_type` | `"chat"` | Output type: `chat`, `text`, `debug`, or `any`. |
| `output_component` | `null` | Pin output to a specific component by name. |
| `session_id` | `null` | Conversation ID for memory continuity across requests. |
| `tweaks` | `null` | Per-request parameter overrides. Keys are component names; values are dicts of parameter overrides. Use this to parameterize a flow without modifying the JSON. |

### Response schema

The KFX server's response schema is different from the Ketos API `/run` endpoint's schema. Requests to the KFX server's `/flows/{flow_id}/run` endpoint return the following fields:

```json
{
  "result": "string",      // Output result from the flow execution
  "success": true,         // Whether execution was successful
  "logs": "string",        // Captured logs from execution
  "type": "message",       // Type of result
  "component": "string"    // The component that generated the result (e.g. "Chat Output")
}
```

The `/stream` endpoint returns the same fields as server-sent events, with one event per component output.

### Serve multiple flows at startup

You can pass a directory, multiple file paths, or a mix of both to load several flows at startup. Each flow is registered under its own ID.

```bash
# Serve every .json file in a directory (top-level only, not recursive)
uv run kfx serve flows/

# Serve specific files
uv run kfx serve flow-a.json flow-b.json

# Mix directory and individual files
uv run kfx serve flows/ extra-flow.json
```

Python `.py` script flows are also supported when using a single worker:

```bash
uv run kfx serve my_flow.py
```

### Start with no flows

`kfx serve` starts with an empty registry when no flow path is provided. Flows can then be uploaded via the API:

```bash
uv run kfx serve --env-file .env
```

### Upload flows dynamically

While the server is running, upload flows with `POST /flows/upload/`.

The endpoint accepts the full Ketos export JSON directly, the same format you get from the Ketos UI's **Export** button:

```bash
# Upload a flow JSON file
curl -X POST http://localhost:8000/flows/upload/ \
  -H "x-api-key: $KETOS_API_KEY" \
  -H "Content-Type: application/json" \
  -d @my-flow.json

# Upload and replace an existing flow with the same ID
curl -X POST "http://localhost:8000/flows/upload/?replace=true" \
  -H "x-api-key: $KETOS_API_KEY" \
  -H "Content-Type: application/json" \
  -d @my-flow.json
```

The server returns a `409 Conflict` error if you upload a flow whose ID is already registered and `replace=true` is not set.

### Multi-worker deployment

Use `--workers N` to start multiple uvicorn worker processes, and `--flow-dir` to point all workers at a shared directory so they serve the same flows.

```bash
# 4 workers, flows shared via a local temp directory
uv run kfx serve flows/ --workers 4 --flow-dir /tmp/kfx-flows

# Cross-pod sharing (Kubernetes PVC or similar network volume)
uv run kfx serve flows/ --workers 4 --flow-dir /mnt/shared-flows
```

How it works:

- Each startup flow file is persisted to `--flow-dir` as `{flow_id}.json` when the server starts.
- Uploads via `POST /flows/upload/` are also written to `--flow-dir`, making them visible to every worker on the next request.
- Deletes propagate across workers: each worker detects a missing file on the next request to that flow and returns `404`.
- Without `--flow-dir`, each worker maintains an isolated in-memory registry. Uploads reach only the worker that received the request.

> **Note:** `--workers > 1` with `--flow-dir` does not support `.py` script flows — Python graphs cannot be serialized to the filesystem store.

A warning is printed when `--workers > 1` is used without `--flow-dir`, because in that case each worker has its own isolated in-memory registry.

### Isolate credentials with `--no-env-fallback` _(experimental)_

By default, `kfx serve` resolves component credentials from the process environment (`os.environ`). In multi-tenant deployments, this means every request shares the same credentials.

Use `--no-env-fallback` to disable process-environment fallback. With this flag set, credentials must be supplied per-request in the `global_vars` field of the request body:

```bash
uv run kfx serve my-flow.json --no-env-fallback --env-file .env
```

Pass per-request credentials in the `global_vars` map under `KETOS_REQUEST_VARIABLES`:

```bash
curl -X POST http://localhost:8000/flows/$FLOW_ID/run \
  -H "Content-Type: application/json" \
  -H "x-api-key: $KETOS_API_KEY" \
  -d '{
    "input_value": "Hello world",
    "global_vars": {
      "KETOS_REQUEST_VARIABLES": {
        "OPENAI_API_KEY": "sk-per-request-key"
      }
    }
  }'
```

Credentials supplied in `KETOS_REQUEST_VARIABLES` are scoped to the current request using Python `contextvars`. Ketos's built-in components do not write them to `os.environ`, so they do not bleed into other concurrent requests on the same worker. Custom components that explicitly write to `os.environ` are outside this guarantee.

### Check or upgrade flow compatibility at startup

Use `--upgrade-flow` to check compatibility between a flow and the current KFX version before serving it. See [KFX and Ketos version compatibility](https://docs.ketos.test/kfx-compatibility) for details on the version model.

```bash
# Fail at startup if any component is incompatible
uv run kfx serve my-flow.json --upgrade-flow=check

# Apply safe upgrades in memory, then start serving
uv run kfx serve my-flow.json --upgrade-flow=safe
```

### KFX serve options

| Option | Description |
|--------|--------------|
| `--check-variables` / `--no-check-variables` | Check global variables for environment compatibility. Default: `--check-variables`. |
| `--env-file` | Path to the `.env` file containing environment variables. |
| `--flow-dir` | Directory for the filesystem-backed flow store shared across workers. When set, startup flows and uploads are persisted here. |
| `--flow-json` | Read inline flow JSON content as a string. Example: `uv run kfx serve --flow-json '{...}'`. |
| `--host`, `-h` | Host to bind the server to. Default: `127.0.0.1`. |
| `--log-level` | Logging level. One of: `debug`, `info`, `warning`, `error`, `critical`. Default: `warning`. |
| `--no-env-fallback` / `--env-fallback` | Disable process-environment fallback for credential resolution. Use with per-request `KETOS_REQUEST_VARIABLES`. Default: `--env-fallback`. |
| `--port`, `-p` | Port to bind the server to. Default: `8000`. |
| `--stdin` | Read JSON flow content from `stdin`. Example: `cat flow.json | uv run kfx serve --stdin`. |
| `--upgrade-flow` | Compatibility mode: `check` reports issues and fails, `safe` applies safe upgrades in memory. |
| `--verbose`, `-v` | Show diagnostic output and execution details. |
| `--workers`, `-w` | Number of uvicorn worker processes. Default: `1`. Use with `--flow-dir` for multi-worker flow sharing. |

## Run the simple agent flow with `kfx run`

The `kfx run` command runs a flow from a JSON file without serving it, and the output is sent to `stdout`. Input to `kfx run` can be a path to the JSON file, inline JSON passed with `--input-value`, or read from `stdin`. No Ketos API key is required.

This example uses the **Agent** component's built-in OpenAI model, which requires an OpenAI API key. If you want to use a different provider, edit the model provider, model name, and credentials accordingly.

1. Export your variables in the same terminal session where you'll run the flow:

   ```bash
   export OPENAI_API_KEY="sk-..."
   ```

2. Install dependencies.

   If you already have Ketos installed, or if you're running from source at `src/kfx`, KFX is included with Ketos and all dependencies are already available. You don't need to install additional dependencies.

   If you install the standalone `kfx` package from [PyPI](https://pypi.org/project/kfx/) or run KFX with `uvx`, you need to manually install the dependencies required by the components in your flow.

   To find which dependencies your flow requires:

   1. Run your flow with [kfx run](#run-the-simple-agent-flow-with-kfx-run):

      ```bash
      uv run kfx run simple-agent-flow.json "test input"
      ```

      KFX reports any missing dependencies in the subsequent error message.
   2. Install the missing dependencies that KFX reports.

   For example, to run the simple agent template flow, install these dependencies in your environment before running the simple agent flow:

   ```bash
   uv pip install "langchain~=0.3.23" "langchain-core<1.0.0" "langchain-community" "langchain-openai" "langchain-text-splitters" beautifulsoup4 lxml requests
   ```

3. Run the flow from a flow JSON file:

   ```bash
   uv run kfx run simple-agent-flow.json "Hello world"
   ```

   This flow expects a `Message` input, which is a simple text string.

   You can also use the `--input-value` flag instead of a positional argument:

   ```bash
   uv run kfx run simple-agent-flow.json --input-value "Hello world"
   ```

   The `--input-value` flag is required when using `--stdin` or `--flow-json` options, since those options use the positional argument for the flow definition instead of the input value.

In addition to running flows from JSON files, `kfx run` supports other input methods, described below.

### Run flows from stdin

The `--stdin` option lets you run flows from dynamic sources (APIs, databases) or after modifying a flow before execution. The command reads the flow's JSON definition from `stdin`, validates the JSON structure, and runs the flow. The `--input-value` flag is required when using `--stdin`.

Read a flow JSON from stdin:

```bash
cat simple-agent-flow.json | uv run kfx run --stdin \
  --input-value "Hello world" \
  --format json | jq '.result'
```

Fetch a flow JSON from a remote API and run it:

```bash
curl https://api.example.com/flows/my-agent-flow | uv run kfx run --stdin \
  --input-value "Hello world"
```

Modify a flow created in the visual builder before execution (e.g. change the OpenAI model to `gpt-4o`):

```bash
cat simple-agent-flow.json | jq '(.data.nodes[] | select(.data.node.template.model_name.value) | .data.node.template.model_name.value) = "gpt-4o"' | \
  uv run kfx run --stdin \
  --input-value "Hello world" \
  --format json | jq '.result'
```

### Run flows with inline JSON

Instead of piping from `stdin` or reading from a JSON file, you can pass the flow JSON directly as a string argument. The `--input-value` flag is required when using `--flow-json`.

```bash
uv run kfx run --flow-json '{"data": {"nodes": [...], "edges": [...]}}' \
  --input-value "Hello world"
```

### KFX run options

| Option | Description |
|--------|--------------|
| `--check-variables` / `--no-check-variables` | Validate the flow's global variables. Default: check. |
| `--flow-json` | Load inline JSON flow content as a string. |
| `--format`, `-f` | Output format. One of: `json`, `text`, `message`, `result`. Default: `json`. |
| `--input-value` | Input value to pass to the graph. |
| `--session-id` | Session ID for conversation tracking. Agent and Memory components use this to maintain history across runs. Auto-generated if not set. |
| `--stdin` | Read JSON flow content from `stdin`. |
| `--timing` | Include detailed timing information in output. |
| `--upgrade-flow` | Compatibility mode: `check` reports issues and fails, `safe` applies safe upgrades in memory before running. |
| `--verbose`, `-v` | Show basic progress and diagnostic output. |
| `-vv` | Show detailed progress and debug information. |
| `-vvv` | Show full debugging output including component logs. |

In addition to running flows from JSON files, you can use `kfx run` with Python scripts that define flows programmatically. This approach allows you to create flows directly in Python code without the visual builder.

For a complete example of creating an agent flow programmatically using KFX components, see the [Complete Agent Example on PyPI](https://pypi.org/project/kfx) or the **Complete Agent Example** below.

#### Complete agent example

Create a file called `simple_agent.py`:

```python
"""A simple agent flow example for Ketos.

Usage:
    uv run kfx run simple_agent.py "How are you?"
"""

import os
from pathlib import Path

from kfx import components as cp
from kfx.graph import Graph
from kfx.log.logger import LogConfig


async def get_graph() -> Graph:
    """Create and return the graph with async component initialization."""
    log_config = LogConfig(
        log_level="INFO",
        log_file=Path("ketos.log"),
    )

    chat_input = cp.ChatInput()
    agent = cp.AgentComponent()
    url_component = cp.URLComponent()
    tools = await url_component.to_toolkit()

    agent.set(
        model_name="gpt-4.1-mini",
        agent_llm="OpenAI",
        api_key=os.getenv("OPENAI_API_KEY"),
        input_value=chat_input.message_response,
        tools=tools,
    )
    chat_output = cp.ChatOutput().set(input_value=agent.message_response)

    return Graph(chat_input, chat_output, log_config=log_config)
```

Install dependencies and set your OpenAI API key, then run:

```bash
uv run kfx run simple_agent.py "How are you?" --verbose
```

## kfx-mcp

`kfx-mcp` is a separate binary installed with `kfx`. It starts an MCP server that gives any MCP-compatible client programmatic control over a Ketos instance for building flows, managing components, and running executions.

For more information, see [KFX_MCP.md](./KFX_MCP.md).

## Development

```bash
# Install development dependencies
make dev

# Run tests
make test

# Format code
make format
```

## Pluggable services

KFX supports a pluggable service architecture that lets you customize and extend its behavior. You can replace built-in services (storage, telemetry, tracing, etc.) with your own implementations or use Ketos's full-featured services.

For more information, see [PLUGGABLE_SERVICES.md](./PLUGGABLE_SERVICES.md).

## Flattened component access

KFX supports simplified component imports for a better developer experience when building flows in Python.
You get simpler imports, easier discovery via `cp.ComponentName`, and full backward compatibility with the traditional import method.

**Before (old import style):**

```python
from kfx.components.agents.agent import AgentComponent
from kfx.components.data.url import URLComponent
from kfx.components.input_output import ChatInput, ChatOutput
```

**Now (flattened style):**

```python
from kfx import components as cp

chat_input = cp.ChatInput()
agent = cp.AgentComponent()
url_component = cp.URLComponent()
chat_output = cp.ChatOutput()
```

## Component category allowlist and blocklist

You can restrict which component categories are available when loading flows by using an allowlist or a blocklist.

### Environment variables

Both settings are optional. When unset or empty, all categories from the component index are loaded.

| Variable | Description |
|----------|-------------|
| `KETOS_COMPONENT_CATEGORY_ALLOWLIST` | Comma-separated list of component category names to **include**. If empty (default), all categories are included. If set, only the listed categories are available. |
| `KETOS_COMPONENT_CATEGORY_BLOCKLIST` | Comma-separated list of component category names to **exclude**. If empty (default), no categories are excluded. Applied after the allowlist. |

Category names are case-insensitive.

### Component categories

Category names in the allowlist and blocklist match the component index (e.g. top-level folders under `kfx.components`). The virtual keyword **`core`** in the allowlist or blocklist expands to the following core categories (aligned with the frontend sidebar):

- `input_output`, `data_source`, `models_and_agents`, `llm_operations`, `files_and_knowledge`, `processing`, `flow_controls`, `utilities`, `prototypes`, `tools`, `agents`, `data`, `logic`, `helpers`, `models`, `vectorstores`, `inputs`, `outputs`, `prompts`, `chains`, `documentloaders`, `link_extractors`, `output_parsers`, `retrievers`, `textsplitters`, `toolkits`

Provider-specific and other categories (e.g. `openai`, `anthropic`, `google`, `langchain_utilities`) are also valid; the full set depends on your KFX version and index.

### How to use in KFX

1. Set one or both environment variables before running `kfx serve` or `kfx run`. The filter is applied when the component index is loaded.

Allowlist only — restrict to specific categories:

   ```bash
   export KETOS_COMPONENT_CATEGORY_ALLOWLIST="openai,anthropic,google,processing,input_output"
   uv run kfx serve my_flow.json
   ```

Blocklist only — load all categories except the ones you exclude:

   ```bash
   export KETOS_COMPONENT_CATEGORY_BLOCKLIST="prototypes,langchain_utilities"
   uv run kfx run my_flow.json "Hello"
   ```

Virtual `core` keyword — use `core` in the allowlist or blocklist to refer to all core categories at once (e.g. allow only core categories, or exclude all core from a broader set):

   ```bash
   export KETOS_COMPONENT_CATEGORY_ALLOWLIST="core"
   uv run kfx serve my_flow.json
   ```

## License

MIT License. See [LICENSE](../../LICENSE) for details.
