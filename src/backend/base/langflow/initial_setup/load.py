from collections.abc import Callable
from dataclasses import dataclass

from lfx.graph import Graph
from lfx.graph.graph.schema import GraphDump

from .starter_projects import (
    basic_prompting_graph,
    blog_writer_graph,
    document_qa_graph,
    memory_chatbot_graph,
    vector_store_rag_graph,
)


class StarterProjectDump(GraphDump):
    name_i18n_key: str
    description_i18n_key: str


@dataclass(frozen=True, slots=True)
class StarterProjectSpec:
    factory: Callable[[], Graph]
    slug: str
    name: str
    description: str

    @property
    def name_i18n_key(self) -> str:
        return f"starter_flows.{self.slug}.name"

    @property
    def description_i18n_key(self) -> str:
        return f"starter_flows.{self.slug}.description"


STARTER_PROJECT_SPECS = (
    StarterProjectSpec(
        factory=basic_prompting_graph,
        slug="basic_prompting",
        name="Basic Prompting",
        description="Perform basic prompting with an OpenAI model.",
    ),
    StarterProjectSpec(
        factory=blog_writer_graph,
        slug="blog_writer",
        name="Blog Writer",
        description="Auto-generate a customized blog post from instructions and referenced articles.",
    ),
    StarterProjectSpec(
        factory=document_qa_graph,
        slug="document_q_a",
        name="Document Q&A",
        description=(
            "Integrates PDF reading with a language model to answer document-specific questions. "
            "Ideal for small-scale texts, it facilitates direct queries with immediate insights."
        ),
    ),
    StarterProjectSpec(
        factory=memory_chatbot_graph,
        slug="memory_chatbot",
        name="Memory Chatbot",
        description=(
            "Create a chatbot that saves and references previous messages, enabling the model to maintain context "
            "throughout the conversation."
        ),
    ),
    StarterProjectSpec(
        factory=vector_store_rag_graph,
        slug="vector_store_rag",
        name="Vector Store RAG",
        description="Load your data for chat context with Retrieval Augmented Generation.",
    ),
)


def get_starter_projects_graphs() -> list[Graph]:
    return [spec.factory() for spec in STARTER_PROJECT_SPECS]


def get_starter_projects_dump() -> list[StarterProjectDump]:
    dumps: list[StarterProjectDump] = []
    for spec in STARTER_PROJECT_SPECS:
        dump: StarterProjectDump = {
            **spec.factory().dump(name=spec.name, description=spec.description),
            "name_i18n_key": spec.name_i18n_key,
            "description_i18n_key": spec.description_i18n_key,
        }
        dumps.append(dump)
    return dumps
