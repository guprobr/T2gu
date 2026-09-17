#!/usr/bin/env python3
"""
Normalize a Gemini-generated LARASPRITE sheet into a real RGBA PNG.

Gemini reliably produces the 10-row/front-back grid layout but cannot
deliver true alpha transparency (it flattens onto a flat background
color) and ignores "no text" instructions (row labels get burned into
the top-left corner of each row). This script:

  1. Detects the flat background color from the image corners and
     flood-fills it to alpha=0 from the border inward (so background
     trapped *inside* the character, e.g. a blue-gray trouser leg, is
     left alone).
  2. Finds small opaque islands left behind in the top-left corner of
     each row band (the burned-in labels, now disconnected from the
     background after step 1) and clears them too.
  3. Leaves canvas dimensions untouched (per the fixed decision to
     standardize on Gemini's own output size rather than force a
     resize/pad to a fixed target).

Run with --debug to write a preview PNG with removed label regions
outlined in red, so you can confirm no character content got clipped
before trusting the output.
"""
import argparse
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage


def sample_background_color(rgb: np.ndarray, patch: int = 6) -> np.ndarray:
    h, w, _ = rgb.shape
    corners = [
        rgb[0:patch, 0:patch],
        rgb[0:patch, w - patch:w],
        rgb[h - patch:h, 0:patch],
        rgb[h - patch:h, w - patch:w],
    ]
    samples = np.concatenate([c.reshape(-1, 3) for c in corners], axis=0)
    return np.median(samples, axis=0)


def flood_fill_background(rgb: np.ndarray, bg_color: np.ndarray, tolerance: float):
    dist = np.linalg.norm(rgb.astype(np.float32) - bg_color.astype(np.float32), axis=2)
    close_mask = dist <= tolerance

    labels, num = ndimage.label(close_mask, structure=np.ones((3, 3)))
    if num == 0:
        return np.zeros(rgb.shape[:2], dtype=bool)

    border_labels = set(labels[0, :]) | set(labels[-1, :]) | set(labels[:, 0]) | set(labels[:, -1])
    border_labels.discard(0)

    background_mask = np.isin(labels, list(border_labels))
    return background_mask


def find_label_islands(opaque_mask: np.ndarray, rows: int, text_left_frac: float,
                        text_top_frac: float, text_max_area_frac: float):
    h, w = opaque_mask.shape
    row_h = h / rows
    max_area = text_max_area_frac * (w * h)

    labels, num = ndimage.label(opaque_mask, structure=np.ones((3, 3)))
    islands = []
    if num == 0:
        return islands

    objects = ndimage.find_objects(labels)
    for i, sl in enumerate(objects, start=1):
        if sl is None:
            continue
        y0, y1 = sl[0].start, sl[0].stop
        x0, x1 = sl[1].start, sl[1].stop
        area = int((labels[sl] == i).sum())
        if area > max_area:
            continue
        cy = (y0 + y1) / 2.0
        cx = (x0 + x1) / 2.0
        row_index = int(cy // row_h)
        row_local_y = (cy - row_index * row_h) / row_h
        row_local_x = cx / w
        if row_local_y <= text_top_frac and row_local_x <= text_left_frac:
            islands.append((i, (x0, y0, x1, y1), area))

    return labels, islands


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--rows", type=int, default=10, help="number of animation rows in the grid (default 10)")
    ap.add_argument("--tolerance", type=float, default=40.0,
                     help="color distance (0-441) to treat as background (default 40)")
    ap.add_argument("--text-left-frac", type=float, default=0.20,
                     help="fraction of row width, from the left, where labels can appear (default 0.20)")
    ap.add_argument("--text-top-frac", type=float, default=0.40,
                     help="fraction of row height, from the top, where labels can appear (default 0.40)")
    ap.add_argument("--text-max-area-frac", type=float, default=0.0025,
                     help="max area (fraction of total canvas) for a component to count as label text, "
                          "not character content (default 0.0025)")
    ap.add_argument("--feather", type=float, default=0.6,
                     help="gaussian blur radius applied to the alpha edge to soften jaggies (default 0.6, 0 to disable)")
    ap.add_argument("--debug", metavar="PREVIEW_PATH", default=None,
                     help="also write an annotated preview with removed label regions boxed in red")
    args = ap.parse_args()

    src = Image.open(args.input).convert("RGB")
    rgb = np.array(src)
    print(f"input: {args.input}  format={src.format}  size={src.size}  mode=RGB (loaded)")

    bg_color = sample_background_color(rgb)
    print(f"detected background color (RGB): {bg_color.round(1).tolist()}")

    background_mask = flood_fill_background(rgb, bg_color, args.tolerance)
    opaque_mask = ~background_mask

    result = find_label_islands(opaque_mask, args.rows, args.text_left_frac,
                                 args.text_top_frac, args.text_max_area_frac)
    if result == []:
        labels, islands = None, []
    else:
        labels, islands = result

    if islands:
        island_mask = np.isin(labels, [i for i, _, _ in islands])
        opaque_mask = opaque_mask & ~island_mask
        print(f"removed {len(islands)} label/text island(s):")
        for _, bbox, area in islands:
            print(f"  bbox={bbox} area={area}px")
    else:
        print("no label/text islands found (either already clean, or tune --text-* thresholds)")

    alpha = (opaque_mask.astype(np.uint8)) * 255
    alpha_img = Image.fromarray(alpha, mode="L")
    if args.feather > 0:
        alpha_img = alpha_img.filter(ImageFilter.GaussianBlur(args.feather))

    out = src.convert("RGBA")
    out.putalpha(alpha_img)
    out.save(args.output, "PNG")
    print(f"output: {args.output}  format=PNG  mode=RGBA  size={out.size}")

    if args.debug:
        preview = src.convert("RGB").copy()
        draw = ImageDraw.Draw(preview)
        for _, bbox, _ in islands:
            draw.rectangle(bbox, outline=(255, 0, 0), width=2)
        preview.save(args.debug, "PNG")
        print(f"debug preview: {args.debug}")


if __name__ == "__main__":
    sys.exit(main())
