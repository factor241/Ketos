"""Allowlisted Flow Builder toolkit for the durable command path."""

from dataclasses import dataclass

from kfx.mcp.flow_builder_tools import DescribeComponentType, SearchComponentTypes


@dataclass(frozen=True)
class _ProposalToolDescriptor:
    name: str = "ProposeFlowChanges"


ProposeFlowChanges = _ProposalToolDescriptor()
FLOW_PROPOSAL_TOOLKIT = (SearchComponentTypes, DescribeComponentType, ProposeFlowChanges)

__all__ = ["FLOW_PROPOSAL_TOOLKIT", "ProposeFlowChanges"]
