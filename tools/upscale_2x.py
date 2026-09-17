#!/usr/bin/env python3
"""Bakes a 2x visual scale into world-rendered assets, physically, so the
QGraphicsView's own transform can stay at a genuine identity (1.0) forever -
see this session's `perf record` findings: any non-identity view transform,
even a "clean" integer one, costs Qt's software rasterizer roughly a third
of total CPU time, and only a true identity transform avoids it entirely.

Two different techniques, chosen per real measurement, not assumption:

- Character sheets (assets/characters/*/*.json, already realigned by
  realign_sprites.py) and tile sheets (assets/tilesets/*.json): the source
  art's native pixel resolution exactly matches its current display size
  (confirmed - a tileset PNG is exactly tileWidth*columns x tileHeight*rows,
  no headroom), so these are physically upscaled 2x with a high-quality
  filter (Lanczos - painted/AI-generated art, not retro pixel art, so a
  smooth resample preserves linework/gradients far better than nearest-
  neighbor doubling would). frameWidth/frameHeight or tileWidth/tileHeight
  in the JSON sidecar double to match.

- Props (assets/props/props.json + assets/props/*.png): checked first
  rather than assumed - every one of the 135 prop PNGs already has at
  least 2x (most have 5-14x) more native resolution than its current
  catalog `width`, since props are placed at deliberately-reduced display
  sizes relative to their generated art. Doubling the *catalog* width and
  leaving the PNG untouched lands well within existing headroom, so it's
  simpler and lower-risk than re-encoding 135 files that don't need it -
  Prop's own constructor already does a one-time (cached, not a per-frame
  cost) QPixmap::scaled() to whatever width the catalog asks for.

Usage:
    python3 tools/upscale_2x.py [--dry-run]
"""
import argparse
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CHARACTERS_DIR = ROOT / "assets" / "characters"
TILESETS_DIR = ROOT / "assets" / "tilesets"
PROPS_JSON = ROOT / "assets" / "props" / "props.json"


def upscale_character_sheets(dry_run: bool):
    print("=== character sheets ===")
    for folder in sorted(CHARACTERS_DIR.iterdir()):
        if not folder.is_dir():
            continue
        json_path = folder / f"{folder.name}.json"
        if not json_path.exists():
            continue
        with open(json_path) as f:
            meta = json.load(f)
        if "frameWidth" not in meta:
            print(f"  skip (no frameWidth): {folder.name}")
            continue

        sheet_path = folder / meta["sheet"]
        img = Image.open(sheet_path).convert("RGBA")
        new_size = (img.width * 2, img.height * 2)
        upscaled = img.resize(new_size, Image.LANCZOS)

        new_meta = dict(meta)
        new_meta["frameWidth"] = meta["frameWidth"] * 2
        new_meta["frameHeight"] = meta["frameHeight"] * 2

        print(f"  {folder.name}: {img.size} -> {new_size}, "
              f"frame {meta['frameWidth']}x{meta['frameHeight']} -> "
              f"{new_meta['frameWidth']}x{new_meta['frameHeight']}")
        if not dry_run:
            upscaled.save(sheet_path)
            with open(json_path, "w") as f:
                json.dump(new_meta, f, indent=4)


def upscale_tilesets(dry_run: bool):
    print("=== tilesets ===")
    for json_path in sorted(TILESETS_DIR.glob("*.json")):
        with open(json_path) as f:
            meta = json.load(f)
        sheet_path = TILESETS_DIR / meta["sheet"]
        img = Image.open(sheet_path).convert("RGBA")
        new_size = (img.width * 2, img.height * 2)
        upscaled = img.resize(new_size, Image.LANCZOS)

        new_meta = dict(meta)
        new_meta["tileWidth"] = meta["tileWidth"] * 2
        new_meta["tileHeight"] = meta["tileHeight"] * 2

        print(f"  {json_path.stem}: {img.size} -> {new_size}, "
              f"tile {meta['tileWidth']}x{meta['tileHeight']} -> "
              f"{new_meta['tileWidth']}x{new_meta['tileHeight']}")
        if not dry_run:
            upscaled.save(sheet_path)
            with open(json_path, "w") as f:
                json.dump(new_meta, f, indent=4)


def double_prop_widths(dry_run: bool):
    print("=== props (catalog width only, no PNG changes - see header) ===")
    with open(PROPS_JSON) as f:
        catalog = json.load(f)
    props = catalog.get("props", catalog)
    for name, entry in props.items():
        old_width = entry["width"]
        entry["width"] = old_width * 2
    print(f"  doubled width for {len(props)} props")
    if not dry_run:
        with open(PROPS_JSON, "w") as f:
            json.dump(catalog, f, indent=4)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="print what would change, write nothing")
    args = parser.parse_args()

    upscale_character_sheets(args.dry_run)
    upscale_tilesets(args.dry_run)
    double_prop_widths(args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
