# Contributing to Ketos

Thank you for helping improve Ketos. The project is an active alpha, so focused
bug fixes, tests, documentation, accessibility improvements, and well-scoped
feature proposals are especially useful.

## Before you start

- Search [existing issues](https://github.com/factor241/Ketos/issues) before
  opening a new report.
- Use a public issue for reproducible bugs and feature proposals.
- Do not place credentials, personal data, private logs, or suspected
  vulnerability details in an issue. Follow [SECURITY.md](./SECURITY.md) for
  confidential security reporting.
- Keep changes focused. Large architectural changes should begin with an issue
  that explains the problem, constraints, and proposed boundary.

## Contribution workflow

1. Fork [`factor241/Ketos`](https://github.com/factor241/Ketos).
2. Create a branch from the current `main`.
3. Make one focused change and add or update relevant tests and documentation.
4. Run the smallest relevant checks first, followed by the package-level gate
   described in [DEVELOPMENT.md](./DEVELOPMENT.md).
5. Open a pull request against `factor241/Ketos:main`.

Use a clear pull-request title that follows
[Conventional Commits](https://www.conventionalcommits.org/), for example:

```text
fix(frontend): preserve Board note draft after conflict
docs: clarify KFX extension validation
```

In the pull-request description:

- explain the user or contributor problem;
- summarize the chosen solution;
- list the commands you ran and their results;
- identify known limitations or follow-up work;
- link the related issue with `Fixes #123` when the change closes it.

## Development setup

The supported source bootstrap is:

```bash
make init
```

For the full setup, current development profile, focused test commands, and
documentation checks, see [DEVELOPMENT.md](./DEVELOPMENT.md).

Python commands in this repository run through `uv`. Do not commit generated
artifacts, local databases, credentials, cache directories, or runtime logs.

## Project contracts

Before changing a public interface, review:

- [DESIGN.md](./DESIGN.md) for application and naming boundaries;
- [BUNDLE_API.md](./BUNDLE_API.md) for the extension contract;
- [NOTICE](./NOTICE) for upstream attribution;
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) for community expectations.

Persisted component class names are stable identifiers and must not be renamed
after use in saved workflows. Changes to KFX or Bundle API contracts require
focused compatibility review.

## Documentation contributions

Ketos documentation is built with Docusaurus. Setup and verification commands
are listed in [DEVELOPMENT.md](./DEVELOPMENT.md).

Additional guides:

- [Documentation contributor guide](./docs/docs/development/contributing.mdx)
- [KFX executor and component guide](./src/kfx/README.md)
- [Bundle API v1 contract](./BUNDLE_API.md)

## Review expectations

Maintainers may request smaller scope, additional evidence, compatibility
changes, or documentation corrections before merging. A submitted pull request
is not a promise of inclusion, but clear rationale and reproducible verification
make review substantially easier.
