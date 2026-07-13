"""Update the canonical ``kfx`` package (and its SDK dep) for nightly builds.

The nightly publishes ``kfx`` and ``ketos-sdk`` under their CANONICAL names as ``.devN``
pre-releases -- it does NOT rename them to ``kfx-nightly`` / ``ketos-sdk-nightly``, and it does
NOT give the ``src/bundles/*`` packages their own nightly track. The stable ``kfx-*`` bundles
(pinning ``kfx>=X.Y.0,<(X+1).0.0``) then resolve against the single canonical ``kfx`` distribution,
so there is no ``kfx`` vs ``kfx-nightly`` install collision. See ``src/bundles/NIGHTLY.md``.

This script therefore only (a) sets ``kfx``'s version to the nightly ``.devN`` and (b) re-pins
kfx's ``ketos-sdk`` dependency to the exact canonical dev version.
"""

import re
import sys
from pathlib import Path

from update_pyproject_version import update_pyproject_version

# Add the current directory to the path so we can import the other scripts
current_dir = Path(__file__).resolve().parent
sys.path.append(str(current_dir))

BASE_DIR = Path(__file__).parent.parent.parent


def update_sdk_dependency_in_kfx(pyproject_path: str, sdk_version: str) -> None:
    """Pin kfx's ``ketos-sdk`` dependency to the exact canonical dev version.

    An exact ``==<dev>`` pin keeps the SDK in lockstep with the kfx built in the same run and,
    because it names a pre-release explicitly, enables pre-release resolution for ``ketos-sdk``
    down the dependency tree without requiring ``--pre``.
    """
    filepath = BASE_DIR / pyproject_path
    content = filepath.read_text(encoding="utf-8")

    pattern = re.compile(r'"ketos-sdk(?:-nightly)?(?:==|~=|>=)[\d.]+(?:\.(?:post|dev|a|b|rc)\d+)*"')
    replacement = f'"ketos-sdk=={sdk_version}"'

    if not pattern.search(content):
        msg = f"SDK dependency not found in {filepath}"
        raise ValueError(msg)

    content = pattern.sub(replacement, content)
    filepath.write_text(content, encoding="utf-8")


def update_kfx_for_nightly(kfx_tag: str, sdk_tag: str):
    """Update the canonical ``kfx`` package for a nightly build.

    Args:
        kfx_tag: The nightly tag for KFX (e.g., "v1.11.0.dev0").
        sdk_tag: The nightly tag for the SDK (e.g., "v0.1.0.dev0").
    """
    kfx_pyproject_path = "src/kfx/pyproject.toml"

    # Set the version (strip 'v' prefix if present); the package keeps its canonical `kfx` name.
    version = kfx_tag.lstrip("v")
    update_pyproject_version(kfx_pyproject_path, version)

    # Re-pin kfx's SDK dependency to the exact canonical dev version.
    sdk_version = sdk_tag.lstrip("v")
    update_sdk_dependency_in_kfx(kfx_pyproject_path, sdk_version)

    print(f"Updated kfx to nightly version {version}")


def main():
    """Update KFX for nightly builds.

    Usage:
    update_kfx_version.py <kfx_tag> <sdk_tag>
    """
    expected_args = 3
    if len(sys.argv) != expected_args:
        print("Usage: update_kfx_version.py <kfx_tag> <sdk_tag>")
        sys.exit(1)

    kfx_tag = sys.argv[1]
    sdk_tag = sys.argv[2]
    update_kfx_for_nightly(kfx_tag, sdk_tag)


if __name__ == "__main__":
    main()
