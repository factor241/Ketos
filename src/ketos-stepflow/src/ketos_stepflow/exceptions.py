"""Custom exception types for Ketos integration."""


class KetosIntegrationError(Exception):
    """Base exception for Ketos integration errors."""

    pass


class ConversionError(KetosIntegrationError):
    """Error during Ketos to Stepflow conversion."""

    pass


class ValidationError(KetosIntegrationError):
    """Error during workflow validation."""

    pass


class ExecutionError(KetosIntegrationError):
    """Error during component execution."""

    pass
