# Docling Bundle

Docling components for Ketos packaged as a standalone Extension Bundle.

## Components

- Docling
- Docling Serve
- Export DoclingDocument
- Chunk DoclingDocument

## Install

The bundle is installed with Ketos in the 1.10 workspace. The base package includes `docling-core` for the `DoclingDocument` schema. For standalone local conversion:

```bash
uv pip install "kfx-docling[local]"
```

Chunking and picture-description support use separate optional extras. Chunking
does not install the full local converter/OCR stack:

```bash
uv pip install "kfx-docling[chunking]"
uv pip install "kfx-docling[image-description]"
```

## Develop

```bash
uv run kfx extension validate src/bundles/docling/src/kfx_docling
uv run pytest src/bundles/docling/tests
```
