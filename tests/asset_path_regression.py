"""Exercise cached asset resolution in fresh processes, without game assets/audio."""

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", type=Path, required=True)
    parser.add_argument("--install-path", type=Path, required=True)
    parser.add_argument("--bindir", type=Path, required=True)
    parser.add_argument("--datadir", type=Path, required=True)
    parser.add_argument("--source-assets", type=Path, required=True)
    args = parser.parse_args()
    clean_env = dict(os.environ)
    clean_env.pop("T2GU_ASSET_DIR", None)

    def check(probe, expected, override=None):
        env = dict(clean_env)
        if override is not None:
            env["T2GU_ASSET_DIR"] = str(override)
        subprocess.run([str(probe), str(expected)], env=env, check=True, timeout=10)

    with tempfile.TemporaryDirectory(prefix="t2gu asset paths ") as temporary:
        root = Path(temporary)
        override = root / "override assets"
        override.mkdir()
        check(args.probe, override, override)
        existing = (args.probe.parent / args.install_path).resolve()
        fallback = existing if existing.is_dir() else args.source_assets
        check(args.probe, fallback)
        check(args.probe, fallback, root / "missing override")

        if args.install_path.is_absolute():
            # Absolute paths are intentionally fixed. Relocating only the
            # executable must preserve that path (or source fallback).
            copy = root / "relocated probe"
            shutil.copy2(args.probe, copy)
            check(copy, fallback)
            check(copy, override, override)
        else:
            # Lay out the actual install directories independently of CMake's
            # derived runtime path, so an incorrect derivation also fails.
            prefix = root / "install prefix"
            bin_dir = (prefix / args.bindir).resolve()
            bin_dir.mkdir(parents=True)
            copy = bin_dir / args.probe.name
            shutil.copy2(args.probe, copy)
            data = (prefix / args.datadir / "t2gu2/assets").resolve()
            if data != prefix and prefix not in data.parents:
                raise AssertionError("Fixture escaped its install prefix")
            data.mkdir(parents=True)
            check(copy, data)
            check(copy, data, root / "missing override")
            check(copy, override, override)
            moved = root / "moved prefix"
            prefix.rename(moved)
            moved_copy = moved / copy.relative_to(prefix)
            moved_data = moved / data.relative_to(prefix)
            check(moved_copy, moved_data)
            moved_data.rename(moved_data.with_name("retired assets"))
            check(moved_copy, args.source_assets)
    print("Asset override, installed layout, relocation and source fallback passed")


if __name__ == "__main__":
    main()
