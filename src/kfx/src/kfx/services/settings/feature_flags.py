from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, SettingsConfigDict
from typing_extensions import override

from kfx.services.settings.brand_env import BrandEnvSettingsSource


class FeatureFlags(BaseSettings):
    wxo_deployments: bool = False
    """
    Enable Watsonx Orchestrate deployments.
    """
    mvp_components: bool = False

    model_config = SettingsConfigDict(extra="ignore")

    @classmethod
    @override
    def settings_customise_sources(  # type: ignore[misc]
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return (init_settings, BrandEnvSettingsSource(settings_cls, suffix_prefix="FEATURE_"))


FEATURE_FLAGS = FeatureFlags()
