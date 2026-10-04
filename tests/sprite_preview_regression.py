#!/usr/bin/env python3
"""Check preview pairs using tiny temporary sheets; shipped art is untouched."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile

from PIL import Image

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]


def load_tool(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "tools" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fixture(folder, cell):
    folder.mkdir(parents=True)
    image = Image.new("RGBA", (cell * 2, cell))
    for facing in range(2):
        for y in range(2, cell - 2):
            for x in range(2, cell - 2):
                image.putpixel((x + facing * cell, y), (255, 100, 20, 255))
    image.save(folder / "original.png")
    path = folder / "actor.json"
    path.write_text(json.dumps({
        "sheet": "original.png", "frameWidth": cell, "frameHeight": cell,
        "framesPerFacing": 1, "rowMarginFraction": .25,
        "columnMarginFraction": .25, "rows": [{"name": "idle", "index": 0}],
    }))
    return path


def check_pair(path, expected_sheet):
    meta = json.loads(path.read_text())
    assert meta["sheet"] == expected_sheet, (path, meta["sheet"])
    with Image.open(path.parent / meta["sheet"]) as image:
        image.load()
        assert image.size == (meta["frameWidth"] * 2, meta["frameHeight"])
        assert image.getbbox(), "preview contains extracted artwork"


def main():
    realign = load_tool("realign_sprites")
    refit = load_tool("refit_sprites")
    with tempfile.TemporaryDirectory(prefix="t2gu-preview-") as temporary:
        root = Path(temporary)
        original = fixture(root / "realign", 8)
        original_json = original.read_bytes()
        original_png = (original.parent / "original.png").read_bytes()
        realign.process_character(original, True, "_realigned")
        check_pair(original.with_name("actor_realigned.json"), "actor_realigned.png")
        assert original.read_bytes() == original_json
        assert (original.parent / "original.png").read_bytes() == original_png
        realign.process_character(original, False, "")
        check_pair(original, "original.png")

        refit.SOURCE_DIR = root / "source"
        refit.TARGET_DIR = root / "target"
        source = fixture(refit.SOURCE_DIR / "actor", 8)
        destination = fixture(refit.TARGET_DIR / "actor", 16)
        source_bytes = (source.read_bytes(), (source.parent / "original.png").read_bytes())
        target_bytes = (destination.read_bytes(), (destination.parent / "original.png").read_bytes())
        refit.process_character("actor", .25, .25, True, "_refitted")
        check_pair(destination.with_name("actor_refitted.json"), "actor_refitted.png")
        assert (destination.read_bytes(), (destination.parent / "original.png").read_bytes()) == target_bytes
        refit.process_character("actor", .25, .25, False, "")
        check_pair(destination, "original.png")
        assert (source.read_bytes(), (source.parent / "original.png").read_bytes()) == source_bytes
    print("Sprite preview regressions passed (preview and overwrite paths for both tools)")


if __name__ == "__main__":
    main()
