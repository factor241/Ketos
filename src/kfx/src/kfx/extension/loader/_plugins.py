"""Installed-distribution discovery primitives for canonical Extensions."""

from __future__ import annotations

import re
from importlib import metadata as importlib_metadata
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Iterable


# ---------------------------------------------------------------------------
# Distribution-name normalization (PEP 503)
# ---------------------------------------------------------------------------

_PEP503_NORMALIZE_RE = re.compile(r"[-_.]+")


def canonicalize_distribution(name: str) -> str:
    """Canonicalize a distribution name per PEP 503 (lowercase + collapse [-_.])."""
    return _PEP503_NORMALIZE_RE.sub("-", name).lower()


# ---------------------------------------------------------------------------
# Distribution introspection
# ---------------------------------------------------------------------------


def _distribution_manifest_path(dist: importlib_metadata.Distribution) -> Path | None:
    """Return the manifest path shipped by ``dist`` (extension.json or pyproject.toml), or None.

    extension.json wins on collision; pyproject.toml is accepted only when
    it declares ``[tool.ketos.extension]``.

    Editable installs (``pip install -e``, ``uv pip install --editable``)
    typically expose only dist-info files via ``dist.files`` -- the source
    tree lives outside the site-packages and is reached at import time via
    a ``.pth`` shim.  When the dist-info pass finds no manifest, fall back
    to ``direct_url.json`` (PEP 610) to locate the editable project root
    and look for ``extension.json`` / ``pyproject.toml`` there.  Without
    this fallback, ``kfx-duckduckgo`` and friends installed via ``uv sync``
    workspace links never reach :func:`load_installed_extensions`.
    """
    files = dist.files
    pyproject_candidate: Path | None = None
    if files is not None:
        for relative in files:
            if not relative.parts:
                continue
            last = relative.parts[-1]
            if last == "extension.json":
                try:
                    located = Path(dist.locate_file(relative))
                except (OSError, ValueError):
                    # ``locate_file`` may raise on unusual setups (e.g. namespace
                    # packages without a concrete root); treat as "not found"
                    # without breaking the rest of the scan.
                    continue
                if located.is_file():
                    # extension.json wins outright -- skip any pyproject seen later.
                    return located
            elif last == "pyproject.toml" and pyproject_candidate is None:
                try:
                    located = Path(dist.locate_file(relative))
                except (OSError, ValueError):
                    continue
                if located.is_file():
                    pyproject_candidate = located

    if pyproject_candidate is not None and _pyproject_has_extension_section(pyproject_candidate):
        return pyproject_candidate

    # Fallback: editable install.  PEP 610 ``direct_url.json`` records the
    # source URL; for editable installs the URL is a ``file://`` path to the
    # project root, which is where the manifest lives.
    return _editable_manifest_path(dist)


def _editable_manifest_path(dist: importlib_metadata.Distribution) -> Path | None:
    """Resolve the manifest of an editable install whose ``dist.files`` is dist-info-only.

    Tries two fallbacks in order:

    1. The ``ketos.extensions`` entry-point group.  When a bundle
       declares ``[project.entry-points."ketos.extensions"] foo = "kfx_foo"``
       the entry-point's value is the dotted package path that ships
       ``extension.json``; importing that package gives us the source
       directory regardless of how the dist was installed.

    2. PEP 610 ``direct_url.json`` for ``editable=true`` distributions.
       The recorded URL points at the project root; we look for
       ``extension.json`` (or a ``[tool.ketos.extension]`` pyproject)
       directly there.

    Returns ``None`` if neither path yields a manifest.  Both paths are
    necessary because (a) installed wheels list the package's
    ``extension.json`` in ``dist.files`` so they don't reach this fallback,
    and (b) editable installs that use ``ketos.extensions`` entry-points
    point at the package, while editable installs that don't may still
    have a top-level manifest.
    """
    manifest = _manifest_via_entry_point(dist)
    if manifest is not None:
        return manifest
    return _manifest_via_direct_url(dist)


def _manifest_via_entry_point(dist: importlib_metadata.Distribution) -> Path | None:
    """Find a manifest via this distribution's ``ketos.extensions`` entry-point.

    Locates the package directory via ``importlib.util.find_spec`` rather
    than importing the package, so a manifest-discovery pass at startup
    does not trigger arbitrary side-effects from a bundle's ``__init__``.
    """
    import importlib.util

    try:
        eps = dist.entry_points
    except (OSError, AttributeError, TypeError):
        return None
    if eps is None:
        return None

    candidate_modules: list[str] = []
    for ep in eps:
        if getattr(ep, "group", None) == "ketos.extensions":
            value = (getattr(ep, "value", "") or "").split(":", 1)[0].strip()
            if value:
                candidate_modules.append(value)

    for module_name in candidate_modules:
        try:
            spec = importlib.util.find_spec(module_name)
        except (ImportError, ValueError, ModuleNotFoundError):
            continue
        if spec is None or spec.origin is None:
            continue
        package_dir = Path(spec.origin).parent
        manifest = package_dir / "extension.json"
        if manifest.is_file():
            return manifest
    return None


def _manifest_via_direct_url(dist: importlib_metadata.Distribution) -> Path | None:
    """Resolve the manifest from PEP 610 ``direct_url.json`` for editable installs."""
    import json
    from urllib.parse import urlparse

    try:
        raw = dist.read_text("direct_url.json")
    except (OSError, FileNotFoundError, AttributeError):
        # ``AttributeError`` covers test doubles that don't implement the
        # full ``Distribution`` interface; ``OSError`` covers the production
        # case where the file is missing or unreadable.
        return None
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None
    dir_info = payload.get("dir_info") or {}
    if not isinstance(dir_info, dict) or not dir_info.get("editable"):
        return None

    url = payload.get("url")
    if not isinstance(url, str):
        return None
    parsed = urlparse(url)
    if parsed.scheme != "file":
        return None
    project_root = Path(parsed.path)
    if not project_root.is_dir():
        return None

    manifest = project_root / "extension.json"
    if manifest.is_file():
        return manifest

    pyproject = project_root / "pyproject.toml"
    if pyproject.is_file() and _pyproject_has_extension_section(pyproject):
        return pyproject
    return None


def _pyproject_has_extension_section(pyproject_path: Path) -> bool:
    """Return True iff ``pyproject_path`` declares ``[tool.ketos.extension]``.

    Detects section *presence* only -- intentionally does NOT run schema
    validation. A pyproject whose ``[tool.ketos.extension]`` section
    exists but has missing/invalid required fields still returns True so
    the caller registers it as a manifest-shipping distribution; the
    typed ``manifest-invalid`` error is then surfaced by
    :func:`load_extension`'s normal failure path. Conflating "section
    absent" with "section malformed" would silently drop pyproject-form
    Extensions whose authors typo'd a field.

    Behavior matrix:
        - Section absent or pyproject TOML unparseable -> False (treat as
          a regular non-manifest package).
        - Section present and is a table (valid or schema-invalid) -> True.
        - Section present but is not a table (e.g. list) -> True; the
          author clearly intended to declare an extension and the
          downstream loader should report it.
    """
    # Imported here rather than at module level to avoid a potential cycle:
    # manifest.py -> errors.py -> extension/__init__.py -> loader/__init__.py
    # would otherwise route back through this module during package init.
    from kfx.extension.manifest import _read_pyproject_extension

    try:
        section = _read_pyproject_extension(pyproject_path)
    except ValueError:
        # Unparseable TOML: not specifically a ketos extension issue,
        # let the rest of the system treat it as a regular package.
        return False
    except TypeError:
        # [tool.ketos.extension] exists but isn't a table. The author
        # intended to declare an extension; let load_extension produce
        # the typed manifest-invalid error rather than silently drop.
        return True
    except OSError:
        return False
    return section is not None


def _distribution_canonical_name(dist: importlib_metadata.Distribution) -> str | None:
    """Return the PEP-503-canonical name of a distribution, or ``None``.

    Defensive: a non-string ``Name`` (e.g. a MagicMock in tests, or an
    unusual metadata backend) returns ``None`` so the canonical-name
    machinery doesn't crash an entry-point partition pass.
    """
    try:
        raw = dist.metadata["Name"]
    except (KeyError, AttributeError, TypeError):
        return None
    if not isinstance(raw, str) or not raw:
        return None
    return canonicalize_distribution(raw)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def installed_extension_roots(
    distributions: Iterable[importlib_metadata.Distribution] | None = None,
) -> dict[str, Path]:
    """Map canonical distribution name -> extension root for installed manifests.

    Args:
        distributions: Override the distribution iterator (test seam).
            Defaults to ``importlib.metadata.distributions()``.

    Returns:
        Dict keyed by canonical distribution name; the value is the
        directory containing the manifest. When two distributions share a
        canonical name (broken venv), the lexicographically-first manifest
        path wins for determinism; :func:`load_installed_extensions` emits
        the typed ``duplicate-distribution`` error in that case.
    """
    return {name: root for name, (root, _) in _resolve_distribution_roots(distributions).items()}


def _resolve_distribution_roots(
    distributions: Iterable[importlib_metadata.Distribution] | None,
) -> dict[str, tuple[Path, list[Path]]]:
    """Inner helper: resolve roots and collect duplicate manifest paths.

    Returns a dict keyed by canonical name, value is
    ``(winning_root, list_of_all_manifest_paths)``.  When the list has more
    than one entry, the canonical name was claimed by multiple distributions
    and the caller may surface ``duplicate-distribution`` warnings.
    """
    if distributions is None:
        distributions = importlib_metadata.distributions()

    intermediate: dict[str, list[Path]] = {}
    for dist in distributions:
        manifest_path = _distribution_manifest_path(dist)
        if manifest_path is None:
            continue
        canonical = _distribution_canonical_name(dist)
        if canonical is None:
            continue
        intermediate.setdefault(canonical, []).append(manifest_path)

    resolved: dict[str, tuple[Path, list[Path]]] = {}
    for canonical, manifests in intermediate.items():
        sorted_manifests = sorted(manifests, key=str)
        winner = sorted_manifests[0].parent
        resolved[canonical] = (winner, sorted_manifests)
    return resolved


def manifest_owning_distributions(
    distributions: Iterable[importlib_metadata.Distribution] | None = None,
) -> frozenset[str]:
    """Return the canonical distribution names that ship an extension manifest.

    Two distributions sharing a canonical name (broken venv) collapse to a
    single entry in the returned set; the typed ``duplicate-distribution``
    error is emitted by :func:`load_installed_extensions`, not this
    primitive. Callers should also call ``load_installed_extensions`` to
    surface duplicate-distribution diagnostics to operators.
    """
    return frozenset(installed_extension_roots(distributions=distributions).keys())
