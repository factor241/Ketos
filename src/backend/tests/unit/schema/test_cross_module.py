"""Unit tests for cross-module isinstance functionality.

These tests verify that isinstance checks work correctly when classes are
re-exported from different modules (e.g., kfx.schema.Message vs ketos.schema.Message).
"""

from ketos.schema import Data as KetosData
from ketos.schema import Message as KetosMessage
from kfx.schema.data import Data as LfxData
from kfx.schema.message import Message as LfxMessage


class TestDuckTypingData:
    """Tests for duck-typing Data class across module boundaries."""

    def test_kfx_data_isinstance_ketos_data(self):
        """Test that kfx.Data instance is recognized as ketos.Data."""
        kfx_data = LfxData(data={"key": "value"})
        assert isinstance(kfx_data, KetosData)

    def test_ketos_data_isinstance_kfx_data(self):
        """Test that ketos.Data instance is recognized as kfx.Data."""
        ketos_data = KetosData(data={"key": "value"})
        assert isinstance(ketos_data, LfxData)

    def test_data_equality_across_modules(self):
        """Test that Data objects from different modules are equal."""
        kfx_data = LfxData(data={"key": "value"})
        ketos_data = KetosData(data={"key": "value"})
        assert kfx_data == ketos_data

    def test_data_interchangeable_in_functions(self):
        """Test that Data from different modules work interchangeably."""

        def process_data(data: KetosData) -> str:
            return data.get_text()

        kfx_data = LfxData(data={"text": "hello"})
        # Should not raise type error
        result = process_data(kfx_data)
        assert result == "hello"

    def test_data_model_dump_compatible(self):
        """Test that model_dump works across module boundaries."""
        kfx_data = LfxData(data={"key": "value"})
        ketos_data = KetosData(**kfx_data.model_dump())
        assert ketos_data.data == {"key": "value"}


class TestDuckTypingMessage:
    """Tests for duck-typing Message class across module boundaries."""

    def test_kfx_message_isinstance_ketos_message(self):
        """Test that kfx.Message instance is recognized as ketos.Message."""
        kfx_message = LfxMessage(text="hello")
        assert isinstance(kfx_message, KetosMessage)

    def test_ketos_message_isinstance_kfx_message(self):
        """Test that ketos.Message instance is recognized as kfx.Message."""
        ketos_message = KetosMessage(text="hello")
        assert isinstance(ketos_message, LfxMessage)

    def test_message_equality_across_modules(self):
        """Test that Message objects from different modules are equal."""
        kfx_message = LfxMessage(text="hello", sender="user")
        ketos_message = KetosMessage(text="hello", sender="user")
        # Note: Direct equality might not work due to timestamps
        assert kfx_message.text == ketos_message.text
        assert kfx_message.sender == ketos_message.sender

    def test_message_interchangeable_in_functions(self):
        """Test that Message from different modules work interchangeably."""

        def process_message(msg: KetosMessage) -> str:
            return f"Processed: {msg.text}"

        kfx_message = LfxMessage(text="hello")
        # Should not raise type error
        result = process_message(kfx_message)
        assert result == "Processed: hello"

    def test_message_model_dump_compatible(self):
        """Test that model_dump works across module boundaries."""
        kfx_message = LfxMessage(text="hello", sender="user")
        dump = kfx_message.model_dump()
        ketos_message = KetosMessage(**dump)
        assert ketos_message.text == "hello"
        assert ketos_message.sender == "user"

    def test_message_inherits_data_duck_typing(self):
        """Test that Message inherits duck-typing from Data."""
        kfx_message = LfxMessage(text="hello")
        # Should work as Data too
        assert isinstance(kfx_message, KetosData)
        assert isinstance(kfx_message, LfxData)


class TestDuckTypingWithInputs:
    """Tests for duck-typing with input validation."""

    def test_message_input_accepts_kfx_message(self):
        """Test that MessageInput accepts kfx.Message."""
        from kfx.inputs.inputs import MessageInput

        kfx_message = LfxMessage(text="hello")
        msg_input = MessageInput(name="test", value=kfx_message)
        assert isinstance(msg_input.value, (LfxMessage, KetosMessage))

    def test_message_input_converts_cross_module(self):
        """Test that MessageInput handles cross-module Messages."""
        from kfx.inputs.inputs import MessageInput

        ketos_message = KetosMessage(text="hello")
        msg_input = MessageInput(name="test", value=ketos_message)
        # Should recognize it as a Message
        assert msg_input.value.text == "hello"

    def test_data_input_accepts_kfx_data(self):
        """Test that DataInput accepts kfx.Data."""
        from kfx.inputs.inputs import DataInput

        kfx_data = LfxData(data={"key": "value"})
        data_input = DataInput(name="test", value=kfx_data)
        assert data_input.value == kfx_data


class TestDuckTypingEdgeCases:
    """Tests for edge cases in cross-module isinstance checks."""

    def test_different_class_name_not_cross_module(self):
        """Test that objects with different class names are not recognized as cross-module compatible."""
        from kfx.schema.cross_module import CrossModuleModel

        class CustomModel(CrossModuleModel):
            value: str

        custom = CustomModel(value="test")
        # Should not be considered a Data
        assert not isinstance(custom, LfxData)
        assert not isinstance(custom, KetosData)

    def test_non_pydantic_model_not_cross_module(self):
        """Test that non-Pydantic objects are not recognized as cross-module compatible."""

        class FakeData:
            def __init__(self):
                self.data = {}

        fake = FakeData()
        assert not isinstance(fake, LfxData)
        assert not isinstance(fake, KetosData)

    def test_missing_fields_not_cross_module(self):
        """Test that objects missing required fields are not recognized as cross-module compatible."""
        from kfx.schema.cross_module import CrossModuleModel

        class PartialData(CrossModuleModel):
            text_key: str

        partial = PartialData(text_key="text")
        # Should not be considered a full Data (missing data field)
        assert not isinstance(partial, LfxData)
        assert not isinstance(partial, KetosData)


class TestDuckTypingInputMixin:
    """Tests for cross-module isinstance checks in BaseInputMixin and subclasses."""

    def test_base_input_mixin_is_cross_module(self):
        """Test that BaseInputMixin uses CrossModuleModel."""
        from kfx.inputs.input_mixin import BaseInputMixin
        from kfx.schema.cross_module import CrossModuleModel

        # Check that BaseInputMixin inherits from CrossModuleModel
        assert issubclass(BaseInputMixin, CrossModuleModel)

    def test_input_subclasses_inherit_cross_module(self):
        """Test that all input types inherit cross-module support."""
        from kfx.inputs.inputs import (
            BoolInput,
            DataInput,
            FloatInput,
            IntInput,
            MessageInput,
            StrInput,
        )
        from kfx.schema.cross_module import CrossModuleModel

        for input_class in [StrInput, IntInput, FloatInput, BoolInput, DataInput, MessageInput]:
            assert issubclass(input_class, CrossModuleModel)

    def test_input_instances_work_across_modules(self):
        """Test that input instances work with duck-typing."""
        from kfx.inputs.inputs import MessageInput

        # Create with kfx Message
        kfx_msg = LfxMessage(text="hello")
        input1 = MessageInput(name="test1", value=kfx_msg)

        # Create with ketos Message
        ketos_msg = KetosMessage(text="world")
        input2 = MessageInput(name="test2", value=ketos_msg)

        # Both should work
        assert input1.value.text == "hello"
        assert input2.value.text == "world"
