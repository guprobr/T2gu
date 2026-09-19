#!/usr/bin/env python3
"""Generates the map JSON (base terrain grid, empty obj grid) for chapters 1 and 7-16: the two-part "town, then maze" levels.

Usage:  python3 tools/make_chapter_maps.py [N ...] [--out DIR]     (default: every chapter below, written to assets/maps/)

Only the ground is generated here. Props, NPCs, enemies and quests come from each chapter's script (assets/scripts/chapterN.js), which
reads the same layout numbers back out of the map's "layout" field / its own constants - keep the two in step if a Spec changes.


Coordinates: `u` is a column counted from the START edge of the level (u=0 is the start-edge border column),
so the same layout description works for left->right (dir=+1) and right->left (dir=-1) levels:
    abs_col(u) = u            if dir > 0
               = W - 1 - u    if dir < 0
Level layout along u:   [border][ town: u=1..T ][ river: T+1..T+river ][ maze: M cols ][ pocket: P cols ][border]
"""
import argparse, json, os, random
from dataclasses import dataclass, field
import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")
BORDER_SETS = set(json.load(open(f"{ROOT}/props/borders.json"))["borders"].keys())


@dataclass
class Spec:
    n: int
    title: str
    tileset: str            # base name in assets/tilesets
    lighting: str | None
    W: int
    H: int
    dir: int                # +1 level runs left->right, -1 right->left
    T: int                  # town playable columns
    M: int                  # maze columns
    P: int                  # exit-pocket columns
    cw: int = 2             # maze corridor width (tiles)
    ww: int = 4             # maze wall thickness (tiles)
    river: int = 0          # width of a river between town and maze (needs a tileset whose index 9 is "water")
    town_ground: int = 0    # tile index (0 primary / 9 secondary terrain) filling the town
    maze_ground: int = 9    # ... filling the maze (roads in the town use this too)
    pocket_ground: int | None = None   # defaults to the town ground (the level ends on an echo of where it began)
    interior: bool = False
    seed: int = 1
    roads: bool = True      # main road into the maze gate + cross street + plaza, in the maze's ground type
    cross_street: bool = True
    plaza: tuple = (6, 5)   # plaza ellipse radii (cols, rows) at the crossing; (0,0) = none
    maze_patches: int = 7
    pond: bool = False      # a village pond (only meaningful when secondary terrain is water)
    note: str = ""
    extra: dict = field(default_factory=dict)

    # ---- derived geometry -------------------------------------------------------------------------------------
    def __post_init__(self):
        assert self.W == 2 + self.T + self.river + self.M + self.P, (self.n, self.W, 2 + self.T + self.river + self.M + self.P)
        self.ring = (self.tileset in BORDER_SETS) and not self.interior
        self.north = 1 if self.ring else 0                    # a tileset with no border ring would let the hero walk the
        self.south = self.H - 2 if self.ring else self.H - 1   # top/bottom edge row around the maze, so seal those rows too
        cs = self.cw + self.ww
        ncy = max(1, (self.south - self.north + 1) // cs)
        sy = ncy // 2
        self.entrance_rows = (self.north + sy * cs, self.south if sy == ncy - 1 else self.north + sy * cs + self.cw - 1)
        self.mid = (self.entrance_rows[0] + self.entrance_rows[1]) // 2
        self.maze_u0 = self.T + self.river + 1
        self.maze_u1 = self.maze_u0 + self.M - 1
        self.pocket_u0 = self.maze_u1 + 1
        self.pocket_u1 = self.W - 2
        if self.pocket_ground is None:
            self.pocket_ground = self.town_ground

    def col(self, u):
        return u if self.dir > 0 else self.W - 1 - u

    @property
    def maze_west(self):
        return self.col(self.maze_u0) if self.dir > 0 else self.col(self.maze_u1)

    @property
    def maze_east(self):
        return self.col(self.maze_u1) if self.dir > 0 else self.col(self.maze_u0)


def wobble(H, seed, amp=1, seg=7):
    rng = random.Random(seed)
    out, cur = [], 0
    for r in range(H):
        if r % seg == 0:
            cur = max(-amp, min(amp, cur + rng.choice([-1, 0, 1])))
        out.append(cur)
    return out


def autotile(mask):
    """Blob autotile, validated against ~93k cells of the six shipped maps (2 exceptions).
    mask True = secondary terrain (index 9). Ties for three-sided / opposite-sided cells use the priority
    learned from the shipped data: NE > NW > SE > SW, N over S, E over W."""
    H, W = mask.shape
    P = np.pad(mask, 1, constant_values=False).astype(int)
    N, S, Wt, E = P[0:H, 1:W + 1], P[2:H + 2, 1:W + 1], P[1:H + 1, 0:W], P[1:H + 1, 2:W + 2]
    out = np.zeros((H, W), int)
    for r in range(H):
        for c in range(W):
            if mask[r, c]:
                out[r, c] = 9
                continue
            n, s, e, w = N[r, c], S[r, c], E[r, c], Wt[r, c]
            cnt = n + s + e + w
            if cnt == 0:
                t = 0
            elif cnt == 1:
                t = 1 if n else 2 if s else 3 if e else 4
            elif n and e:
                t = 6
            elif n and w:
                t = 5
            elif s and e:
                t = 8
            elif s and w:
                t = 7
            else:                     # opposite pair only
                t = 1 if n else 3
            out[r, c] = t
    return out


def blob(mask, cu, cr, ru, rr, spec, value):
    """Fill an ellipse centred at (u=cu,row=cr), radii in (u, rows), with `value`."""
    for r in range(max(0, cr - rr), min(spec.H, cr + rr + 1)):
        for u in range(max(0, cu - ru), min(spec.W, cu + ru + 1)):
            if abs((u - cu) / max(ru, 0.5)) ** 3 + abs((r - cr) / max(rr, 0.5)) ** 3 <= 1.0:   # superellipse: flat ends, no 1-tile tips
                mask[r, spec.col(u)] = value


def build_mask(spec: Spec):
    H, W = spec.H, spec.W
    mask = np.zeros((H, W), bool)
    wob = wobble(H, spec.seed)
    rng = random.Random(spec.seed * 7 + 1)
    water = spec.river > 0
    tg, mg, pg = spec.town_ground == 9, spec.maze_ground == 9, spec.pocket_ground == 9
    for r in range(H):
        for u in range(W):
            if water:
                lo, hi = spec.T + 1 + wob[r], spec.T + spec.river + wob[r]
                v = (lo <= u <= hi)
                mask[r, spec.col(u)] = v
            else:
                edge = spec.T + wob[r]
                pedge = spec.pocket_u0 - 1 + wob[(r + 11) % H]
                if u <= edge:
                    mask[r, spec.col(u)] = tg
                elif u > pedge and spec.P > 0:
                    mask[r, spec.col(u)] = pg
                else:
                    mask[r, spec.col(u)] = mg
    if water:
        # The ford: a land gap through the river exactly where the maze opens (rows +-1 either side of the opening).
        r0, r1 = spec.entrance_rows
        for r in range(r0 - 1, r1 + 2):
            for u in range(spec.T - 1, spec.maze_u0 + 1):
                mask[r, spec.col(u)] = False
        if spec.pond:      # a village pond well away from the main road
            blob(mask, spec.T // 2 + 4, spec.mid + 17, 5, 4, spec, True)
            blob(mask, spec.T // 2 - 8, spec.mid - 19, 4, 3, spec, True)
    else:
        road = mg   # roads are made of the maze's ground type, so they flow straight into the maze terrain
        r0 = spec.mid - 1
        tc = spec.T // 2
        if spec.roads:
            for r in range(r0, r0 + 3):
                for u in range(1, spec.T + 3):
                    mask[r, spec.col(u)] = road
            if spec.cross_street:
                for u in range(tc - 1, tc + 2):
                    for r in range(6, H - 6):
                        mask[r, spec.col(u)] = road
            if spec.plaza != (0, 0):
                blob(mask, tc, spec.mid, spec.plaza[0], spec.plaza[1], spec, road)
        # organic patches of the opposite ground scattered through the maze zone (variety under the wall props)
        for _ in range(spec.maze_patches):
            cu = rng.randint(spec.maze_u0 + 8, spec.maze_u1 - 8)
            cr = rng.randint(6, H - 7)
            blob(mask, cu, cr, rng.randint(3, 6), rng.randint(3, 5), spec, not mg)
    return mask


def clean(mask):
    """Remove 1-tile-wide strips and gaps (the tileset has no art for them): a terrain cell squeezed between two
    opposite neighbours of the other terrain takes that terrain's type. Repeats until stable."""
    m = mask.copy()
    for _ in range(6):
        P = np.pad(m, 1, constant_values=None if False else False)
        L, R, U, D = P[1:-1, 0:-2], P[1:-1, 2:], P[0:-2, 1:-1], P[2:, 1:-1]
        interior_lr = np.ones_like(m); interior_lr[:, 0] = False; interior_lr[:, -1] = False
        interior_ud = np.ones_like(m); interior_ud[0, :] = False; interior_ud[-1, :] = False
        thin_sec = m & ~L & ~R & interior_lr | m & ~U & ~D & interior_ud      # secondary squeezed by primary
        thin_pri = ~m & L & R & interior_lr | ~m & U & D & interior_ud        # primary squeezed by secondary
        if not thin_sec.any() and not thin_pri.any():
            break
        m = (m & ~thin_sec) | thin_pri
    return m


def build_map(spec: Spec):
    base = autotile(clean(build_mask(spec)))
    return base


def write_map(spec: Spec, out_dir=f"{ROOT}/maps"):
    base = build_map(spec)
    layout = {
        "direction": "left-to-right" if spec.dir > 0 else "right-to-left",
        "startEdge": "west" if spec.dir > 0 else "east",
        "townCols": sorted([spec.col(1), spec.col(spec.T)]),
        "mazeCols": [spec.maze_west, spec.maze_east],
        "pocketCols": sorted([spec.col(spec.pocket_u0), spec.col(spec.pocket_u1)]) if spec.P else None,
        "riverCols": sorted([spec.col(spec.T + 1), spec.col(spec.T + spec.river)]) if spec.river else None,
        "mazeRows": [spec.north, spec.south],
        "entranceRows": list(spec.entrance_rows),
    }
    head = {
        "tileset": f"../tilesets/{spec.tileset}.json",
        "script": f"../scripts/chapter{spec.n}.js",
        "title": f"Chapter {spec.n}: {spec.title}",
    }
    if spec.lighting:
        head["lighting"] = spec.lighting
    if spec.interior:
        head["interior"] = True
        head["wallTheme"] = spec.extra.get("wallTheme", "stone_archive")
    head.update({"width": spec.W, "height": spec.H, "tileWidth": 128, "tileHeight": 128})
    head["_comment"] = (spec.note or f"Chapter {spec.n}.") + (
        " Two parts: the town at the start edge, then the maze. "
        f"Runs {layout['direction']}: town cols {layout['townCols']}, maze cols {layout['mazeCols']}"
        + (f", river cols {layout['riverCols']}" if spec.river else "")
        + (f", exit pocket cols {layout['pocketCols']}" if spec.P else "") + ". Generated by tools/make_chapter_maps.py.")
    head["layout"] = layout
    path = os.path.join(out_dir, f"chapter{spec.n}.json")
    with open(path, "w") as f:
        f.write("{\n")
        for k, v in head.items():
            f.write(f"    {json.dumps(k)}: {json.dumps(v)},\n")
        f.write('    "base": [\n' + ",\n".join("        " + json.dumps(row.tolist(), separators=(",", ":")) for row in base) + "\n    ],\n")
        f.write('    "obj": [\n' + ",\n".join("        " + json.dumps([-1] * spec.W, separators=(",", ":")) for _ in range(spec.H)) + "\n    ]\n}\n")
    return path, layout


# dir: +1 = left->right, -1 = right->left.   ground 0 = the tileset's primary terrain, 9 = its secondary.
SPECS = {
 1:  Spec(1,  "Fernhollow",            "grass_water",         "sunrise", W=150, H=78,  dir=+1, T=40, river=4, M=104, P=0,  cw=2, ww=4, pond=True, seed=101,
          note="Fernhollow reformulated: the village first (a real town now, cols 1-40), a river with a single ford, then the Hollowbrook Maze."),
 7:  Spec(7,  "The Frostmarket",       "dirt_snow",           "sunrise", W=156, H=84,  dir=-1, T=42, M=100, P=12, cw=2, ww=3, town_ground=0, maze_ground=9, seed=707),
 8:  Spec(8,  "Lanternside",           "dirty_plate_asphalt", "torch",   W=162, H=90,  dir=+1, T=44, M=106, P=10, cw=2, ww=3, town_ground=0, maze_ground=9, seed=808),
 9:  Spec(9,  "Highgate Toll",         "grass_stone",         "sunset",  W=168, H=90,  dir=-1, T=46, M=110, P=10, cw=2, ww=4, town_ground=0, maze_ground=9, seed=909),
 10: Spec(10, "The Mourning Fair",     "haunted_grass_cobble","mystical",W=168, H=96,  dir=+1, T=44, M=112, P=10, cw=2, ww=3, town_ground=0, maze_ground=9, seed=1010),
 11: Spec(11, "The Bramble Bazaar",    "grass_dirt",          None,      W=160, H=84,  dir=-1, T=40, M=108, P=10, cw=2, ww=4, town_ground=0, maze_ground=9, seed=1111),
 12: Spec(12, "Cinderport",            "stone_grass",         "torch",   W=174, H=96,  dir=+1, T=46, M=116, P=10, cw=3, ww=3, town_ground=0, maze_ground=9, seed=1212, roads=False, plaza=(0,0)),
 13: Spec(13, "The Undertrack",        "asphalt_dirty_plate", "cavern",  W=172, H=90,  dir=-1, T=44, M=116, P=10, cw=2, ww=3, town_ground=9, maze_ground=0, seed=1313),
 14: Spec(14, "Mirrorwater Ford",      "grass_water",         "mystical",W=164, H=84,  dir=+1, T=40, river=4, M=110, P=8, cw=2, ww=4, pond=True, seed=1414),
 15: Spec(15, "The Vigil Lights",      "snow_grass",          "sunset",  W=176, H=96,  dir=-1, T=46, M=118, P=10, cw=2, ww=4, town_ground=0, maze_ground=9, seed=1515),
 16: Spec(16, "The Long Room",         "dirt_grass",          "sunrise", W=180, H=102, dir=+1, T=48, M=120, P=10, cw=2, ww=3, town_ground=9, maze_ground=0, seed=1616),
}


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("chapters", nargs="*", type=int, help="chapter numbers (default: all)")
    ap.add_argument("--out", default=f"{ROOT}/maps", help="output directory (default: assets/maps)")
    args = ap.parse_args()
    for n in args.chapters or sorted(SPECS):
        path, layout = write_map(SPECS[n], args.out)
        print(f"{os.path.relpath(path)}: {layout['direction']}, town {layout['townCols']}, maze {layout['mazeCols']}")


if __name__ == "__main__":
    main()
