---
name: main-agent-tool-orchestration
description: Use at the beginning of every Codex session and before selecting any tool, plugin, installed skill, or subagent for work in this repository.
---

# Main-Agent Tool Orchestration

## Non-negotiable role gate

Only the main agent may call tools. Subagents must not call any tool, invoke
skills, inspect or edit files, run commands or tests, browse, research, review,
or plan. They use only context supplied in the main agent's prompt and return
only requested code or unified diff text. If required context is absent, return
`BLOCKED: missing context` without guessing.

This ban includes shell, search, filesystem and patch tools, Git, Graphify,
RaytSystem, web, MCP, connectors, plugin or app tools, browser or Computer Use,
skill-owned scripts, test runners, and any future tool category. The main agent
is the sole caller even when a tool is read-only.

## Session-start capability selection

The main agent performs this inventory at the beginning of every Codex session:

1. Read the task, repository instructions, dirty-state constraints, and current
   catalog of available tools, available plugins, and installed skills.
2. Match capabilities to the task and select the smallest sufficient set.
   Honor user-requested plugins or skills, prefer purpose-built capabilities,
   and never assume that a capability absent from the current catalog exists.
3. Read every selected skill fully before acting and announce why it applies.
   Do not install a missing plugin unless the user explicitly requested it.
4. Keep every selected tool and skill in the main-agent session. Never include
   a tool call, skill invocation, discovery command, or file lookup in a
   subagent assignment.

## Analyze, package, implement, verify

The main agent uses the selected capabilities to inspect the project and derive
the implementation logic. Before code delegation, it prepares a self-contained
packet with the goal, exact source slices, required interfaces, invariants,
scope boundaries, expected files, and acceptance checks.

The subagent implements from that packet without tools and returns code or a
unified diff as response text. It performs no independent discovery. The main
agent reviews the response, applies it with main-agent tools, runs focused then
package-level verification, fixes integration defects, and owns all evidence
and user-facing claims.

Non-code analysis, review, research, planning, tool selection, application,
testing, and final synthesis always remain with the main agent.
