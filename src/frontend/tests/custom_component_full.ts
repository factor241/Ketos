export const custom = `from ketos.custom import CustomComponent

from ketos.field_typing import BaseLanguageModel
from langchain.chains import LLMChain
from langchain.prompts import PromptTemplate
from langchain_core.documents import Document
from ketos.field_typing import NestedDict

import requests

class YourComponent(Component):
    display_name: str = "Custom Component"
    description: str = "Create any custom component you want!"

    def build_config(self):
        return { "file": { "file_type": ["json"], } }

    def build(self, url: str,file:str,integer:int,nested:NestedDict,flt:float,boolean:bool,lisst:list[str],dictionary:dict, llm: BaseLanguageModel, prompt: PromptTemplate) -> Document:

        return "test"`;
