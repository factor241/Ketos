from fastapi_pagination import Page

from ketos.helpers.base_model import BaseModel
from ketos.services.database.models.flow.model import FlowRead
from ketos.services.database.models.folder.model import FolderRead


class FolderWithPaginatedFlows(BaseModel):
    folder: FolderRead
    flows: Page[FlowRead]
