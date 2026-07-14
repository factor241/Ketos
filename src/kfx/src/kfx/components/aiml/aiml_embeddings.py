from kfx.base.embeddings.aiml_embeddings import AIMLEmbeddingsImpl
from kfx.base.embeddings.model import LCEmbeddingsModel
from kfx.field_typing import Embeddings
from kfx.inputs.inputs import DropdownInput
from kfx.io import SecretStrInput


class AIMLEmbeddingsComponent(LCEmbeddingsModel):
    display_name = "AI/ML API Embeddings"
    description = "Generate embeddings using the AI/ML API."
    icon = "AIML"
    name = "AIMLEmbeddings"

    inputs = [
        DropdownInput(
            name="model_name",
            display_name="Model Name",
            options=[
                "text-embedding-3-small",
                "text-embedding-3-large",
                "text-embedding-ada-002",
            ],
            required=True,
        ),
        SecretStrInput(
            name="aiml_api_key",
            display_name="AI/ML API Key",
            value="AIML_API_KEY",
            required=True,
        ),
    ]

    def build_embeddings(self) -> Embeddings:
        return AIMLEmbeddingsImpl(
            api_key=self.aiml_api_key,
            model=self.model_name,
        )
