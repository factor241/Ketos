# Ketos Project History

## Origin and attribution

Ketos is an independent, unofficial derivative of
[Langflow](https://github.com/langflow-ai/langflow). The retained Git history
includes upstream Langflow development beginning in 2023 so that authorship,
dates, commit messages, and technical provenance remain inspectable.

The upstream code is distributed under the MIT License. `LICENSE` preserves the
applicable upstream license text, and `NOTICE` records the relationship between
Langflow and Ketos. Ketos is not affiliated with, endorsed by, or sponsored by
Langflow or its copyright holders.

## Repository migrations

Development continued across local checkouts and more than one GitHub
repository while the Ketos name, architecture, and release boundaries were
being established. Those repository moves did not reset the underlying project
history. The canonical public home is now:

<https://github.com/factor241/Ketos>

For this public migration, the current committed Ketos branch was copied into
an isolated repository and its reachable history was safety-filtered. Database,
SQLite, log, cache, browser-capture, and test-result artifacts were removed,
credential-shaped historical values were redacted, and oversized blobs were
excluded. That process preserves commit authors, dates, and messages but changes
commit SHA identifiers.

## Ketos-specific work

Ketos-specific work builds on the upstream foundation and includes:

- the Ketos product identity and local-first operating defaults;
- the `kfx` component and executor SDK;
- extension bundle discovery and compatibility contracts;
- the FastAPI and React application integration maintained in this repository;
- workflow, interface, localization, packaging, and release work recorded in
  the later Git history.

The boundary is intentionally conservative: existing upstream authorship is not
reassigned, and a Ketos copyright claim applies only to original Ketos-specific
modifications. Persisted component class names, KFX and bundle API contracts,
and canonical schema identifiers are compatibility-sensitive and are not
renamed merely for repository migration.
