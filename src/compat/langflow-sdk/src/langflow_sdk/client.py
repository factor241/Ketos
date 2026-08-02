"""Legacy sync-client names backed by the canonical implementation."""

from ketos_sdk.client import KetosClient

Client = LangflowClient = KetosClient

__all__ = ["Client", "KetosClient", "LangflowClient"]
