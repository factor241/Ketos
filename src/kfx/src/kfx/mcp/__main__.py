"""Entry point for the Ketos MCP server.

Usage:
    python -m kfx.mcp
    # or via console script:
    kfx-mcp

Environment variables:
    KETOS_SERVER_URL: Ketos server URL (default: http://localhost:7860)
    KETOS_API_KEY: API key for authentication (skips login)
"""

from kfx.mcp.server import mcp


def main():
    mcp.run()


if __name__ == "__main__":
    main()
