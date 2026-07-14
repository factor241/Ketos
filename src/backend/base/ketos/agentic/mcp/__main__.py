"""Entry point for running the Ketos Agentic MCP server.

This allows running the server with:
    python -m ketos.agentic.mcp
"""

from ketos.agentic.mcp.server import mcp

if __name__ == "__main__":
    mcp.run()
