---
description: "Ketos language pack for the web GUI: the complete Russian UI corpus (44 namespaces), the ru default when the deployment's browser asks for Russian, and the community pack attribution and sync procedure."
kind: "package-reference"
---

# @ketos/client-locale-ru

English | [中文](README.zh.md)

## Summary

Ketos ships Russian as the default interface language without renaming the locale machinery or overriding an explicit user choice. The client plugin registers the `ru` language (fallback `en`) and translates the complete Ketos UI corpus — the MIT-licensed community [`deepseek-harness-locale-ru`](https://github.com/warment/deepseek-harness-locale-ru) pack, rebranded and extended with the keys the Ketos corpus adds, plus `common` and `board`. When no preference is stored and the browser asks for a `ru`-tagged language, it switches the active locale to `ru` once. Browsers naming the shipped `zh`/`en` chains or an unregistered language keep the ordinary fallback; a stored selection is never overwritten.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

**Runtime invariant:** No companion is published. The pack registers through the locale service (`addLanguage`, dictionary registration) and one settings-scope watcher; disposal removes the language and the dictionaries, observed through the locale catalog.

The web profile of the `ketos` CLI loads the package through the client bundle roster, and nothing needs configuration; the activation order keeps the plugin behind the `locale` row, so the service and its scope are present when the pack runs. Built-in permission preset labels localize through the owning client package's dictionaries (`displayPermissionPreset`), so the base machine-id table stays and each locale renders its own names — `Запись в рабочей папке` here. Read the Russian copy through any registered feature the usual way: feature namespaces resolve through the shared lookup, `common` carries `brand.localBuild` as `Кетос`, and the `board` namespace carries the canvas, dock, omnibox, and window copy in Russian. The plugin mirrors the locale namespace and preference field constants locally (type-only import of the locale package) so the client bundle stays pure.

The dictionaries are generated artifacts: `scripts/sync-dictionaries.mjs` merges the community pack, the fork corpus, and `scripts/dictionary-overrides.json` (rebranding overrides plus the translations authored for keys the community pack does not cover) into `src/locales/{common-ru,pack-ru}.ts`, and writes the key manifest `tests/fixtures/ru-keys.json` the package spec checks coverage against. The ported community content remains under its MIT license; the upstream copyright is preserved in `LICENSE-locale-ru`.

-----

<a id="model-experience"></a>
## Model Experience

None, as the locale pack is client UI only: it registers no tool, prompt section, or session event, and its copy never enters a model request.

#### KV Cache effect

No effect; the one settings entry the `ru` default writes at boot (`locale: { preference: ru }` when no preference is stored) is host-side durable state, and the Russian copy shown by the UI comes from the registered dictionaries.

## Known Limitations and Deferred Work

- The corpus reflects the fork's client keys at generation time; keys added by later upstream changes fall back to English until the pack is re-synced with the community extractor and `scripts/sync-dictionaries.mjs`.
- The `ru` default writes `locale: { preference: ru }` through the ordinary set path when the browser asks Russian and the stored document initially lacks a preference; a fresh home therefore records the choice after the first run, and an `en`-named browser keeps English.

### Dev Note

To refresh the corpus, run the community pack's `scripts/extract.mjs` from this repository root (it imports the client locale modules through `tsx` and writes `corpus.json`), then regenerate the dictionaries:

```sh
node --import tsx/esm <locale-ru>/scripts/extract.mjs --root "$PWD" --out /tmp/ketos-corpus
node packages/ketos/client-locale-ru/scripts/sync-dictionaries.mjs --corpus /tmp/ketos-corpus/corpus.json --community <locale-ru>/dict/ru
```
