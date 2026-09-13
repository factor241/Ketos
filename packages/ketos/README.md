---
description: "The Ketos soft-fork package group: the packages the Ketos fork adds on top of the upstream harness, kept local and never published to npm."
kind: "package-group"
---

# ketos/ — Ketos soft-fork packages

English | [中文](README.zh.md)

## Summary

The ketos group owns the packages the Ketos fork adds on top of the upstream DeepSeek Harness. These packages wire Ketos-specific behavior — branding, defaults, the Russian locale — into the same capability seams the harness loads at boot. Publishing is forbidden: every package declares `private: true`, so the release gate treats the group as a local-only consumer of upstream packages.

## Table of Contents

- [Packages](#packages)
- [Conventions](#conventions)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`@ketos/client-locale-ru`](client-locale-ru/README.md) | Russian locale pack for the web GUI: registers `ru`, translates the shared, settings, and board vocabularies, and applies `ru` while the user has no stored locale preference |

-----

<a id="conventions"></a>
## Conventions

- Package name: `@ketos/<name>`, one package per `packages/ketos/<name>/` directory.
- Every package manifest carries `private: true`; publishing to npm is forbidden and the workspace constraint gate rejects anything that prepares it.
- Tests live in the package's own `tests/` directory.
- A package README follows the repository package rules: `Summary`, plus `Model Experience` and `Known Limitations` when the package changes model-visible behavior or leaves a gap.

-----

<a id="related-documentation"></a>
## Related documentation

- The staged rebranding plan (external planning folder, not in-repo) owns this group and its constraints.

<a id="dev-note"></a>
## Dev Note

None.
