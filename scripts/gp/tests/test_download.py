"""Tests for download.py."""

import json
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import download as dl_mod
import pytest


def _run_frontend(output_dir: str):
    source = Path(output_dir).parent / "frontend-source-en.json"
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_text(
        json.dumps({key: f"English {key}" for key in FRONTEND_SAMPLE_RESPONSE["resourceStrings"]}),
        encoding="utf-8",
    )
    _run_with_source("frontend", output_dir, str(source))


def _run_backend(output_dir: str):
    source = Path(output_dir).parent / "backend-source-en.json"
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_text(
        json.dumps({key: f"English {key}" for key in BACKEND_SAMPLE_RESPONSE["resourceStrings"]}),
        encoding="utf-8",
    )
    _run_with_source("backend", output_dir, str(source))


def _run_with_source(target: str, output_dir: str, source_path: str, *, lang: str | None = None):
    argv = ["download.py", "--target", target, "--output", output_dir, "--source", source_path]
    if lang is not None:
        argv.extend(["--lang", lang])
    with patch("sys.argv", argv):
        dl_mod.main()


FRONTEND_SAMPLE_RESPONSE = {
    "resourceStrings": {
        "hello": {"value": "Bonjour"},
        "bye": {"value": "Au revoir"},
    }
}

BACKEND_SAMPLE_RESPONSE = {
    "resourceStrings": {
        "components.ChatInput.display_name": {"value": "Entrée de chat"},
        "components.ChatInput.description": {"value": "Obtenir les entrées de chat"},
    }
}


class TestDownloadFrontend:
    def test_partial_keyset_is_blocking_and_keeps_existing_catalog(self, tmp_path):
        source = tmp_path / "en.json"
        source.write_text(json.dumps({"hello": "Hello", "bye": "Bye"}), encoding="utf-8")
        output = tmp_path / "locales"
        output.mkdir()
        existing = output / "ru.json"
        existing.write_text(json.dumps({"stable": "Проверено"}), encoding="utf-8")
        response = {"resourceStrings": {"hello": {"value": "Привет"}}}

        with (
            patch.object(dl_mod, "get_strings", return_value=response),
            pytest.raises(SystemExit) as exc_info,
        ):
            _run_with_source("frontend", str(output), str(source), lang="ru")

        assert exc_info.value.code == 1
        assert json.loads(existing.read_text(encoding="utf-8")) == {"stable": "Проверено"}

    def test_ru_only_command_path_downloads_only_ru(self, tmp_path):
        source = tmp_path / "en.json"
        source.write_text(json.dumps({"hello": "Hello", "bye": "Bye"}), encoding="utf-8")
        output = tmp_path / "locales"
        called_langs = []

        def _get_strings(lang):
            called_langs.append(lang)
            return FRONTEND_SAMPLE_RESPONSE

        with patch.object(dl_mod, "get_strings", side_effect=_get_strings):
            _run_with_source("frontend", str(output), str(source), lang="ru")

        assert called_langs == ["ru"]
        assert (output / "ru.json").exists()
        assert not (output / "fr.json").exists()

    def test_default_command_path_downloads_only_production_target(self, tmp_path):
        source = tmp_path / "en.json"
        source.write_text(json.dumps({"hello": "Hello", "bye": "Bye"}), encoding="utf-8")
        output = tmp_path / "locales"
        called_langs = []

        def _get_strings(lang):
            called_langs.append(lang)
            return FRONTEND_SAMPLE_RESPONSE

        with patch.object(dl_mod, "get_strings", side_effect=_get_strings):
            _run_with_source("frontend", str(output), str(source))

        assert called_langs == ["ru"]
        assert {path.name for path in output.glob("*.json")} == {"ru.json"}

    def test_credentials_are_not_written_to_catalog_or_logs(self, tmp_path, capsys):
        sentinel = "gp-value-sentinel-12345"
        source = tmp_path / "en.json"
        source.write_text(json.dumps({"hello": "Hello"}), encoding="utf-8")
        output = tmp_path / "locales"
        response = {"resourceStrings": {"hello": {"value": sentinel}}}

        with (
            patch.dict(os.environ, {"GP_ADMIN_PASSWORD": sentinel}),
            patch.object(dl_mod, "get_strings", return_value=response),
            pytest.raises(SystemExit) as exc_info,
        ):
            _run_with_source("frontend", str(output), str(source), lang="ru")

        assert exc_info.value.code == 1
        assert sentinel not in capsys.readouterr().out
        assert not (output / "ru.json").exists()

    def test_writes_json_files_for_each_language(self, tmp_path):
        with (
            patch.object(dl_mod, "get_strings", return_value=FRONTEND_SAMPLE_RESPONSE),
            patch.object(dl_mod, "TARGET_LANGS", ["fr", "es"]),
        ):
            _run_frontend(str(tmp_path))

        for lang in ["fr", "es"]:
            out = tmp_path / f"{lang}.json"
            assert out.exists()
            data = json.loads(out.read_text(encoding="utf-8"))
            assert data == {"hello": "Bonjour", "bye": "Au revoir"}

    def test_empty_language_is_blocking(self, tmp_path):
        def _get_strings(lang):
            if lang == "ja":
                return {"resourceStrings": {}}
            return FRONTEND_SAMPLE_RESPONSE

        with (
            patch.object(dl_mod, "get_strings", side_effect=_get_strings),
            patch.object(dl_mod, "TARGET_LANGS", ["fr", "ja"]),
            pytest.raises(SystemExit) as exc_info,
        ):
            _run_frontend(str(tmp_path))

        assert exc_info.value.code == 1
        assert not (tmp_path / "fr.json").exists()
        assert not (tmp_path / "ja.json").exists()

    def test_exits_with_error_on_partial_failure(self, tmp_path):
        def _get_strings(lang):
            if lang == "de":
                raise ConnectionError("network error")
            return FRONTEND_SAMPLE_RESPONSE

        with (
            patch.object(dl_mod, "get_strings", side_effect=_get_strings),
            patch.object(dl_mod, "TARGET_LANGS", ["fr", "de"]),
            pytest.raises(SystemExit) as exc_info,
        ):
            _run_frontend(str(tmp_path))

        assert exc_info.value.code == 1
        assert not (tmp_path / "fr.json").exists()

    def test_exits_cleanly_when_all_succeed(self, tmp_path):
        with (
            patch.object(dl_mod, "get_strings", return_value=FRONTEND_SAMPLE_RESPONSE),
            patch.object(dl_mod, "TARGET_LANGS", ["fr"]),
        ):
            _run_frontend(str(tmp_path))

        assert (tmp_path / "fr.json").exists()

    def test_handles_flat_string_values_in_response(self, tmp_path):
        flat_response = {
            "resourceStrings": {
                "hello": "Hola",
                "bye": "Adiós",
            }
        }

        with (
            patch.object(dl_mod, "get_strings", return_value=flat_response),
            patch.object(dl_mod, "TARGET_LANGS", ["es"]),
        ):
            _run_frontend(str(tmp_path))

        data = json.loads((tmp_path / "es.json").read_text(encoding="utf-8"))
        assert data == {"hello": "Hola", "bye": "Adiós"}


class TestDownloadBackend:
    def test_signed_download_uses_common_tls_configuration(self, tmp_path):
        response = MagicMock()
        response.json.return_value = {"resourceStrings": {}}
        ca_bundle = str(tmp_path / "gp-ca.pem")

        with (
            patch.object(dl_mod, "get_headers", return_value={}),
            patch.object(dl_mod, "get_tls_verify", return_value=ca_bundle) as tls_verify,
            patch.object(dl_mod.requests, "get", return_value=response) as request,
        ):
            dl_mod.get_backend_strings("ru")

        tls_verify.assert_called_once_with()
        assert request.call_args.kwargs["verify"] == ca_bundle

    def test_partial_keyset_is_blocking_and_writes_nothing(self, tmp_path):
        source = tmp_path / "en.json"
        source.write_text(
            json.dumps(
                {
                    "components.ChatInput.display_name": "Chat Input",
                    "components.ChatInput.description": "Get chat inputs",
                    "errors.generic": "Unexpected error",
                }
            ),
            encoding="utf-8",
        )
        output = tmp_path / "locales"

        with (
            patch.object(dl_mod, "get_backend_strings", return_value=BACKEND_SAMPLE_RESPONSE),
            pytest.raises(SystemExit) as exc_info,
        ):
            _run_with_source("backend", str(output), str(source), lang="ru")

        assert exc_info.value.code == 1
        assert not (output / "ru.json").exists()

    def test_blank_value_is_blocking(self, tmp_path):
        source = tmp_path / "en.json"
        source.write_text(json.dumps({"errors.generic": "Unexpected error"}), encoding="utf-8")
        output = tmp_path / "locales"
        response = {"resourceStrings": {"errors.generic": {"value": ""}}}

        with (
            patch.object(dl_mod, "get_backend_strings", return_value=response),
            pytest.raises(SystemExit) as exc_info,
        ):
            _run_with_source("backend", str(output), str(source), lang="ru")

        assert exc_info.value.code == 1
        assert not (output / "ru.json").exists()

    def test_writes_json_files_for_each_language(self, tmp_path):
        with (
            patch.object(dl_mod, "get_backend_strings", return_value=BACKEND_SAMPLE_RESPONSE),
            patch.object(dl_mod, "TARGET_LANGS", ["fr", "es"]),
        ):
            _run_backend(str(tmp_path))

        for lang in ["fr", "es"]:
            out = tmp_path / f"{lang}.json"
            assert out.exists()
            data = json.loads(out.read_text(encoding="utf-8"))
            assert data == {
                "components.ChatInput.display_name": "Entrée de chat",
                "components.ChatInput.description": "Obtenir les entrées de chat",
            }

    def test_empty_language_is_blocking(self, tmp_path):
        def _get_backend_strings(lang):
            if lang == "ja":
                return {"resourceStrings": {}}
            return BACKEND_SAMPLE_RESPONSE

        with (
            patch.object(dl_mod, "get_backend_strings", side_effect=_get_backend_strings),
            patch.object(dl_mod, "TARGET_LANGS", ["fr", "ja"]),
            pytest.raises(SystemExit) as exc_info,
        ):
            _run_backend(str(tmp_path))

        assert exc_info.value.code == 1
        assert not (tmp_path / "fr.json").exists()
        assert not (tmp_path / "ja.json").exists()

    def test_attempts_all_languages_then_blocks_on_partial_failure(self, tmp_path):
        def _get_backend_strings(lang):
            if lang == "de":
                raise ConnectionError("network error")
            return BACKEND_SAMPLE_RESPONSE

        with (
            patch.object(dl_mod, "get_backend_strings", side_effect=_get_backend_strings),
            patch.object(dl_mod, "TARGET_LANGS", ["fr", "de"]),
            pytest.raises(SystemExit) as exc_info,
        ):
            _run_backend(str(tmp_path))

        assert exc_info.value.code == 1
        assert not (tmp_path / "fr.json").exists()
        assert not (tmp_path / "de.json").exists()

    def test_creates_output_directory_if_missing(self, tmp_path):
        nested = tmp_path / "a" / "b" / "locales"
        with (
            patch.object(dl_mod, "get_backend_strings", return_value=BACKEND_SAMPLE_RESPONSE),
            patch.object(dl_mod, "TARGET_LANGS", ["fr"]),
        ):
            _run_backend(str(nested))

        assert nested.is_dir()
        assert (nested / "fr.json").exists()

    def test_handles_flat_string_values_in_response(self, tmp_path):
        flat_response = {
            "resourceStrings": {
                "components.ChatInput.display_name": "Eingabe",
            }
        }

        source = tmp_path / "en.json"
        source.write_text(json.dumps({"components.ChatInput.display_name": "Chat Input"}), encoding="utf-8")
        with patch.object(dl_mod, "get_backend_strings", return_value=flat_response):
            _run_with_source("backend", str(tmp_path), str(source), lang="ru")

        data = json.loads((tmp_path / "ru.json").read_text(encoding="utf-8"))
        assert data == {"components.ChatInput.display_name": "Eingabe"}

    def test_attempts_all_target_languages(self, tmp_path):
        called_langs = []

        def _get_backend_strings(lang):
            called_langs.append(lang)
            return BACKEND_SAMPLE_RESPONSE

        all_langs = ["fr", "ja", "es", "de", "pt", "zh-Hans", "ru"]
        with (
            patch.object(dl_mod, "get_backend_strings", side_effect=_get_backend_strings),
            patch.object(dl_mod, "TARGET_LANGS", all_langs),
        ):
            _run_backend(str(tmp_path))

        assert called_langs == all_langs
