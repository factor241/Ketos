from uuid import UUID


class BoardResourceNotFoundError(Exception):
    code = "board_resource_not_found"

    def __init__(self, resource_id: UUID):
        super().__init__(f"Board resource {resource_id} was not found")
        self.resource_id = resource_id


class TargetKindNotAvailableError(Exception):
    code = "target_kind_not_available"

    def __init__(self, target_kind: object):
        super().__init__(f"Placement target kind {target_kind!s} is not available")
        self.target_kind = target_kind


class TargetProjectMismatchError(Exception):
    code = "target_project_mismatch"

    def __init__(self, target_id: UUID):
        super().__init__(f"Placement target {target_id} belongs to another project")
        self.target_id = target_id


class PlacementAlreadyExistsError(Exception):
    code = "placement_already_exists"

    def __init__(self, target_id: UUID):
        super().__init__(f"Placement for target {target_id} already exists on this board")
        self.target_id = target_id


class StaleRevisionError(Exception):
    code = "stale_revision"

    def __init__(self, resource_id: UUID):
        super().__init__(f"Resource {resource_id} revision is stale")
        self.resource_id = resource_id


class UnsafeMarkdownError(ValueError):
    code = "unsafe_markdown"

    def __init__(self, reason: str = "unsafe source"):
        super().__init__(f"Board note Markdown is unsafe: {reason}")
        self.reason = reason
