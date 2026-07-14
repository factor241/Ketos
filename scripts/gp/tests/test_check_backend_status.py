"""Tests for credential-safe backend GP completion status."""

from unittest.mock import MagicMock, patch

import check_backend_status as status_mod


def _response(resource_strings):
    response = MagicMock()
    response.json.return_value = {"resourceStrings": resource_strings}
    return response


def test_partial_or_blank_ru_catalog_is_not_complete(capsys):
    en_keys = {"components.input.name", "errors.generic"}
    response = _response({"components.input.name": {"value": "Ввод"}, "errors.generic": {"value": ""}})

    with (
        patch.object(status_mod, "get_headers", return_value={}),
        patch.object(status_mod.requests, "get", return_value=response),
    ):
        complete = status_mod.print_status(en_keys, {"components.input.name"}, {"errors.generic"}, ["ru"])

    output = capsys.readouterr().out
    assert complete is False
    assert "INCOMPLETE" in output
    assert "COMPLETE" not in output.replace("INCOMPLETE", "")


def test_complete_ru_catalog_reports_complete(capsys):
    en_keys = {"components.input.name", "errors.generic"}
    response = _response(
        {"components.input.name": {"value": "Ввод"}, "errors.generic": {"value": "Неожиданная ошибка"}}
    )

    with (
        patch.object(status_mod, "get_headers", return_value={}),
        patch.object(status_mod.requests, "get", return_value=response),
    ):
        complete = status_mod.print_status(en_keys, {"components.input.name"}, {"errors.generic"}, ["ru"])

    output = capsys.readouterr().out
    assert complete is True
    assert "ru" in output
    assert "COMPLETE" in output


def test_signed_status_request_uses_common_tls_configuration(tmp_path):
    response = _response({"errors.generic": {"value": "Ошибка"}})
    ca_bundle = str(tmp_path / "gp-ca.pem")

    with (
        patch.object(status_mod, "get_headers", return_value={}),
        patch.object(status_mod, "get_tls_verify", return_value=ca_bundle) as tls_verify,
        patch.object(status_mod.requests, "get", return_value=response) as request,
    ):
        status_mod.fetch_translated_count("ru", {"errors.generic"})

    tls_verify.assert_called_once_with()
    assert request.call_args.kwargs["verify"] == ca_bundle
