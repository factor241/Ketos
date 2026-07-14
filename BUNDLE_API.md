# Ketos Bundle API

This file defines the public v1 contract consumed by Ketos Extension bundles.
Names, signatures, wire shapes, and semantics listed here are stable. A change
to this surface requires a coordinated `BUNDLE_API_VERSION` decision and a new
entry under [Changelog](#changelog).

The canonical implementation lives under `kfx.extension`; the Ketos HTTP
surface lives under `ketos.api.v1.extensions`. Legacy package names and saved
flow compatibility bridges are not part of this contract.

## Version and canonical schema

| Contract item | Exact value or source |
| --- | --- |
| Bundle API version | `BUNDLE_API_VERSION = 1` in `kfx.extension.manifest` |
| Manifest schema version | `SCHEMA_VERSION = 1` in `kfx.extension.manifest` |
| Canonical `$schema` value | `https://schemas.ketos.test/extension/v1.json` |
| JSON Schema builders | `kfx.extension.schema.build_schema()` and `build_schema_json(*, indent=2)` |
| Manifest source precedence | `extension.json`, then `[tool.ketos.extension]` in `pyproject.toml` |

An optional `$schema` field must equal the canonical URL exactly. A manifest
declares Bundle API compatibility as `kfx.compat: ["1"]`; the loader rejects a
manifest that does not include `str(BUNDLE_API_VERSION)` with the typed code
`version-constraint-unsatisfied`.

The canonical minimal JSON manifest is:

```json
{
  "$schema": "https://schemas.ketos.test/extension/v1.json",
  "id": "my-extension",
  "version": "0.1.0",
  "name": "My Extension",
  "kfx": { "compat": ["1"] },
  "bundles": [
    { "name": "my_bundle", "path": "components" }
  ]
}
```

## Manifest model

The runtime model is `kfx.extension.manifest.ExtensionManifest`. Unknown
fields are rejected.

| Field | Required | v1 contract |
| --- | --- | --- |
| `$schema` | no | If present, the exact canonical v1 URL above |
| `id` | yes | Lowercase hyphenated identifier, 2-64 characters |
| `version` | yes | SemVer 2.0.0 string |
| `name` | yes | Non-empty display name, at most 200 characters |
| `description` | no | At most 2,000 characters |
| `kfx` | yes | `KfxCompat` with a non-empty, unique list of positive-integer strings |
| `bundles` | yes | Exactly one `BundleRef` in v1 |
| `capabilities` | no | `Capabilities`; only `requiresCredentials: bool`, default `false` |
| `locale_bundle` | no | `LocaleBundle` owned by this manifest's `id` |
| `ru_missing_policy` | no | `"mark"` (default) or `"fail"` |

`services`, `routes`, `hooks`, `starterProjects`, and `userConfig` are reserved
for later versions. They are rejected when set and are exposed by the
published JSON Schema through `x-deferred-fields`, not as accepted properties.

### BundleRef

`kfx.extension.manifest.BundleRef` has these exact fields:

| Field | Required | v1 contract |
| --- | --- | --- |
| `name` | yes | Lowercase snake_case identifier, 2-64 characters |
| `path` | yes | Non-empty relative path contained by the extension root |
| `display_name` | no | Non-empty UI label, at most 120 characters |
| `icon` | no | Non-empty Lucide icon name, at most 64 characters |

The validator and every discovery/load path enforce resolved path containment;
absolute paths, `..`, and symlink escapes are rejected.

### Localization

`LocaleBundle` contains `namespace` and non-empty `locales`. The namespace must
equal the containing extension `id`. Every catalog key starts with
`components.` and every translated value is non-blank. If
`ru_missing_policy="fail"`, a `ru` catalog is required; `"mark"` accepts the
manifest and exposes `ru_missing=True` on loaded components.

## Component authoring surface

Bundle modules subclass `kfx.custom.Component` and declare the component
metadata, `inputs`, and `outputs` consumed by the palette and graph runtime.
Class names are persisted identifiers and must not be renamed after release.

The supported authoring imports are:

| Surface | Canonical import |
| --- | --- |
| Component base | `kfx.custom.Component` |
| Input and output declarations | `kfx.io` |
| `Data` | `kfx.schema.data.Data` |
| `DataFrame` | `kfx.schema.dataframe.DataFrame` |
| `Message` | `kfx.schema.message.Message` |

A loaded component is addressed only by the canonical ID
`ext:<bundle>:<Class>@<slot>`. The slots are `official` for installed or seed
extensions and `extra` for loose `KETOS_COMPONENTS_PATH` bundles.

## Public Python API

### Manifest, schema, validation, and authoring

The `kfx.extension` facade lazily re-exports this public surface:

- Manifest: `ExtensionManifest`, `BundleRef`, `KfxCompat`, `ManifestSource`,
  `BUNDLE_API_VERSION`, `SCHEMA_VERSION`, `EXTENSION_SCHEMA_URL`, and
  `load_manifest(root)`.
- Validation: `ValidateReport` and
  `validate_extension(root, *, execute_imports=False)`.
- Scaffolding: `InitOptions`, `BASIC_TEMPLATE`, and `init_extension(options)`.
- Typed errors: `ExtensionError`, `ExtensionErrorCollection`, `ERROR_CODES`,
  and `format_extension_error(error)`.

`ExtensionError.to_dict()` is the stable error envelope with `code`, `message`,
`location`, `content`, `hint`, and `ref_url`. `ERROR_CODES` is the set of typed
discriminants: adding a code is compatible; removing or renaming one requires a
Bundle API version decision.

### Discovery and loading

The current discovery/loader API is:

- `discover_installed_extensions()`, `discover_seed_extensions()`, and
  `discover_all_extensions()` from `kfx.extension.discovery`.
- `load_extension(root, *, slot="official", distribution=None,
  module_namespace="_kfx_ext")`.
- `discover_inline_bundles(paths)` for `KETOS_COMPONENTS_PATH` roots.
- `load_installed_extensions()` and `load_seed_extensions()`.
- `LoadedComponent`, `LoadResult`, `SLOT_OFFICIAL`, and `SLOT_EXTRA`.

`LoadedComponent` is frozen and exposes `namespaced_id`. `LoadResult.ok` is
true exactly when `errors` is empty; partial results may contain both loaded
components and typed errors.

Installed extension entry points use the group `ketos.extensions`. Installed
distributions and seed directories occupy `official`; dev registrations and
loose component paths do not overwrite that slot silently.

### Extension registry

The `kfx.extension` facade exports `ExtensionRegistry`, `Extension`,
`LoadStatus`, `DuplicateExtensionError`, `ExtensionImmutableError`, and
`build_registry_from_discovery(...)`.

The live component registry is `kfx.extension.bundle_registry.BundleRegistry`.
Its stable records and operations are:

- `BundleRecord` (frozen snapshot), `snapshot()`, `get_bundle(name)`, and
  `list_components()`.
- `install_bundle(record)`, `remove_bundle(name)`, and `write_locked()`.
- `begin_reload(name)`, `finish_reload(name)`, and
  `reload_in_progress(name)`.
- `get_default_registry()` for the process registry.

### Reload runtime

`kfx.extension.reload.reload_bundle(registry, bundle, *, source_path=None,
slot=None, user_id=None)` returns a frozen `ReloadResult` and raises
`ReloadInProgressError` only for a concurrent reload of the same bundle.

`ReloadResult.to_dict()` has this exact wire shape:

```json
{
  "ok": true,
  "bundle": "my_bundle",
  "reload_id": "opaque-id",
  "components_added": [],
  "components_removed": [],
  "components_changed": [],
  "errors": [],
  "warnings": []
}
```

Reload is an atomic source/module/registry swap. A failed reload leaves the
previous `BundleRecord` live. Events are emitted as `bundle_reloaded` or
`bundle_reload_failed`, scoped to `user:<id>` when a user ID is supplied and
to `global` otherwise.

### Dev registry

`kfx.extension.dev_registry` exposes `DevExtensionEntry`,
`register_dev_extension(path)`, `unregister_dev_extension(path)`,
`list_dev_extensions()`, `load_dev_extensions()`,
`dev_extension_component_paths()`, and `state_file_path()`.

## HTTP API

The router is mounted under `/api/v1/extensions`.

### Reload one bundle

`POST /api/v1/extensions/{extension_id}/bundles/{bundle_name}/reload`

- Requires the authenticated active user and
  `KETOS_ENABLE_EXTENSION_RELOAD=true`.
- Returns `200` with the `ReloadResult.to_dict()` shape on success.
- Returns `404` when reload is disabled or the URL identifies the wrong or an
  unavailable bundle.
- Returns `409` with typed code `reload-in-progress` for a concurrent reload.
- Returns `422` for a structural reload failure; the typed primary error and
  full result are preserved under the FastAPI error detail.

### Poll extension events

`GET /api/v1/extensions/events?since=<utc-epoch-seconds>`

The authenticated user determines the server-side event keyspace. A client
`keyspace` query parameter is rejected with `422`. The response is:

```json
{
  "events": [
    { "type": "bundle_reloaded", "timestamp": 0.0, "payload": {} }
  ],
  "settled": true
}
```

## CLI

The supported commands are:

- `kfx extension validate <path> [--execute-imports]`
- `kfx extension schema [--output <path>]`
- `kfx extension init <path>`
- `kfx extension dev <path>`
- `kfx extension list`
- `kfx extension reload <extension-id> [--bundle <name>]`
- `kfx extension reload --all`

## Out of scope for v1

- More than one bundle per extension.
- Bundle-provided services, routes, lifecycle hooks, starter projects, or
  user-configuration UI.
- Executing untrusted bundle code in a sandbox. Installed bundle code is
  operator-trusted and imports in the Ketos process.
- Compatibility aliases for legacy package namespaces, manifest keys,
  component IDs, or saved-flow rewriting.

## Changelog

### v1 destructive cutover

- Replaced the historical compatibility document with the canonical Ketos
  v1 contract: `kfx` Python namespaces, `ketos` manifest metadata and HTTP
  routes, the exact v1 schema URL, current loader/registry/reload APIs, and
  canonical `ext:<bundle>:<Class>@<slot>` component IDs.
- Contract documentation now matches the destructive runtime: legacy package
  aliases and saved-flow rewrite facilities are absent.
