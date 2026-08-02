"""Unit tests for the kfx.helpers.flow module."""

import pytest
from kfx.utils.ketos_utils import has_ketos_memory

# Globals

_KFX_HELPER_MODULE_FLOW = "kfx.helpers.flow"

# Helper Functions


def is_helper_module(module, module_name):
    return module.__module__ == module_name


# Test Scenarios


class TestDynamicImport:
    """Test dynamic imports of the kfx implementation."""

    def test_ketos_available(self):
        """Test whether the ketos implementation is available."""
        # Ketos implementation should not be available
        if has_ketos_memory():
            pytest.fail("Ketos implementation is available")

    def test_helpers_import_build_schema_from_inputs(self):
        """Test the kfx.helpers.build_schema_from_inputs import."""
        try:
            from kfx.helpers import build_schema_from_inputs
        except (ImportError, ModuleNotFoundError) as e:
            pytest.fail(f"Failed to dynamically import kfx.helpers.build_schema_from_inputs: {e}")

        # Helper module should be the kfx implementation
        assert is_helper_module(build_schema_from_inputs, _KFX_HELPER_MODULE_FLOW)

    def test_helpers_import_get_arg_names(self):
        """Test the kfx.helpers.get_arg_names import."""
        try:
            from kfx.helpers import get_arg_names
        except (ImportError, ModuleNotFoundError) as e:
            pytest.fail(f"Failed to dynamically import kfx.helpers.get_arg_names: {e}")

        # Helper module should be the kfx implementation
        assert is_helper_module(get_arg_names, _KFX_HELPER_MODULE_FLOW)

    def test_helpers_import_get_flow_inputs(self):
        """Test the kfx.helpers.get_flow_inputs import."""
        try:
            from kfx.helpers import get_flow_inputs
        except (ImportError, ModuleNotFoundError) as e:
            pytest.fail(f"Failed to dynamically import kfx.helpers.get_flow_inputs: {e}")

        # Helper module should be the kfx implementation
        assert is_helper_module(get_flow_inputs, _KFX_HELPER_MODULE_FLOW)

    def test_helpers_import_list_flows(self):
        """Test the kfx.helpers.list_flows import."""
        try:
            from kfx.helpers import list_flows
        except (ImportError, ModuleNotFoundError) as e:
            pytest.fail(f"Failed to dynamically import kfx.helpers.list_flows: {e}")

        # Helper module should be the kfx implementation
        assert is_helper_module(list_flows, _KFX_HELPER_MODULE_FLOW)

    def test_helpers_import_load_flow(self):
        """Test the kfx.helpers.load_flow import."""
        try:
            from kfx.helpers import load_flow
        except (ImportError, ModuleNotFoundError) as e:
            pytest.fail(f"Failed to dynamically import kfx.helpers.load_flow: {e}")

        # Helper module should be the kfx implementation
        assert is_helper_module(load_flow, _KFX_HELPER_MODULE_FLOW)

    def test_helpers_import_run_flow(self):
        """Test the kfx.helpers.run_flow import."""
        try:
            from kfx.helpers import run_flow
        except (ImportError, ModuleNotFoundError) as e:
            pytest.fail(f"Failed to dynamically import kfx.helpers.run_flow: {e}")

        # Helper module should be the kfx implementation
        assert is_helper_module(run_flow, _KFX_HELPER_MODULE_FLOW)
