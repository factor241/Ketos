from __future__ import annotations

import os

from ketos.services.cache import utils


def test_cache_cleanup_uses_the_canonical_cache_root(tmp_path, monkeypatch):
    monkeypatch.setattr(utils, "CACHE_DIR", str(tmp_path))
    cache_root = tmp_path / utils.PREFIX
    cache_root.mkdir()
    for index in range(4):
        path = cache_root / f"{index}.dill"
        path.write_bytes(b"cache")
        os.utime(path, (index, index))

    utils.clear_old_cache_files(max_cache_size=2)

    assert {path.name for path in cache_root.glob("*.dill")} == {"2.dill", "3.dill"}
