#!/usr/bin/env python3
"""Cache small identity references and normalize generated wraith-layout sheets.

Requires Pillow, NumPy and SciPy. No image generation or network calls.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

REPO = Path(__file__).resolve().parents[1]
OUTPUT = REPO / 'output/imagegen'
TEMPLATE = REPO / 'assets/characters/wraith/wraith.json'
FRAME = (560, 1012)
ANCHOR = (280, 840)


def check(condition, message):
    if not condition:
        raise ValueError(message)


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2) + '\n')


def resize(image, size):
    return image.convert('RGBa').resize(size, Image.Resampling.LANCZOS).convert('RGBA')


def clean_identity(frame):
    pixels = np.array(frame.convert('RGBA'))
    labels, _ = ndimage.label(pixels[:, :, 3] > 32)
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    check(sizes.max() > 0, 'Empty identity frame')
    index = int(sizes.argmax())
    ys, xs = np.nonzero(labels == index)
    strong_box = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]
    support = ndimage.binary_dilation(labels == index, iterations=3)
    pixels[~support] = 0
    cleaned = Image.fromarray(pixels)
    return cleaned.crop(cleaned.getchannel('A').getbbox()), strong_box


def cache(name):
    root = OUTPUT / name
    refs = root / 'references'
    manifest = refs / 'lean-reference.json'
    if manifest.exists():
        data = json.loads(manifest.read_text())
        check((refs / data['reference']).exists(), f'Missing cached reference for {name}')
        print(f'{name}: cached reference reused')
        return
    asset = REPO / 'assets/characters' / name
    metadata = json.loads((asset / f'{name}.json').read_text())
    fw, fh = metadata['frameWidth'], metadata['frameHeight']
    back_col = metadata['framesFront'] + metadata['gutterSlots']
    source = asset / metadata['sheet']
    refs.mkdir(parents=True, exist_ok=True)
    # Decode once; inspect only the front and back idle cells. Never create
    # or send a preview of the old full animation sheet.
    with Image.open(source) as sheet:
        front, front_box = clean_identity(sheet.crop((0, 0, fw, fh)))
        back, back_box = clean_identity(sheet.crop((back_col * fw, 0, (back_col + 1) * fw, fh)))
    card = Image.new('RGBA', (front.width + back.width + 48, max(front.height, back.height) + 32))
    card.alpha_composite(front, (16, card.height - 16 - front.height))
    card.alpha_composite(back, (front.width + 32, card.height - 16 - back.height))
    reference = 'lean-front-back.png'
    card.save(refs / reference)
    write_json(manifest, {'name': name, 'reference': reference,
                         'source': str(source.relative_to(REPO)),
                         'source_size_bytes': source.stat().st_size,
                         'source_mtime_ns': source.stat().st_mtime_ns,
                         'front_bbox': front_box, 'back_bbox': back_box,
                         'target_idle_height': front_box[3] - front_box[1]})
    print(f'{name}: cached front/back, idle height {front_box[3] - front_box[1]}')


def normalize(args):
    root = OUTPUT / args.name
    destination = root / f'{args.name}-v2.png'
    check(args.replace or not destination.exists(), 'Candidate exists; choose --replace explicitly to rebuild it')
    reference = json.loads((root / 'references/lean-reference.json').read_text())
    config_path = root / 'normalization.json'
    config = json.loads(config_path.read_text()) if config_path.exists() else {}
    source_path = root / f'{args.name}_generated.png'
    with Image.open(source_path) as source:
        check(source.mode == 'RGBA', 'Generated source must have an RGBA alpha channel')
        pixels = np.array(source)
    threshold = int(config.get('segmentation_alpha', 32))
    check(0 < threshold < 255, 'segmentation_alpha must be between 1 and 254')
    mask = pixels[:, :, 3] > threshold
    changes = np.diff(np.r_[False, mask.any(axis=1), False].astype(int))
    bands = [(int(a), int(b)) for a, b in zip(np.flatnonzero(changes == 1), np.flatnonzero(changes == -1)) if b - a >= 20]
    check(len(bands) == 10, f'Expected 10 separate pose bands, found {len(bands)}; inspect source')
    labels, _ = ndimage.label(mask)
    sizes = np.bincount(labels.ravel())
    components = [(i, box) for i, box in enumerate(ndimage.find_objects(labels), 1) if sizes[i] >= 200]
    grouped = [sorted([(i, box) for i, box in components if top <= box[0].start < bottom], key=lambda item: item[1][1].start) for top, bottom in bands]
    check(sum(map(len, grouped)) == len(components), 'A significant component lies outside the pose rows')
    metadata = json.loads(TEMPLATE.read_text())
    source_rows = config.get('source_rows', list(range(10)))
    check(sorted(source_rows) == list(range(10)), 'source_rows must be a permutation of 0..9')
    idle = grouped[source_rows[0]]
    check(len(idle) == 6, 'Idle needs exactly three front and three back poses')
    centers = [(box[1].start + box[1].stop - 1) / 2 for _, box in idle]
    spacing = float(np.median(np.diff(centers[:3])))
    roots = config.get('source_root_x', centers[:3] + [centers[2] + spacing, None] + centers[3:])
    check(len(roots) == 8 and roots[4] is None, 'Expected eight roots with empty fifth column')
    idle_height = float(np.median([box[0].stop - box[0].start for _, box in idle[:3]]))
    scale = float(config.get('scale', reference['target_idle_height'] / idle_height))
    check(scale > 0 and np.isfinite(scale), 'Invalid uniform scale')
    sheet = Image.new('RGBA', (4480, 10120))
    frames = []
    for row, action in enumerate(metadata['rows']):
        source_row = source_rows[row]
        entries = grouped[source_row]
        selected = config.get('select', {}).get(action['name'])
        if selected is not None:
            check(len(selected) == len(set(selected)) and all(0 <= i < len(entries) for i in selected), 'Invalid explicit pose selection')
            entries = [entries[i] for i in selected]
        front_count = action.get('framesFront', metadata['framesFront'])
        columns = list(range(front_count)) + [5, 6, 7]
        check(len(entries) == len(columns), f"{action['name']}: expected {len(columns)} poses, found {len(entries)}; inspect source")
        floors = [max(box[0].stop for _, box in entries[:front_count]) - 1,
                  max(box[0].stop for _, box in entries[front_count:]) - 1]
        for col, (index, box) in zip(columns, entries):
            ground = box[0].stop - 1 if action['name'] == 'die' else floors[int(col >= 5)]
            x0, x1 = max(0, box[1].start - 4), min(pixels.shape[1], box[1].stop + 4)
            y0, y1 = max(0, box[0].start - 4), min(pixels.shape[0], box[0].stop + 4)
            piece = pixels[y0:y1, x0:x1].copy()
            local = labels[y0:y1, x0:x1]
            support = ndimage.binary_dilation(local == index, iterations=3)
            support &= (local == 0) | (local == index)
            piece[~support] = 0
            sprite = resize(Image.fromarray(piece), (round(piece.shape[1] * scale), round(piece.shape[0] * scale)))
            shift = config.get('action_offsets', {}).get(action['name'], [0, 0])
            check(len(shift) == 2, 'action_offsets entries need x and y')
            offset = (round(ANCHOR[0] + (x0 - roots[col]) * scale + shift[0]),
                      round(ANCHOR[1] + (y0 - ground) * scale + shift[1]))
            check(offset[0] >= 0 and offset[1] >= 0 and offset[0] + sprite.width <= FRAME[0] and offset[1] + sprite.height <= FRAME[1], f'{action["name"]}/{col}: sprite exceeds cell')
            frame = Image.new('RGBA', FRAME)
            frame.alpha_composite(sprite, offset)
            bbox = frame.getchannel('A').getbbox()
            check(bbox and 0 < bbox[0] < bbox[2] < FRAME[0] and 0 < bbox[1] < bbox[3] < FRAME[1], 'Frame touches cell edge')
            sheet.paste(frame, (col * FRAME[0], row * FRAME[1]))
            frames.append({'action': action['name'], 'row': row, 'column': col,
                           'facing': 'front' if col < 4 else 'back',
                           'source_row': source_row, 'source_ground': [roots[col], ground],
                           'alpha_bbox': bbox})
    repair_records = []
    repaired_cells = set()
    for repair in config.get('repairs', []):
        key = (repair['row'], repair['column'])
        check(key not in repaired_cells, 'Duplicate frame repair')
        repaired_cells.add(key)
        record = next((f for f in frames if (f['row'], f['column']) == key), None)
        check(record is not None, 'Repair must target an occupied cell')
        repair_path = root / repair['file']
        with Image.open(repair_path) as edited:
            check(edited.mode == 'RGBA' and edited.size == FRAME, 'Repairs must be full-cell RGBA images')
            bbox = edited.getchannel('A').getbbox()
            check(bbox and 0 < bbox[0] < bbox[2] < 560 and 0 < bbox[1] < bbox[3] < 1012, 'Repair touches cell edge')
            sheet.paste(edited, (key[1] * 560, key[0] * 1012))
            record['alpha_bbox'] = bbox
            record['repair'] = repair['file']
        repair_records.append({**repair, 'sha256': hashlib.sha256(repair_path.read_bytes()).hexdigest()})
    sheet.save(destination)
    metadata['sheet'] = destination.name
    write_json(root / f'{args.name}-v2.json', metadata)
    occupied = {(f['row'], f['column']) for f in frames}
    with Image.open(destination) as saved:
        check(saved.mode == 'RGBA' and saved.size == (4480, 10120), 'Invalid saved sheet format')
        check(saved.getchannel('A').getextrema() == (0, 255), 'Invalid transparency')
        for row in range(10):
            for col in range(8):
                bbox = saved.crop((col * 560, row * 1012, (col + 1) * 560, (row + 1) * 1012)).getchannel('A').getbbox()
                check(bool(bbox) == ((row, col) in occupied), 'Incorrect occupied/empty slot')
                if bbox:
                    check(0 < bbox[0] < bbox[2] < 560 and 0 < bbox[1] < bbox[3] < 1012, 'Saved frame touches edge')
    check(len(occupied) == 65, 'Expected 65 occupied cells')
    resize(sheet, (1120, 2530)).save(root / f'{args.name}-v2-preview.png')
    top = min(f['alpha_bbox'][1] for f in frames) - 12
    bottom = max(f['alpha_bbox'][3] for f in frames) + 12
    height = round((bottom - top) / 4)
    contact = Image.new('RGB', (1120, (height + 5) * 10), (85, 90, 98))
    for row in range(10):
        for col in range(8):
            crop = resize(sheet.crop((col * 560, row * 1012 + top, (col + 1) * 560, row * 1012 + bottom)), (140, height))
            contact.paste(crop, (col * 140, row * (height + 5)), crop)
    contact.save(root / f'{args.name}-v2-contact.png')
    validation = {'method': 'Lean Method', 'file': destination.name, 'size': list(sheet.size),
                  'mode': 'RGBA', 'pose_count': 65, 'transparent_empty_slots': 15,
                  'edge_contact_count': 0, 'frame_size': list(FRAME), 'ground_anchor': list(ANCHOR),
                  'uniform_scale': scale, 'segmentation_alpha': threshold,
                  'target_idle_height': reference['target_idle_height'],
                  'source_sha256': hashlib.sha256(source_path.read_bytes()).hexdigest(),
                  'repairs': repair_records, 'frames': frames}
    write_json(root / 'validation.json', validation)
    print(f'{args.name}: 65 poses, 15 empty slots, no edge contacts; scale {scale:.3f}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    cache_parser = commands.add_parser('cache')
    cache_parser.add_argument('names', nargs='+')
    norm_parser = commands.add_parser('normalize')
    norm_parser.add_argument('name')
    norm_parser.add_argument('--replace', action='store_true')
    args = parser.parse_args()
    if args.command == 'cache':
        for name in args.names:
            cache(name)
    else:
        normalize(args)


if __name__ == '__main__':
    main()
