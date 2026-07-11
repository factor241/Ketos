"""Tests for gp_client.py — HMAC auth and API operations."""

import base64
import hashlib
import hmac
import importlib
from pathlib import Path
from unittest.mock import MagicMock, patch

import gp_client
import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def test_target_languages_include_russian_for_both_bundles():
    assert gp_client.TARGET_LANGS == ["fr", "ja", "es", "de", "pt", "zh-Hans", "ru"]


class TestTlsVerification:
    def test_system_trust_store_is_the_secure_default(self):
        with patch.dict("os.environ", {}, clear=True):
            importlib.reload(gp_client)

            assert gp_client.get_tls_verify() is True

    def test_explicit_ca_bundle_is_forwarded(self, tmp_path):
        ca_bundle = tmp_path / "gp-ca.pem"
        ca_bundle.write_text("test CA bundle", encoding="utf-8")

        with patch.dict("os.environ", {"GP_CA_BUNDLE": str(ca_bundle)}, clear=True):
            importlib.reload(gp_client)

            assert gp_client.get_tls_verify() == str(ca_bundle.resolve())

    def test_missing_ca_bundle_fails_closed(self, tmp_path):
        missing = tmp_path / "missing.pem"

        with patch.dict("os.environ", {"GP_CA_BUNDLE": str(missing)}, clear=True):
            importlib.reload(gp_client)
            with pytest.raises(RuntimeError, match="GP_CA_BUNDLE"):
                gp_client.get_tls_verify()

    @pytest.mark.parametrize("disabled_value", ["false", "0", "no", "off"])
    def test_tls_verification_cannot_be_disabled(self, disabled_value):
        with patch.dict("os.environ", {"GP_VERIFY_SSL": disabled_value}, clear=True):
            importlib.reload(gp_client)
            with pytest.raises(RuntimeError, match="cannot disable TLS verification"):
                gp_client.get_tls_verify()


def _expected_signature(password: str, message: str) -> str:
    sig = hmac.new(
        bytes(password, "ISO-8859-1"),
        msg=bytes(message, "ISO-8859-1"),
        digestmod=hashlib.sha1,
    ).digest()
    return base64.b64encode(sig).decode()


# ---------------------------------------------------------------------------
# get_headers
# ---------------------------------------------------------------------------


class TestGetHeaders:
    def test_missing_credentials_fail_with_names_only(self):
        with patch.dict("os.environ", {}, clear=True):
            importlib.reload(gp_client)
            with pytest.raises(RuntimeError) as exc_info:
                gp_client.get_headers("https://example.com/api", "GET")

        message = str(exc_info.value)
        assert "GP_ADMIN_USER_ID" in message
        assert "GP_ADMIN_PASSWORD" in message
        assert "None" not in message

    def test_get_request_authorization_format(self):
        with patch.dict("os.environ", {"GP_ADMIN_USER_ID": "user123", "GP_ADMIN_PASSWORD": "secret"}):
            importlib.reload(gp_client)
            headers = gp_client.get_headers("https://example.com/api", "GET")

        assert headers["Authorization"].startswith("GP-HMAC user123:")
        assert "GP-Date" in headers
        assert headers["accept"] == "application/json"
        assert "Content-Type" not in headers

    def test_put_request_includes_content_type(self):
        with patch.dict("os.environ", {"GP_ADMIN_USER_ID": "user123", "GP_ADMIN_PASSWORD": "secret"}):
            importlib.reload(gp_client)
            headers = gp_client.get_headers("https://example.com/api", "PUT", {"key": "val"})

        assert headers["Content-Type"] == "application/json"

    def test_patch_request_uses_merge_patch_content_type(self):
        with patch.dict("os.environ", {"GP_ADMIN_USER_ID": "user123", "GP_ADMIN_PASSWORD": "secret"}):
            importlib.reload(gp_client)
            headers = gp_client.get_headers("https://example.com/api", "PATCH", {})

        assert headers["Content-Type"] == "application/merge-patch+json"

    def test_hmac_signature_is_deterministic_for_same_inputs(self):
        with patch.dict("os.environ", {"GP_ADMIN_USER_ID": "user123", "GP_ADMIN_PASSWORD": "secret"}):
            importlib.reload(gp_client)
            with patch("gp_client.datetime") as mock_dt:
                mock_dt.now.return_value.strftime.return_value = "Thu, 26 Mar 2026 12:00:00 UTC"
                h1 = gp_client.get_headers("https://example.com", "GET")
                h2 = gp_client.get_headers("https://example.com", "GET")

        assert h1["Authorization"] == h2["Authorization"]


# ---------------------------------------------------------------------------
# list_bundles
# ---------------------------------------------------------------------------


class TestListBundles:
    def test_returns_parsed_json_on_success(self):
        mock_response = MagicMock()
        mock_response.json.return_value = {"bundleIds": ["langflow-ui"]}

        with (
            patch.dict("os.environ", {"GP_ADMIN_USER_ID": "u", "GP_ADMIN_PASSWORD": "p"}),
            patch("gp_client.requests.get", return_value=mock_response) as mock_get,
        ):
            importlib.reload(gp_client)
            result = gp_client.list_bundles()

        mock_get.assert_called_once()
        assert mock_get.call_args.kwargs["verify"] is True
        mock_response.raise_for_status.assert_called_once()
        assert result == {"bundleIds": ["langflow-ui"]}

    def test_uses_configured_ca_bundle(self, tmp_path):
        ca_bundle = tmp_path / "gp-ca.pem"
        ca_bundle.write_text("test CA bundle", encoding="utf-8")
        mock_response = MagicMock()
        mock_response.json.return_value = {"bundleIds": []}

        with (
            patch.dict(
                "os.environ",
                {
                    "GP_ADMIN_USER_ID": "u",
                    "GP_ADMIN_PASSWORD": "p",
                    "GP_CA_BUNDLE": str(ca_bundle),
                },
                clear=True,
            ),
            patch("gp_client.requests.get", return_value=mock_response) as mock_get,
        ):
            importlib.reload(gp_client)
            gp_client.list_bundles()

        assert mock_get.call_args.kwargs["verify"] == str(Path(ca_bundle).resolve())

    def test_raises_on_http_error(self):
        import requests as req

        mock_response = MagicMock()
        mock_response.raise_for_status.side_effect = req.exceptions.HTTPError("401 Unauthorized")

        with (
            patch.dict("os.environ", {"GP_ADMIN_USER_ID": "u", "GP_ADMIN_PASSWORD": "p"}),
            patch("gp_client.requests.get", return_value=mock_response),
        ):
            importlib.reload(gp_client)
            with pytest.raises(req.exceptions.HTTPError):
                gp_client.list_bundles()

    def test_raises_on_timeout(self):
        import requests as req

        with (
            patch.dict("os.environ", {"GP_ADMIN_USER_ID": "u", "GP_ADMIN_PASSWORD": "p"}),
            patch("gp_client.requests.get", side_effect=req.exceptions.Timeout),
        ):
            importlib.reload(gp_client)
            with pytest.raises(req.exceptions.Timeout):
                gp_client.list_bundles()


# ---------------------------------------------------------------------------
# upload_strings
# ---------------------------------------------------------------------------


class TestUploadStrings:
    def test_successful_upload(self):
        mock_response = MagicMock()
        mock_response.json.return_value = {"status": "ok"}

        with (
            patch.dict("os.environ", {"GP_ADMIN_USER_ID": "u", "GP_ADMIN_PASSWORD": "p"}),
            patch("gp_client.requests.put", return_value=mock_response) as mock_put,
        ):
            importlib.reload(gp_client)
            result = gp_client.upload_strings({"hello": "Hello"})

        mock_put.assert_called_once()
        assert result == {"status": "ok"}

    def test_raises_on_server_error(self):
        import requests as req

        mock_response = MagicMock()
        mock_response.raise_for_status.side_effect = req.exceptions.HTTPError("500")

        with (
            patch.dict("os.environ", {"GP_ADMIN_USER_ID": "u", "GP_ADMIN_PASSWORD": "p"}),
            patch("gp_client.requests.put", return_value=mock_response),
        ):
            importlib.reload(gp_client)
            with pytest.raises(req.exceptions.HTTPError):
                gp_client.upload_strings({"hello": "Hello"})


# ---------------------------------------------------------------------------
# get_strings
# ---------------------------------------------------------------------------


class TestGetStrings:
    def test_returns_parsed_json(self):
        mock_response = MagicMock()
        mock_response.json.return_value = {"resourceStrings": {"hello": {"value": "Bonjour"}}}

        with (
            patch.dict("os.environ", {"GP_ADMIN_USER_ID": "u", "GP_ADMIN_PASSWORD": "p"}),
            patch("gp_client.requests.get", return_value=mock_response),
        ):
            importlib.reload(gp_client)
            result = gp_client.get_strings("fr")

        assert result["resourceStrings"]["hello"]["value"] == "Bonjour"

    def test_raises_on_403(self):
        import requests as req

        mock_response = MagicMock()
        mock_response.raise_for_status.side_effect = req.exceptions.HTTPError("403 Forbidden")

        with (
            patch.dict("os.environ", {"GP_ADMIN_USER_ID": "u", "GP_ADMIN_PASSWORD": "p"}),
            patch("gp_client.requests.get", return_value=mock_response),
        ):
            importlib.reload(gp_client)
            with pytest.raises(req.exceptions.HTTPError):
                gp_client.get_strings("fr")
