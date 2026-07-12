# kfx-arxiv

arXiv search component as a standalone Ketos Extension Bundle.

This is the second-pilot port that validates
[`src/bundles/PORTING.md`](../PORTING.md) — the documented recipe for
extracting an in-tree provider into a standalone Bundle distribution.
The bundle ships a single component, `ArXivComponent`, which queries
arXiv's public Atom API for paper metadata.

## Install

```bash
pip install kfx-arxiv
```

The bundle is registered automatically via the `ketos.extensions`
entry-point.  After install, restart your Ketos server; the
`ArXivComponent` will appear in the palette under the `arxiv` bundle
group.

## Develop

```bash
cd src/bundles/arxiv
pip install -e .
kfx extension validate .
```

## Manifest

The extension manifest is shipped at
`src/kfx_arxiv/extension.json` and points at the bundle at
`components/arxiv`.  Components register under the canonical
namespaced ID `ext:arxiv:ArXivComponent@official`.

## Migration

Saved flows referencing the legacy class name `ArXivComponent` or the
old import paths `kfx.components.arxiv.arxiv.ArXivComponent` /
`kfx.components.arxiv.ArXivComponent` are rewritten to the new
namespaced ID by the migration table in
`src/kfx/src/kfx/extension/migration/migration_table.json`.
