# Ketos Public Project Page Design

## Purpose

Prepare the public `factor241/Ketos` repository for open-source program review
with an accurate, professional project page. The page must explain the product,
the infinite Canvas, and the implemented MCP control surface without hiding the
project's active-alpha status or claiming unsupported capabilities.

This revision removes the existing hero screenshot, makes MCP a first-class
product capability, corrects source-install instructions for `kfx-mcp`, and
states the copyright boundary between Langflow-derived material and original
Ketos-specific modifications.

## Audience

The primary readers are:

- open-source program reviewers evaluating the project's purpose and maturity;
- developers and automation builders evaluating Ketos for local use;
- potential contributors looking for a clear technical entry point;
- technical teams in Kazakhstan and other CIS countries that benefit from the
  currently shipped English and Russian interface catalogs.

The public repository must not include the maintainer's citizenship, residency,
government identifiers, or other application-only personal information.

## Editorial position

Ketos is an active-alpha, local-first visual builder and runtime for extensible
AI workflows. The README uses a product-first narrative:

1. define the product, audience, and current maturity;
2. explain the problem and the infinite Canvas;
3. present programmatic control through MCP as a major implemented capability;
4. summarize verified capabilities and concrete workflows;
5. provide a source-based quick start and concise architecture;
6. distinguish implemented, in-development, planned, and unavailable work;
7. state regional, security, deployment, and localization limits;
8. provide contribution, security, license, and attribution routes.

The README will not contain a hero screenshot or replacement product image.
The product description must stand on its written structure and verified facts.

## Verified product facts

The public page may state that the current repository includes:

- project-scoped Boards with persisted viewport and placement data;
- note, chat, automation, and job-result placements;
- movement, resizing, collapsing, maximizing, and closing of Board items;
- Board note creation, editing, and deletion;
- Board chat and automation creation with idempotency protection;
- automation editing, local execution, and result placement;
- revision-aware Board updates and conflict handling;
- starter choices including a clean Board, Simple Agent, Vector Store RAG, and
  the starter gallery;
- a React and TypeScript frontend using React Flow, TanStack Query, Zustand,
  and i18next;
- a Python and FastAPI backend with versioned APIs and persistence services;
- KFX as the component and lightweight execution SDK;
- extension bundles and a versioned Bundle API;
- English and Russian interface catalogs.

Claims about a hosted service, production rollout, production-grade real-time
collaboration, complete offline operation, regulatory compliance, or additional
shipped languages are not supported.

## Infinite Canvas

The Canvas is a pannable and zoomable spatial workspace within a project Board.
Its viewport and item layout are stored by the backend and can be restored
after navigation or restart. “Infinite Canvas” names the interaction model; it
does not promise unlimited scale, fully offline operation, or real-time
multiplayer editing.

## Programmatic control through MCP

Ketos includes an implemented stdio MCP server under
`src/kfx/src/kfx/mcp/`. An MCP-compatible client can use typed tools to work
with a running Ketos instance through its REST API.

The documented tool surface covers:

- authentication;
- creating, listing, inspecting, renaming, duplicating, exporting, and deleting
  flows;
- creating or updating a complete flow from a compact specification;
- listing and instantiating starter projects;
- discovering, adding, configuring, freezing, and removing components;
- connecting and disconnecting components;
- building, validating, and running flows;
- retrieving build results and component output;
- applying graph layout, batching operations, and notifying the UI when a
  modification sequence is complete.

The README will distinguish visual Canvas editing from MCP workflow control.
The current MCP surface operates on flows, components, connections, and
execution; it is not described as universal control over every Ketos screen or
every Board interaction.

`kfx-mcp` runs over stdio, requires a running Ketos instance, and can use
`KETOS_API_KEY` or the `login` tool. It must be run from an initialized Ketos
source checkout. The unrelated `kfx` package currently published on PyPI must
not be presented as Ketos KFX.

## Licensing and attribution

Ketos is distributed under the MIT License. The root `LICENSE` preserves the
upstream notice:

```text
Copyright (c) 2024 Langflow
```

For GitHub/Licensee compatibility, the root `LICENSE` records the
Ketos-specific copyright as a canonical copyright line:

```text
Copyright (c) 2026 Daria Shemelina (Ketos-specific portions)
```

The exact user-approved notice `Portions Copyright (c) 2026 Daria Shemelina`
remains in `README.md` and `NOTICE`. The MIT grant and disclaimer remain
unchanged. `README.md` and `NOTICE` must make the same boundaries clear:

- Langflow-derived portions retain their original copyright and MIT notice;
- original Ketos-specific contributions authored by Daria Shemelina are
  copyrighted by Daria Shemelina and released under MIT;
- contributions authored by other people remain theirs unless separately
  assigned;
- Ketos is independent and is not affiliated with or endorsed by Langflow.

The same `LICENSE` and `NOTICE` content must be packaged by each Ketos
MIT-licensed wheel and sdist. The separate Stepflow Apache legal files remain
unchanged.

Because the README names the upstream project for legal attribution, the brand
contract may allow only those reviewed lines. Each exception is bound to the
normalized path, exact line number, exact full-line text, and SHA-256. The
README is not treated as a whole-file legal artifact, and unrelated upstream
branding remains a violation.

The documentation must not imply ownership of unchanged Langflow code or of
third-party contributions.

## README structure

The root README will use this order:

1. header, active-alpha status, and navigation;
2. `What Ketos is`;
3. `Why it exists`;
4. `The infinite Canvas`;
5. `Programmatic control through MCP`;
6. `Core capabilities`;
7. `Example workflows`;
8. `Quick start`;
9. `How Ketos fits together`;
10. `Development status`;
11. `Known limitations`;
12. `Roadmap`;
13. `Regional and language focus`;
14. `Documentation`;
15. `Contributing and security`;
16. `License and attribution`.

MCP must also appear in the capabilities list, architecture table, example
workflows, development-status table, known limitations, and documentation
links without duplicating the full tool reference.

## Source-based MCP setup

The detailed KFX MCP guide will instruct readers to:

```bash
git clone https://github.com/factor241/Ketos.git
cd Ketos
make init
```

From the repository root, the local server command is:

```bash
uv run kfx-mcp
```

For an MCP client that can be started from another directory, the documented
configuration will use:

```text
uv run --project /absolute/path/to/Ketos kfx-mcp
```

Examples must use placeholder API keys and must not print or embed real
credentials.

## Verification

Before publication:

1. review every product and MCP claim against current source;
2. confirm the screenshot reference and asset are absent;
3. confirm `README.md`, `LICENSE`, and `NOTICE` use consistent attribution;
4. confirm no changed MCP instruction recommends `pip install kfx`,
   `uv pip install kfx`, or `uvx --from kfx`;
5. run `git diff --check`;
6. run the documentation link contract and documentation build;
   the contract may permit the upstream name only inside the root README's
   legal-attribution section while continuing to reject it from product copy;
7. run focused KFX MCP unit tests because the public guide describes their
   current behavior;
8. review the complete diff with a no-tools subagent packet;
9. publish through a pull request to `factor241/Ketos`;
10. inspect the merged public README, LICENSE, NOTICE, and MCP guide on GitHub.

## Acceptance criteria

The work is complete when:

- the screenshot, caption, and repository asset are removed;
- MCP has a prominent, factually bounded README section;
- every named MCP capability maps to an implemented tool;
- MCP limitations and source-based setup are explicit;
- the PyPI package-name collision cannot mislead the documented install path;
- the approved Daria Shemelina notice is present in the root `LICENSE`;
- README, LICENSE, and NOTICE agree on upstream and Ketos-specific rights;
- the documentation contract protects the legal-attribution exception without
  allowing upstream product branding elsewhere in the README;
- all public prose remains professional English;
- verification passes or an exact external blocker is reported;
- the change is merged into public `main` and renders correctly without
  authentication.
