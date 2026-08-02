from __future__ import annotations


class CommandProposalError(RuntimeError):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class CommandProposalConflictError(CommandProposalError):
    pass


class CommandProposalCorrelationError(CommandProposalError):
    pass


class CommandProposalAuthorizationError(CommandProposalError):
    pass


class CommandProposalNotFoundError(CommandProposalError):
    pass
