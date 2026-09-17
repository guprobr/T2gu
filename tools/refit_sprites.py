#!/usr/bin/env python3
"""Re-extracts character frames from the original (pre-2x, pre-realignment)
sheets in assets_backup_pre_2x_scale/, using a much wider capture margin
than the original columnMarginFraction=0.047 ever used - measurement across
the roster showed real content (raised weapons, wide stances, wing spans)
routinely extends 25-100+ native px beyond the old margin, which is why
several characters still read as visibly cut off after realign_sprites.py
(that script correctly baked in whatever the OLD margins captured, but
those margins were themselves too small horizontally).

Rather than grow the on-screen frame size to fit the wider capture (which
would change every character's rendered size and cascade into another
round of Phase-3-style constant updates), this fits the wider capture DOWN
into the CURRENT frame size instead - one uniform (non-distorting) scale,
sized so neither dimension overflows the existing frameWidth/frameHeight.
In practice the extra horizontal margin means width is usually the binding
dimension, so characters end up a bit smaller within their frame than
before - exactly the "shrink so it fits without cutting off" tradeoff this
is meant to make.

The margin fraction (and therefore the scale factor) is computed ONCE,
globally, from the whole roster's own measured overflow - not per
character. An earlier per-character version let each character shrink by
however much *it* needed, which fixed clipping but broke the roster's
uniform 2x scale: two characters that are supposed to read as comparably
sized (e.g. the controlled character next to a similarly-built NPC) ended
up visibly different sizes depending on how much margin each happened to
need. A single shared margin keeps every character shrinking by the same
relative amount, at the cost of the least-demanding characters getting a
bit more empty margin than they personally needed.

The whole (fixed-size) intermediate canvas is bottom-anchored in the
target frame - not each frame's own content bounding box - so every frame
of a character lands at the same offset and animations don't jitter
vertically.

Note on measurement itself: the "wide net around each frame, then isolate
this frame's own blob" technique breaks down once the net gets wide enough
to fully enclose an *entire adjacent frame* (confirmed by inspection - at
that point the isolation heuristic, built for margins of a few percent,
can no longer tell "bleed from next door" from "next door's own frame").
That happens above roughly net=0.6x the frame's own size for this sheet
layout, which caps how much true overflow this script can ever measure
correctly - a handful of the most extreme individual frames across the
roster (a wide weapon-swing or a sprawled die-animation pose, say) may
still clip somewhat even after this fix, because accurately measuring
their true extent would require a fundamentally different (per-frame,
not per-cell) sizing approach.

Usage:
    python3 tools/refit_sprites.py [--only NAME] [--dry-run]

Writes new <name>.png / <name>.json in place under assets/characters/
(only after --dry-run has been used to sanity-check a couple of
characters). Source of truth for extraction is
assets_backup_pre_2x_scale/characters/ - untouched by this script.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = ROOT / "assets_backup_pre_2x_scale" / "characters"
TARGET_DIR = ROOT / "assets" / "characters"


def isolate_frame_content(canvas: np.ndarray, nominal_rect) -> np.ndarray:
    """Label 4-connected opaque blobs and keep only the one overlapping the
    nominal rect the most - drop every other blob unconditionally.

    Originally this only dropped a non-primary blob if it touched the
    canvas's outer edge (the assumption being that anything else must be
    part of this frame's own overflowing content - a raised weapon, a wide
    stance - which is always pixel-connected to the main body and thus
    already part of primary_label). That assumption breaks once the
    capture margin is wide enough (see NET_FRACTION/max_fraction in
    compute_global_margins - this roster's picked margin lands right at
    the 0.6 danger line the module docstring warns about): at that width
    an entire neighboring character routinely fits inside the margin band
    with room to spare on both sides, so it never touches the edge and
    survived untouched, getting baked into the output frame as a second,
    fully-formed character right alongside the real one (confirmed via a
    reported in-game duplicate-sprite bug that traced back to exactly
    this). Since genuine overflow is never a separate blob, there's no
    real content to lose by dropping every non-primary blob outright."""
    h, w = canvas.shape[0], canvas.shape[1]
    opaque = canvas[:, :, 3] > 10
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

    out = canvas.copy()
    for lbl in range(1, num_labels + 1):
        if lbl != primary_label:
            out[labels == lbl] = 0
    return out


def extract_native_frame(sheet, frame_width, frame_height, row_margin_fraction,
                          column_margin_fraction, row_index, col):
    """Wide-margin extraction from the native-resolution source sheet.
    Returns a fixed-size (native_w x native_h) RGBA array - the same size
    for every frame of a given character, since it only depends on
    frame_width/frame_height/margins, never on the frame's own content."""
    sheet_h, sheet_w = sheet.shape[0], sheet.shape[1]
    cell_height = round(frame_height)
    row_margin = round(cell_height * row_margin_fraction)
    col_margin = round(frame_width * column_margin_fraction)

    nominal_x = col * frame_width
    nominal_y = round(row_index * frame_height)

    wanted_x = nominal_x - col_margin
    wanted_width = frame_width + 2 * col_margin
    wanted_top = nominal_y - row_margin
    wanted_height = cell_height + 2 * row_margin

    read_left = max(0, wanted_x)
    read_right = min(sheet_w, wanted_x + wanted_width)
    read_width = max(0, read_right - read_left)
    paste_x = read_left - wanted_x

    read_top = max(0, wanted_top)
    read_bottom = min(sheet_h, wanted_top + wanted_height)
    read_height = max(0, read_bottom - read_top)
    paste_y = read_top - wanted_top

    canvas = np.zeros((wanted_height, wanted_width, 4), dtype=np.uint8)
    if read_width > 0 and read_height > 0:
        slice_ = sheet[read_top:read_bottom, read_left:read_right]
        canvas[paste_y:paste_y + read_height, paste_x:paste_x + read_width] = slice_

    nominal_rect_in_canvas = (col_margin, row_margin, frame_width, cell_height)
    return isolate_frame_content(canvas, nominal_rect_in_canvas)


def iter_frame_positions(meta):
    """Yields (row_index, col) for every real (non-gutter) frame a
    character's sheet defines - shared by the measurement pass and the
    extraction pass so they always agree on what counts as a frame."""
    gutter_slots = meta.get("gutterSlots", 0)
    symmetric_frames = meta.get("framesPerFacing", 4)
    frames_front_default = meta.get("framesFront", symmetric_frames)
    frames_back_default = meta.get("framesBack", symmetric_frames)
    for row in meta["rows"]:
        row_index = row["index"]
        frames_front = row.get("framesFront", -1)
        frames_back = row.get("framesBack", -1)
        front_count = frames_front if frames_front and frames_front > 0 else frames_front_default
        back_count = frames_back if frames_back and frames_back > 0 else frames_back_default
        for count, facing_offset in ((front_count, 0), (back_count, frames_front_default + gutter_slots)):
            for frame_index in range(count):
                yield row_index, facing_offset + (frame_index % count)


NET_FRACTION = 0.6  # see module docstring - the largest net that stays safely
                     # inside a single neighboring cell for this sheet layout


def measure_overflow_fractions(sheet_arr, meta):
    """Casts a net around every real frame, isolates that frame's own
    content the same way extraction will, and measures how far it actually
    extends past the OLD nominal frame box in each direction - as a
    *fraction* of this character's own frame_width/frame_height, so the
    results from different characters (a couple of which don't share the
    roster's otherwise-uniform native frame size) can be pooled directly.
    Returns (column_fractions, row_fractions)."""
    frame_width = meta["frameWidth"]
    frame_height = meta["frameHeight"]
    cell_height = round(frame_height)
    net_x = round(frame_width * NET_FRACTION)
    net_y = round(cell_height * NET_FRACTION)
    sheet_h, sheet_w = sheet_arr.shape[0], sheet_arr.shape[1]

    column_fractions, row_fractions = [], []
    for row_index, col in iter_frame_positions(meta):
        nominal_x = col * frame_width
        nominal_y = round(row_index * frame_height)
        wanted_x = nominal_x - net_x
        wanted_w = frame_width + 2 * net_x
        wanted_y = nominal_y - net_y
        wanted_h = cell_height + 2 * net_y

        read_left, read_right = max(0, wanted_x), min(sheet_w, wanted_x + wanted_w)
        read_top, read_bottom = max(0, wanted_y), min(sheet_h, wanted_y + wanted_h)
        read_w, read_h = max(0, read_right - read_left), max(0, read_bottom - read_top)
        canvas = np.zeros((wanted_h, wanted_w, 4), dtype=np.uint8)
        if read_w > 0 and read_h > 0:
            px, py = read_left - wanted_x, read_top - wanted_y
            canvas[py:py + read_h, px:px + read_w] = sheet_arr[read_top:read_bottom, read_left:read_right]

        nominal_rect = (net_x, net_y, frame_width, cell_height)
        cleaned = isolate_frame_content(canvas, nominal_rect)
        opaque = cleaned[:, :, 3] > 10
        if not opaque.any():
            continue
        ys, xs = np.where(opaque)
        left_over = max(0, net_x - xs.min())
        right_over = max(0, xs.max() - (net_x + frame_width - 1))
        top_over = max(0, net_y - ys.min())
        bottom_over = max(0, ys.max() - (net_y + cell_height - 1))
        column_fractions.append(max(left_over, right_over) / frame_width)
        row_fractions.append(max(top_over, bottom_over) / cell_height)
    return column_fractions, row_fractions


def compute_global_margins(percentile=97, min_fraction=0.06, max_fraction=0.6, safety_factor=1.1):
    """Pools measure_overflow_fractions() across the ENTIRE roster and picks
    ONE column/row margin fraction for everyone - see the module docstring
    for why this replaced an earlier per-character version. A high
    percentile (rather than the max) keeps one mislabeled blob in one
    character from blowing up the margin for the whole roster; pooling
    thousands of frames across 135 characters means even a 97th-percentile
    cutoff is backed by real, repeated need (not a fluke), unlike the same
    percentile computed from one character's own ~70-frame sample."""
    all_column, all_row = [], []
    for folder in sorted(SOURCE_DIR.iterdir()):
        if not folder.is_dir():
            continue
        json_path = folder / f"{folder.name}.json"
        if not json_path.exists():
            continue
        with open(json_path) as f:
            meta = json.load(f)
        if "rowMarginFraction" not in meta:
            continue
        sheet_path = json_path.parent / meta["sheet"]
        sheet_arr = np.array(Image.open(sheet_path).convert("RGBA"))
        col_fracs, row_fracs = measure_overflow_fractions(sheet_arr, meta)
        all_column.extend(col_fracs)
        all_row.extend(row_fracs)

    def pick(values):
        p = float(np.percentile(values, percentile))
        return min(max_fraction, max(min_fraction, p * safety_factor))

    column_margin_fraction = pick(all_column)
    row_margin_fraction = pick(all_row)
    print(f"Global margins from {len(all_column)} frames across the roster: "
          f"col={column_margin_fraction:.3f} row={row_margin_fraction:.3f} "
          f"(p{percentile} col={np.percentile(all_column, percentile):.3f} "
          f"row={np.percentile(all_row, percentile):.3f})")
    return column_margin_fraction, row_margin_fraction


def process_character(name: str, column_margin_fraction: float, row_margin_fraction: float,
                       dry_run: bool, out_suffix: str):
    src_json = SOURCE_DIR / name / f"{name}.json"
    dst_json = TARGET_DIR / name / f"{name}.json"
    if not src_json.exists() or not dst_json.exists():
        print(f"  skip (missing source or target json): {name}")
        return

    with open(src_json) as f:
        src_meta = json.load(f)
    with open(dst_json) as f:
        dst_meta = json.load(f)

    if "rowMarginFraction" not in src_meta:
        print(f"  skip (source has no margin fields): {name}")
        return

    frame_width = src_meta["frameWidth"]
    frame_height = src_meta["frameHeight"]
    gutter_slots = src_meta.get("gutterSlots", 0)
    symmetric_frames = src_meta.get("framesPerFacing", 4)
    frames_front_default = src_meta.get("framesFront", symmetric_frames)
    frames_back_default = src_meta.get("framesBack", symmetric_frames)
    rows = src_meta["rows"]

    # The CURRENT (already-2x) frame size is the fixed target - the whole
    # point is to capture more real content without changing this.
    target_w = dst_meta["frameWidth"]
    target_h = dst_meta["frameHeight"]

    sheet_path = src_json.parent / src_meta["sheet"]
    sheet_arr = np.array(Image.open(sheet_path).convert("RGBA"))

    max_row_index = max(r["index"] for r in rows)
    total_cols = frames_front_default + gutter_slots + frames_back_default

    # Native intermediate size is fixed (doesn't depend on content), so
    # compute the one scale factor for this character up front.
    native_h = round(frame_height) + 2 * round(round(frame_height) * row_margin_fraction)
    native_w = frame_width + 2 * round(frame_width * column_margin_fraction)
    scale = min(target_w / native_w, target_h / native_h)
    scaled_w = max(1, round(native_w * scale))
    scaled_h = max(1, round(native_h * scale))
    paste_x = (target_w - scaled_w) // 2
    paste_y = target_h - scaled_h  # bottom-flush, consistent across every frame

    new_sheet_arr = np.zeros(((max_row_index + 1) * target_h, total_cols * target_w, 4), dtype=np.uint8)

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
                native = extract_native_frame(
                    sheet_arr, frame_width, frame_height, row_margin_fraction,
                    column_margin_fraction, row_index, col,
                )
                scaled = Image.fromarray(native, "RGBA").resize((scaled_w, scaled_h), Image.LANCZOS)

                dst_y = row_index * target_h
                dst_x = col * target_w
                new_sheet_arr[dst_y + paste_y:dst_y + paste_y + scaled_h,
                              dst_x + paste_x:dst_x + paste_x + scaled_w] = np.array(scaled)

    new_meta = dict(dst_meta)  # keep frameWidth/frameHeight and everything else already correct for this repo

    if dry_run:
        out_png = dst_json.parent / (dst_json.stem + out_suffix + ".png")
        out_json = dst_json.parent / (dst_json.stem + out_suffix + ".json")
    else:
        out_png = dst_json.parent / dst_meta["sheet"]
        out_json = dst_json

    Image.fromarray(new_sheet_arr, "RGBA").save(out_png)
    with open(out_json, "w") as f:
        json.dump(new_meta, f, indent=4)
    print(f"  wrote {out_png.name} (margins col={column_margin_fraction:.2f} row={row_margin_fraction:.2f}, "
          f"scale {scale:.3f}, content {scaled_w}x{scaled_h} within {target_w}x{target_h} frame)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", action="append", help="process only this character folder name (repeatable)")
    parser.add_argument("--dry-run", action="store_true", help="write alongside originals as <name>_refitted.png/json")
    parser.add_argument("--column-margin", type=float, help="skip roster-wide measurement, use this fraction")
    parser.add_argument("--row-margin", type=float, help="skip roster-wide measurement, use this fraction")
    args = parser.parse_args()

    if args.column_margin is not None and args.row_margin is not None:
        column_margin_fraction, row_margin_fraction = args.column_margin, args.row_margin
    else:
        column_margin_fraction, row_margin_fraction = compute_global_margins()

    out_suffix = "_refitted" if args.dry_run else ""
    folders = sorted(SOURCE_DIR.iterdir())
    for folder in folders:
        if not folder.is_dir():
            continue
        if args.only and folder.name not in args.only:
            continue
        print(f"{folder.name}:")
        process_character(folder.name, column_margin_fraction, row_margin_fraction, args.dry_run, out_suffix)


if __name__ == "__main__":
    sys.exit(main())
