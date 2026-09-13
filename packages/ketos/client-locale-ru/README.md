---
description: "Ketos language pack for the web GUI: the Russian locale, its shared and settings dictionaries, and the ru default when the deployment's browser asks for Russian."
kind: "package-reference"
---

# @ketos/client-locale-ru

English | [中文](README.zh.md)

## Summary

Ketos ships Russian as the default interface language without renaming the locale machinery or overriding an explicit user choice. The client plugin registers the `ru` language (fallback `en`), translates the `common` and `settings.locale` namespaces, and switches the active locale to `ru` when the durable `locale` settings section has no `preference` and the browser itself asks for a `ru`-tagged language (the same ordered `navigator.languages` match `dsh-client-locale` applies). Browsers naming the shipped `zh`/`en` chains or an unregistered language keep the ordinary fallback; a stored selection (for example `en`) is adopted by the locale service's own scope subscription and never overwritten.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

**Runtime invariant:** No companion is published. The pack registers through the locale service (`addLanguage`, dictionary registration) and one settings-scope watcher; disposal removes the language and the dictionaries, observed through the locale catalog.

The web profile of the `ketos` CLI loads the package through the client bundle roster, and nothing needs configuration; the activation order keeps the plugin behind the `locale` row, so the service and its scope are present when the pack runs. Read the Russian copy through any registered feature the usual way: feature namespaces resolve through the shared lookup, and `common` now carries every translated key, including `brand.localBuild` as `Локальная сборка Кетос`. The plugin mirrors the locale namespace and preference field constants locally (type-only import of the locale package) so the client bundle stays pure.

-----

<a id="model-experience"></a>
## Model Experience

None, as the locale pack is client UI only: it registers no tool, prompt section, or session event, and its copy never enters a model request.

#### KV Cache effect

No effect; the one settings entry the `ru` default writes at boot (`locale: { preference: ru }` when no preference is stored) is host-side durable state, and the Russian copy shown by existing UI comes through the `common` dictionary while feature-local dictionaries still fall back to `en`.

## Known Limitations and Deferred Work

- Dictionaries cover `common` and `settings.locale` only; namespace-local dictionaries of the other client features resolve through the `ru → en` fallback chain, so those surfaces keep English copy until their owning packages open per-feature `ru` dictionaries.
- The `ru` default writes `locale: { preference: ru }` through the ordinary set path when the browser asks Russian and the stored document initially lacks a preference; a fresh home therefore records the choice after the first run, and an `en`-named browser keeps English.

### Dev Note

None.
