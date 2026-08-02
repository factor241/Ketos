# Ketos release policy

Releases are fail-closed. This document records the local preparation contract;
it does not authorize publishing.

1. Select the intended semantic version.
2. Run backend, frontend, KFX, bundle, docs, and packaging verification.
3. Confirm generated artifacts match their local sources.
4. Confirm `LICENSE` and `NOTICE` are unchanged unless legal review approved a
   specific update.
5. Inspect package names, CLI entry points, extension metadata, environment
   variables, API headers, archives, and container labels for Ketos-only identity.
6. Produce checksums and a signed release manifest.
7. Publish only through a separately reviewed workflow with explicit immutable
   credentials and destination allowlists.

Current distributions are `ketos`, `ketos-base`, `kfx`, and the official
`kfx-*` extension bundles. External registries, image names, signing identities,
and support channels are intentionally not asserted here.
