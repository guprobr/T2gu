#!/usr/bin/env python3
"""Bakes SpriteSheet::frame()'s runtime margin-crop + connected-component
blob-isolation (src/SpriteSheet.cpp) into new, properly-sized sprite sheets,
one per character folder under assets/characters/.

Ports the exact algorithm the C++ engine already uses at runtime (and
already visually trusts) so the output is pixel-identical to what the game
currently displays - just baked into the source art instead of recomputed
on first use. After this, the sheets no longer need any margin/crop-with-
extra-reach behavior: every frame's true content already sits cleanly
within its own (new, larger) grid cell.

Usage:
    python3 tools/realign_sprites.py [--only NAME] [--dry-run]

Writes new <name>.png / <name>.json in place (only after --dry-run has been
used to sanity-check a couple of characters - see the project plan).
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
CHARACTERS_DIR = ROOT / "assets" / "characters"


def isolate_frame_content(canvas: np.ndarray, nominal_rect) -> np.ndarray:
    """canvas: HxWx4 uint8 RGBA array. nominal_rect: (x, y, w, h).
    Mirrors isolateFrameContent() in src/SpriteSheet.cpp exactly: label
    4-connected opaque (alpha > 10) blobs, keep the one overlapping the
    nominal rect the most in full, drop every other blob that touches the
    canvas's outer edge (bleed from a neighboring cell)."""
    h, w = canvas.shape[0], canvas.shape[1]
    opaque = canvas[:, :, 3] > 10
    # 4-connectivity (cross structuring element), matching the C++ dx/dy
    # neighbor list (no diagonals).
    structure = ndimage.generate_binary_structure(2, 1)
    labels, num_labels = ndimage.label(opaque, structure=structure)
    if num_labels == 0:
        return canvas

    nx, ny, nw, nh = nominal_rect
    nominal_mask = np.zeros((h, w), dtype=bool)
    ny0, ny1 = max(0, ny), min(h, ny + nh)
    nx0, nx1 = max(0, nx), min(w, nx + nw)
    if ny1 > ny0 and nx1 > nx0:
        nominal_mask[ny0:ny1, nx0:nx1] = True

    overlap_counts = ndimage.sum(nominal_mask, labels, index=range(1, num_labels + 1))
    primary_label = int(np.argmax(overlap_counts)) + 1

    edge_mask = np.zeros((h, w), dtype=bool)
    edge_mask[0, :] = True
    edge_mask[h - 1, :] = True
    edge_mask[:, 0] = True
    edge_mask[:, w - 1] = True
    touches_edge = np.zeros(num_labels + 1, dtype=bool)
    edge_labels = np.unique(labels[edge_mask])
    touches_edge[edge_labels] = True
    touches_edge[0] = False

    out = canvas.copy()
    for lbl in range(1, num_labels + 1):
        if lbl != primary_label and touches_edge[lbl]:
            out[labels == lbl] = 0
    return out


def extract_frame(sheet: np.ndarray, frame_width, frame_height, row_margin_fraction,
                   column_margin_fraction, frame_padding_px, row_index, col):
    sheet_h, sheet_w = sheet.shape[0], sheet.shape[1]
    cell_height = round(frame_height)
    row_margin = round(cell_height * row_margin_fraction)
    col_margin = round(frame_width * column_margin_fraction)
    pad = max(0, min(frame_padding_px, (min(frame_width + 2 * col_margin, cell_height + 2 * row_margin) - 1) // 2))

    nominal_x = col * frame_width
    nominal_y = round(row_index * frame_height)

    wanted_x = nominal_x - col_margin + pad
    wanted_width = frame_width + 2 * col_margin - 2 * pad
    wanted_top = nominal_y - row_margin + pad
    wanted_height = cell_height + 2 * row_margin - 2 * pad

    read_left = max(0, wanted_x)
    read_right = min(sheet_w, wanted_x + wanted_width)
    read_width = max(0, read_right - read_left)
    paste_x = read_left - wanted_x

    read_top = max(0, wanted_top)
    read_bottom = min(sheet_h, wanted_top + wanted_height)
    read_height = max(0, read_bottom - read_top)
    paste_y = read_top - wanted_top

    canvas = np.zeros((max(0, wanted_height), max(0, wanted_width), 4), dtype=np.uint8)
    if read_width > 0 and read_height > 0:
        slice_ = sheet[read_top:read_bottom, read_left:read_right]
        canvas[paste_y:paste_y + read_height, paste_x:paste_x + read_width] = slice_

    nominal_rect_in_canvas = (col_margin, row_margin, frame_width - 2 * pad, cell_height - 2 * pad)
    cleaned = isolate_frame_content(canvas, nominal_rect_in_canvas)
    return cleaned, wanted_width, wanted_height


def process_character(json_path: Path, dry_run: bool, out_suffix: str):
    with open(json_path) as f:
        meta = json.load(f)

    if "rowMarginFraction" not in meta:
        print(f"  skip (no margin fields): {json_path.name}")
        return

    frame_width = meta["frameWidth"]
    frame_height = meta["frameHeight"]
    row_margin_fraction = meta.get("rowMarginFraction", 0.0)
    column_margin_fraction = meta.get("columnMarginFraction", 0.0)
    frame_padding_px = meta.get("framePaddingPx", 0)
    gutter_slots = meta.get("gutterSlots", 0)
    symmetric_frames = meta.get("framesPerFacing", 4)
    frames_front_default = meta.get("framesFront", symmetric_frames)
    frames_back_default = meta.get("framesBack", symmetric_frames)
    rows = meta["rows"]

    sheet_name = meta["sheet"]
    sheet_path = json_path.parent / sheet_name
    sheet_img = Image.open(sheet_path).convert("RGBA")
    sheet_arr = np.array(sheet_img)

    max_row_index = max(r["index"] for r in rows)
    total_cols = frames_front_default + gutter_slots + frames_back_default

    new_cell_w = None
    new_cell_h = None
    new_sheet_arr = None

    for row in rows:
        row_index = row["index"]
        frames_front = row.get("framesFront", -1)
        frames_back = row.get("framesBack", -1)
        front_count = frames_front if frames_front and frames_front > 0 else frames_front_default
        back_count = frames_back if frames_back and frames_back > 0 else frames_back_default

        for facing, count, facing_offset in (
            ("front", front_count, 0),
            ("back", back_count, frames_front_default + gutter_slots),
        ):
            for frame_index in range(count):
                col = facing_offset + (frame_index % count)
                cleaned, w, h = extract_frame(
                    sheet_arr, frame_width, frame_height, row_margin_fraction,
                    column_margin_fraction, frame_padding_px, row_index, col,
                )
                if new_cell_w is None:
                    new_cell_w, new_cell_h = w, h
                    new_sheet_arr = np.zeros(((max_row_index + 1) * new_cell_h, total_cols * new_cell_w, 4),
                                              dtype=np.uint8)
                elif (w, h) != (new_cell_w, new_cell_h):
                    raise RuntimeError(f"inconsistent cell size in {json_path}: {(w, h)} vs {(new_cell_w, new_cell_h)}")

                dst_y = row_index * new_cell_h
                dst_x = col * new_cell_w
                new_sheet_arr[dst_y:dst_y + new_cell_h, dst_x:dst_x + new_cell_w] = cleaned

    if new_sheet_arr is None:
        print(f"  skip (no frames found): {json_path.name}")
        return

    new_meta = dict(meta)
    new_meta["frameWidth"] = new_cell_w
    new_meta["frameHeight"] = new_cell_h
    new_meta["rowMarginFraction"] = 0.0
    new_meta["columnMarginFraction"] = 0.0
    new_meta["framePaddingPx"] = 0

    if dry_run:
        out_png = json_path.parent / (json_path.stem + out_suffix + ".png")
        out_json = json_path.parent / (json_path.stem + out_suffix + ".json")
    else:
        out_png = sheet_path
        out_json = json_path

    Image.fromarray(new_sheet_arr, "RGBA").save(out_png)
    with open(out_json, "w") as f:
        json.dump(new_meta, f, indent=4)
    print(f"  wrote {out_png.name} ({new_cell_w}x{new_cell_h} per cell, "
          f"{new_sheet_arr.shape[1]}x{new_sheet_arr.shape[0]} sheet)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", action="append", help="process only this character folder name (repeatable)")
    parser.add_argument("--dry-run", action="store_true", help="write alongside originals as <name>_realigned.png/json")
    args = parser.parse_args()

    out_suffix = "_realigned" if args.dry_run else ""
    folders = sorted(CHARACTERS_DIR.iterdir())
    for folder in folders:
        if not folder.is_dir():
            continue
        if args.only and folder.name not in args.only:
            continue
        json_path = folder / f"{folder.name}.json"
        if not json_path.exists():
            continue
        print(f"{folder.name}:")
        process_character(json_path, args.dry_run, out_suffix)


if __name__ == "__main__":
    sys.exit(main())
