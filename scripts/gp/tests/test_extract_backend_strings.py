"""Tests for extract_backend_strings.py."""

import json
from types import SimpleNamespace
from unittest.mock import patch

import extract_backend_strings as extract_mod
import pytest

SAMPLE_STRINGS = {
    "components.ChatInput.description": "Get chat inputs from the Playground.",
    "components.ChatInput.display_name": "Chat Input",
    "components.ChatInput.inputs.input_value.display_name": "Input Text",
    "components.ChatInput.outputs.message.display_name": "Chat Message",
}


class _UndeclaredRuntimePresentation:
    dynamic_i18n = {}

    def update_build_config(self, build_config, runtime_message):
        build_config["mode"]["placeholder"] = runtime_message
        return build_config


class _DeclaredRuntimePresentation:
    dynamic_i18n = {"placeholder": "Unable to load choices: {error}"}

    def update_build_config(self, build_config, runtime_message):
        build_config["mode"]["placeholder"] = runtime_message
        return build_config


class _VerbatimRuntimePresentation:
    dynamic_i18n = {}
    dynamic_i18n_verbatim = frozenset({"info"})

    def update_build_config(self, build_config, provider_content):
        build_config["prompt"]["info"] = provider_content
        return build_config


def _run_main(*args):
    with patch("sys.argv", ["extract_backend_strings.py", *args]):
        extract_mod.main()


class TestExtractBackendStrings:
    def test_runtime_presentation_expressions_require_a_declaration_or_verbatim_policy(self):
        fields = frozenset({"info", "placeholder"})

        assert extract_mod.unregistered_dynamic_presentation_fields(
            _UndeclaredRuntimePresentation,
            fields,
        ) == frozenset({"placeholder"})
        assert not extract_mod.unregistered_dynamic_presentation_fields(
            _DeclaredRuntimePresentation,
            fields,
        )
        assert not extract_mod.unregistered_dynamic_presentation_fields(
            _VerbatimRuntimePresentation,
            fields,
        )

    def test_counts_components_from_hashed_catalog_keys(self):
        strings = {
            "components.chatinput.display_name.aaaaaaaa": "Chat Input",
            "components.chatinput.inputs.text.display_name.bbbbbbbb": "Text",
            "components.prompttemplate.description.cccccccc": "Build a prompt.",
            "components._toolmode.outputs.component_as_tool.display_name.dddddddd": "Toolset",
            "starter_flows.example.name": "Example",
        }

        assert extract_mod.count_component_keys(strings) == 2

    def test_skipped_imports_are_blocking_and_machine_readable(self, tmp_path):
        report_file = tmp_path / "extraction-report.json"
        skipped = [
            extract_mod.SkippedImport(
                module="lfx.components.broken",
                error_type="RuntimeError",
                message="dependency failed",
            )
        ]

        with (
            patch.object(
                extract_mod,
                "collect_strings",
                side_effect=extract_mod.SkippedImportsError(skipped),
            ),
            pytest.raises(SystemExit) as exc_info,
        ):
            _run_main("--report-json", str(report_file))

        assert exc_info.value.code == 1
        assert json.loads(report_file.read_text(encoding="utf-8")) == {
            "component_count": 0,
            "key_count": 0,
            "ok": False,
            "skipped_imports": [
                {
                    "error_type": "RuntimeError",
                    "message": "dependency failed",
                    "module": "lfx.components.broken",
                }
            ],
        }

    def test_writes_en_json_to_output_path(self, tmp_path):
        output_file = tmp_path / "en.json"
        with (
            patch.object(extract_mod, "collect_strings", return_value=SAMPLE_STRINGS),
            patch.object(extract_mod, "OUTPUT_PATH", output_file),
        ):
            _run_main()

        assert output_file.exists()
        data = json.loads(output_file.read_text(encoding="utf-8"))
        assert data == SAMPLE_STRINGS

    def test_writes_keys_in_order_returned_by_collect_strings(self, tmp_path):
        """main() writes keys in the order collect_strings() returns them.

        collect_strings() always returns sorted keys, so the output is sorted in practice.
        """
        output_file = tmp_path / "en.json"
        pre_sorted = {  # collect_strings() always returns sorted keys
            "components.A.display_name": "A",
            "components.M.display_name": "M",
            "components.Z.display_name": "Z",
        }
        with (
            patch.object(extract_mod, "collect_strings", return_value=pre_sorted),
            patch.object(extract_mod, "OUTPUT_PATH", output_file),
        ):
            _run_main()

        raw = output_file.read_text(encoding="utf-8")
        keys_in_order = [line.strip().split('"')[1] for line in raw.splitlines() if '": "' in line]
        assert keys_in_order == list(pre_sorted.keys())

    def test_check_mode_passes_when_in_sync(self, tmp_path):
        output_file = tmp_path / "en.json"
        expected_content = json.dumps(SAMPLE_STRINGS, ensure_ascii=False, indent=2) + "\n"
        output_file.write_text(expected_content, encoding="utf-8")

        with (
            patch.object(extract_mod, "collect_strings", return_value=SAMPLE_STRINGS),
            patch.object(extract_mod, "OUTPUT_PATH", output_file),
            pytest.raises(SystemExit) as exc_info,
        ):
            _run_main("--check")

        assert exc_info.value.code == 0

    def test_check_mode_fails_when_out_of_sync(self, tmp_path):
        output_file = tmp_path / "en.json"
        output_file.write_text('{"components.OldKey.display_name": "Old"}', encoding="utf-8")

        with (
            patch.object(extract_mod, "collect_strings", return_value=SAMPLE_STRINGS),
            patch.object(extract_mod, "OUTPUT_PATH", output_file),
            pytest.raises(SystemExit) as exc_info,
        ):
            _run_main("--check")

        assert exc_info.value.code == 1

    def test_check_mode_fails_when_file_missing(self, tmp_path):
        missing_file = tmp_path / "en.json"

        with (
            patch.object(extract_mod, "collect_strings", return_value=SAMPLE_STRINGS),
            patch.object(extract_mod, "OUTPUT_PATH", missing_file),
            pytest.raises(SystemExit) as exc_info,
        ):
            _run_main("--check")

        assert exc_info.value.code == 1

    def test_creates_output_directory_if_missing(self, tmp_path):
        nested_file = tmp_path / "nested" / "dir" / "en.json"

        with (
            patch.object(extract_mod, "collect_strings", return_value=SAMPLE_STRINGS),
            patch.object(extract_mod, "OUTPUT_PATH", nested_file),
        ):
            _run_main()

        assert nested_file.exists()

    def test_collect_strings_skips_deactivated_modules(self, tmp_path):
        """collect_strings() must skip any module whose name contains 'deactivated'."""
        import hashlib
        import pkgutil
        import re
        import sys
        import types

        fake_modules = [
            pkgutil.ModuleInfo(module_finder=None, name="lfx.components.active", ispkg=False),
            pkgutil.ModuleInfo(module_finder=None, name="lfx.components.deactivated.old", ispkg=False),
        ]

        fake_components_pkg = types.ModuleType("lfx.components")
        fake_components_pkg.__path__ = []
        fake_components_pkg.__name__ = "lfx.components"

        active_module = types.ModuleType("lfx.components.active")
        active_module.__name__ = "lfx.components.active"

        class FakeComponent:
            __module__ = "lfx.components.active"
            code_class_base_inheritance = True
            display_name = "Active Component"
            description = "An active component"
            name = "ActiveComponent"
            dynamic_i18n = {"helper_text": ("Loaded dynamic help",)}
            inputs = [
                SimpleNamespace(
                    name="policy",
                    display_name="Policy",
                    info="Choose a policy.",
                    placeholder="Select policy",
                    helper_text="Policy help",
                    refresh_button_text="Refresh policies",
                    list_add_label="Add Policy",
                    auth_tooltip="Connect first",
                    min_label="Strict",
                    max_label="Permissive",
                    trigger_text="Open policies",
                    options=["Strict", "Permissive"],
                    options_metadata=[{"icon": "lock"}, {"icon": "lock-open"}],
                    external_options={"label": "Connect other models", "id": "connect_other_models"},
                    dialog_inputs={
                        "fields": {
                            "nested": SimpleNamespace(
                                to_dict=lambda: {
                                    "display_name": "Nested dynamic field",
                                    "value": "raw_nested_value",
                                }
                            )
                        }
                    },
                    to_dict=lambda: {"info": "Serialized policy info."},
                )
            ]
            outputs = []

            def update_build_config(self, build_config, _field_value, _field_name=None):
                build_config["policy"]["helper_text"] = "Choose a dynamic policy."
                build_config["policy"]["display_name"] = "Dynamic Policy"
                return build_config

        active_module.FakeComponent = FakeComponent

        # Provide a minimal fake langflow.utils.i18n_keys so collect_strings()
        # can be called without langflow installed in the test environment.
        fake_i18n_keys = types.ModuleType("langflow.utils.i18n_keys")

        def _content_hash(english: str) -> str:
            return hashlib.sha256(english.encode()).hexdigest()[:8]

        fake_i18n_keys.component_field_key = lambda norm, path, eng: f"components.{norm}.{path}.{_content_hash(eng)}"
        fake_i18n_keys.component_dynamic_field_path = lambda path: f"dynamic.{path.rsplit('.', maxsplit=1)[-1]}"
        fake_i18n_keys.component_option_label = lambda option, metadata=None: (
            metadata.get("label")
            if isinstance(metadata, dict) and isinstance(metadata.get("label"), str)
            else option
            if isinstance(option, str)
            else option.get("label") or option.get("name")
            if isinstance(option, dict)
            else None
        )
        fake_i18n_keys.normalize_component_key = lambda name: name.replace(" ", "").lower()
        fake_i18n_keys.safe_flow_key = lambda name: re.sub(r"[^a-zA-Z0-9]+", "_", name).strip("_").lower()
        fake_i18n_keys.COMPONENT_INPUT_TEXT_FIELDS = (
            "display_name",
            "info",
            "placeholder",
            "helper_text",
            "refresh_button_text",
            "list_add_label",
            "auth_tooltip",
            "min_label",
            "max_label",
            "trigger_text",
        )
        fake_i18n_keys.COMPONENT_NESTED_TEXT_KEYS = frozenset(
            {"label", "description", "display_name", "helper_text", "text", "title", "tooltip"}
        )

        fake_langflow = types.ModuleType("langflow")
        fake_langflow_utils = types.ModuleType("langflow.utils")
        fake_initial_setup = types.ModuleType("langflow.initial_setup")
        fake_initial_constants = types.ModuleType("langflow.initial_setup.constants")
        fake_initial_constants.STARTER_FOLDER_NAME = "Starter Projects"
        fake_initial_constants.STARTER_FOLDER_NAME_I18N_KEY = "system_folders.starter.name"
        fake_initial_constants.ASSISTANT_FOLDER_NAME = "Langflow Assistant"
        fake_initial_constants.ASSISTANT_FOLDER_NAME_I18N_KEY = "system_folders.assistant.name"
        fake_folder_package = types.ModuleType("langflow.services.database.models.folder")
        fake_folder_constants = types.ModuleType("langflow.services.database.models.folder.constants")
        fake_folder_constants.DEFAULT_FOLDER_DISPLAY_NAME = "Starter Project"
        fake_folder_constants.DEFAULT_FOLDER_NAME_I18N_KEY = "system_folders.default.name"
        component_index = tmp_path / "component_index.json"
        component_index.write_text(
            json.dumps(
                {
                    "metadata": {"num_components": 1, "num_modules": 1},
                    "entries": [
                        [
                            "Indexed",
                            {
                                "IndexedOnly": {
                                    "display_name": "Indexed only",
                                    "description": "",
                                    "template": {
                                        "path": {
                                            "name": "path",
                                            "info": "Index-only generated info",
                                        }
                                    },
                                    "outputs": [],
                                }
                            },
                        ]
                    ],
                }
            ),
            encoding="utf-8",
        )

        with (
            patch.dict(
                sys.modules,
                {
                    "lfx": types.ModuleType("lfx"),
                    "lfx.components": fake_components_pkg,
                    "langflow": fake_langflow,
                    "langflow.utils": fake_langflow_utils,
                    "langflow.utils.i18n_keys": fake_i18n_keys,
                    "langflow.initial_setup": fake_initial_setup,
                    "langflow.initial_setup.constants": fake_initial_constants,
                    "langflow.services.database.models.folder": fake_folder_package,
                    "langflow.services.database.models.folder.constants": fake_folder_constants,
                },
            ),
            patch("pkgutil.walk_packages", return_value=fake_modules),
            patch("importlib.import_module", return_value=active_module),
            patch.object(extract_mod, "COMPONENT_INDEX_PATH", component_index),
        ):
            strings = extract_mod.collect_strings()

        # Deactivated module was skipped; active module processed
        assert any("activecomponent" in k for k in strings)
        values = set(strings.values())
        assert {
            "Policy help",
            "Refresh policies",
            "Add Policy",
            "Connect first",
            "Strict",
            "Permissive",
            "Open policies",
            "Connect other models",
            "Choose a dynamic policy.",
            "Dynamic Policy",
            "Loaded dynamic help",
            "Nested dynamic field",
            "Serialized policy info.",
            "Index-only generated info",
            "Starter Project",
            "Starter Projects",
            "Langflow Assistant",
        } <= values
        assert any(
            key.startswith("components.activecomponent.dynamic.helper_text.")
            and value == "Choose a dynamic policy."
            for key, value in strings.items()
        )
