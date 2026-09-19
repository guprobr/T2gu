// ============================================================================
// ShadowShine - Chapter 25: "The Second Door"
// ============================================================================
//
// Two parts: the TOWN comes first, the MAZE after it. This level runs right to left
// (the hero spawns against the east edge). Map: 182x102, tileset dirt_grass, lighting mystical.
//   - town   cols 133-180
//   - maze   cols 11-132, rows 1-100, corridors 2 wide, walls 3 thick
//   - pocket cols 1-10 (where the maze lets out)
// ============================================================================

// Deterministic PRNG - every generator below uses this instead of
// Math.random() so a level's layout is exactly reproducible. A duplicate-
// tile or player-blocking placement can then be caught once by the
// verification harness and trusted forever, instead of hoping every load
// gets lucky.
function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Builds a genuine branching maze (a recursive-backtracker spanning tree
// over a grid of "cells", plus a modest fraction of extra "braid" passages
// so there are real loops/multiple routes between some points, not just
// one unique corridor).
//
// Each cell is a corridorWidth x corridorWidth open block; cells are laid
// out on a cellSize = corridorWidth + wallWidth grid, with the gap between
// two adjacent cells either carved open (a passage) or left solid (a wall
// block).
//
// Every non-open tile is filled via `spawnProp`, split into two roles:
// `coreObstacles` (the bigger, more distinctive set-piece props) fill each
// wall block's *interior* - tiles with no open neighbor - one type per
// whole block, so the mass still reads as a deliberate, coherent cluster,
// not a tile-by-tile grab-bag. `edgeObstacles` (smaller, rougher-looking
// props) fill the *seam* tiles - anywhere a wall tile actually touches an
// open corridor tile - each rolled independently, so the boundary itself
// reads as an irregular, rough edge instead of one straight geometric line.
//
// Entrance/exit are simply openings through the west/east perimeter
// columns at one cell's row range each. Returns `cellCenters` (the open
// midpoint of every cell, including cells off the spanning tree's direct
// route) so callers can place NPCs/enemies on verified-open ground via
// sampleCells() below, instead of hand-computing coordinates.
function buildBranchingMaze(west, east, northRow, southRow, corridorWidth, wallWidth, coreObstacles, edgeObstacles, seed, options) {
    const rand = mulberry32(seed);
    // Optional, both off by default (a chapter that passes no `options` generates
    // exactly what it always did - the random stream is untouched):
    //   flip         - mirror the finished maze left/right, so the entrance is on the
    //                  EAST edge and the exit on the WEST (for right-to-left levels).
    //                  The maze is still built entrance-west internally; only the
    //                  columns handed to spawnProp() and the returned cell centers are
    //                  mirrored (west <-> east).
    //   diagonalSeam - also treat a wall tile that touches a corridor only DIAGONALLY
    //                  as a seam tile (small edge prop, not a big core set-piece).
    //                  Without it, a wide core prop (cliff_face is 680px) on a corner
    //                  tile has a collision footprint that spills ~1.3 tiles into the
    //                  corridor corner and can swallow a spawn point there.
    //   solid         - back every wall tile with an invisible full-tile barrier. A prop only
    //                  blocks a small footprint at its base (50% of its width by 18% of its
    //                  height), so a wall of props alone leaves a free slit through every
    //                  tile row - measured in the real engine, a bot walks a dead-straight
    //                  line through a whole shipped maze. `solid` makes the walls real.
    //   wallPrefix    - id prefix of the solid-wall barriers (default "mzwall_"). setBarrier ignores an id that
    //                  is already up, so a level that builds several mazes one after another gives each its own.
    const wallPrefix = (options && options.wallPrefix) || "mzwall_";
    const flip = !!(options && options.flip);
    const diagonalSeam = !!(options && options.diagonalSeam);
    const solid = !!(options && options.solid);
    const wallRects = [];
    const X = c => (flip ? west + east - c : c);
    const cellSize = corridorWidth + wallWidth;
    // Reserved two columns deep (not one) on each side, purely to pack more
    // props into the outer maze border - a single-tile-thick wall line reads
    // as thin no matter how it's filled, while a two-column band gives the
    // fringe obstacles (see fillBlock's edgeObstacles roll) room to actually
    // layer against the core set-piece obstacles behind them.
    const kOuterBorderDepth = 2;
    const innerWest = west + kOuterBorderDepth, innerEast = east - kOuterBorderDepth;
    const numCellsX = Math.max(1, Math.floor((innerEast - innerWest + 1) / cellSize));
    const numCellsY = Math.max(1, Math.floor((southRow - northRow + 1) / cellSize));

    const cellColStart = cx => innerWest + cx * cellSize;
    const cellRowStart = cy => northRow + cy * cellSize;
    // The last column/row absorbs any leftover remainder (when cellSize
    // doesn't evenly divide the zone) by extending all the way to the
    // zone's real boundary - a separate leftover-margin wall block would
    // otherwise isolate the exit from the rest of the maze.
    const cellColEnd = cx => (cx === numCellsX - 1 ? innerEast : cellColStart(cx) + corridorWidth - 1);
    const cellRowEnd = cy => (cy === numCellsY - 1 ? southRow : cellRowStart(cy) + corridorWidth - 1);

    const visited = Array.from({ length: numCellsX }, () => new Array(numCellsY).fill(false));
    const passageE = Array.from({ length: numCellsX }, () => new Array(numCellsY).fill(false));
    const passageS = Array.from({ length: numCellsX }, () => new Array(numCellsY).fill(false));

    function neighborsOf(cx, cy) {
        const list = [];
        if (cx > 0) list.push([cx - 1, cy, "W"]);
        if (cx < numCellsX - 1) list.push([cx + 1, cy, "E"]);
        if (cy > 0) list.push([cx, cy - 1, "N"]);
        if (cy < numCellsY - 1) list.push([cx, cy + 1, "S"]);
        return list;
    }
    function shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    // Recursive backtracker: a randomized depth-first spanning tree over
    // every cell - guarantees full connectivity by construction (a
    // spanning tree touches every node exactly once) while producing real
    // branches and dead ends, unlike a single wandering corridor.
    const startCx = 0, startCy = Math.floor(numCellsY / 2);
    const stack = [[startCx, startCy]];
    visited[startCx][startCy] = true;
    while (stack.length) {
        const [cx, cy] = stack[stack.length - 1];
        const unvisited = shuffle(neighborsOf(cx, cy)).filter(([nx, ny]) => !visited[nx][ny]);
        if (unvisited.length === 0) {
            stack.pop();
            continue;
        }
        const [nx, ny, dir] = unvisited[0];
        if (dir === "E") passageE[cx][cy] = true;
        else if (dir === "W") passageE[nx][ny] = true;
        else if (dir === "S") passageS[cx][cy] = true;
        else if (dir === "N") passageS[nx][ny] = true;
        visited[nx][ny] = true;
        stack.push([nx, ny]);
    }

    // Braid pass: open a modest fraction of the remaining (still-solid)
    // gaps too - purely additive on top of an already-fully-connected
    // spanning tree, so it can only ever add routes, never break
    // connectivity. This is what turns "many branches off one true path"
    // into "several genuinely different ways through."
    const braidChance = 0.15;
    for (let cx = 0; cx < numCellsX; cx++) {
        for (let cy = 0; cy < numCellsY; cy++) {
            if (cx < numCellsX - 1 && !passageE[cx][cy] && rand() < braidChance) passageE[cx][cy] = true;
            if (cy < numCellsY - 1 && !passageS[cx][cy] && rand() < braidChance) passageS[cx][cy] = true;
        }
    }

    const exitCy = Math.floor(numCellsY / 2);

    const open = new Set();
    function openRect(c0, r0, c1, r1) {
        for (let r = r0; r <= r1; r++)
            for (let c = c0; c <= c1; c++)
                open.add(`${c},${r}`);
    }
    for (let cx = 0; cx < numCellsX; cx++) {
        for (let cy = 0; cy < numCellsY; cy++) {
            openRect(cellColStart(cx), cellRowStart(cy), cellColEnd(cx), cellRowEnd(cy));
            if (passageE[cx][cy])
                openRect(cellColEnd(cx) + 1, cellRowStart(cy), cellColStart(cx + 1) - 1, cellRowEnd(cy));
            if (passageS[cx][cy])
                openRect(cellColStart(cx), cellRowEnd(cy) + 1, cellColEnd(cx), cellRowStart(cy + 1) - 1);
        }
    }
    // Carve the entrance/exit through the FULL outer border depth now, not
    // just the single outermost column - otherwise the second border column
    // stays solid and seals the maze shut.
    openRect(west, cellRowStart(startCy), west + kOuterBorderDepth - 1, cellRowEnd(startCy));
    openRect(east - kOuterBorderDepth + 1, cellRowStart(exitCy), east, cellRowEnd(exitCy));

    function isOpenAt(c, r) { return open.has(`${c},${r}`); }
    // A wall tile touching at least one open (4-directional) neighbor sits
    // right on the seam between wall and corridor - fill those with a
    // freshly-rolled small prop each, not the block's shared big type.
    function isSeamWall(c, r) {
        if (isOpenAt(c - 1, r) || isOpenAt(c + 1, r) || isOpenAt(c, r - 1) || isOpenAt(c, r + 1))
            return true;
        return diagonalSeam && (isOpenAt(c - 1, r - 1) || isOpenAt(c + 1, r - 1) || isOpenAt(c - 1, r + 1) || isOpenAt(c + 1, r + 1));
    }

    // Renders one contiguous non-open rectangle as a coherent core cluster
    // (one obstacle type for the whole block's interior) with a rough,
    // independently-rolled small-prop fringe wherever it actually meets a
    // corridor tile.
    function fillBlock(c0, r0, c1, r1) {
        if (c0 > c1 || r0 > r1) return;
        if (solid) {
            // The non-open tiles of this block as rectangles: runs along each row, then
            // identical runs on consecutive rows merged into one.
            let active = new Map();
            for (let r = r0; r <= r1 + 1; r++) {
                const next = new Map();
                for (let c = c0; r <= r1 && c <= c1; c++) {
                    if (isOpenAt(c, r)) continue;
                    let c2 = c;
                    while (c2 + 1 <= c1 && !isOpenAt(c2 + 1, r)) c2++;
                    const key = c + "," + c2;
                    next.set(key, active.has(key) ? active.get(key) : { c0: c, c1: c2, r0: r, r1: r });
                    next.get(key).r1 = r;
                    c = c2;
                }
                active.forEach((rect, key) => { if (!next.has(key)) wallRects.push(rect); });
                active = next;
            }
        }
        const coreType = coreObstacles[Math.floor(rand() * coreObstacles.length)];
        for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
                if (isOpenAt(c, r)) continue;
                if (isSeamWall(c, r))
                    api.spawnProp(edgeObstacles[Math.floor(rand() * edgeObstacles.length)], X(c), r);
                else
                    api.spawnProp(coreType, X(c), r);
            }
        }
    }
    for (let cx = 0; cx < numCellsX; cx++) {
        for (let cy = 0; cy < numCellsY; cy++) {
            if (cx < numCellsX - 1)
                fillBlock(cellColEnd(cx) + 1, cellRowStart(cy), cellColStart(cx + 1) - 1, cellRowEnd(cy));
            if (cy < numCellsY - 1)
                fillBlock(cellColStart(cx), cellRowEnd(cy) + 1, cellColEnd(cx), cellRowStart(cy + 1) - 1);
            if (cx < numCellsX - 1 && cy < numCellsY - 1)
                fillBlock(cellColEnd(cx) + 1, cellRowEnd(cy) + 1, cellColStart(cx + 1) - 1, cellRowStart(cy + 1) - 1);
        }
    }
    // Perimeter columns, one block per contiguous run of wall rows (so a
    // long unbroken run of west/east border still reads as one thing, not
    // dozens of single-tile obstacles).
    function fillPerimeterColumn(col) {
        let r = northRow;
        while (r <= southRow) {
            if (open.has(`${col},${r}`)) { r++; continue; }
            let r2 = r;
            while (r2 + 1 <= southRow && !open.has(`${col},${r2 + 1}`)) r2++;
            fillBlock(col, r, col, r2);
            r = r2 + 1;
        }
    }
    for (let d = 0; d < kOuterBorderDepth; d++) {
        fillPerimeterColumn(west + d);
        fillPerimeterColumn(east - d);
    }

    wallRects.forEach((rect, k) => {
        const firstCol = flip ? west + east - rect.c1 : rect.c0;   // mirrored like every prop
        api.setBarrier(wallPrefix + k, firstCol, rect.r0, rect.c1 - rect.c0 + 1, rect.r1 - rect.r0 + 1, true);
    });

    const cellCenters = [];
    for (let cx = 0; cx < numCellsX; cx++)
        for (let cy = 0; cy < numCellsY; cy++)
            cellCenters.push({
                col: X(Math.round((cellColStart(cx) + cellColEnd(cx)) / 2)),
                row: Math.round((cellRowStart(cy) + cellRowEnd(cy)) / 2),
            });
    // Where the maze opens onto the outside (row ranges, same either way round) -
    // lets a caller line a gate, road or river crossing up with the openings.
    cellCenters.entranceRows = [cellRowStart(startCy), cellRowEnd(startCy)];
    cellCenters.exitRows = [cellRowStart(exitCy), cellRowEnd(exitCy)];
    return cellCenters;
}

// Picks `count` DISTINCT cells at random from a branching maze's own
// `cellCenters` list, without replacement - placements can never collide
// with each other by construction, unlike sampling positions independently.
function sampleCells(cellCenters, count, seed) {
    const rand = mulberry32(seed);
    const pool = cellCenters.slice();
    const picked = [];
    for (let i = 0; i < count && pool.length > 0; i++) {
        const idx = Math.floor(rand() * pool.length);
        picked.push(pool[idx]);
        pool.splice(idx, 1);
    }
    return picked;
}

// Scatters `count` props across a zone as several small same-type CLUMPS
// (3-5 props apiece) rather than one prop at a time cycling through every
// name in turn. Clump centers are sampled within the ELLIPSE inscribed in
// [colStart,colEnd]x[rowStart,rowEnd] (keeping the four corners empty, a
// rounded/organic footprint); each clump then jitters its own props
// tightly around its center. `seed` keeps it deterministic and call-site-
// specific. `avoid` is an optional list of {col,row} points (hand-placed
// NPCs/enemies/items sharing the same zone) to steer clear of.
function scatterOrganic(names, colStart, colEnd, rowStart, rowEnd, count, seed, avoid) {
    const rand = mulberry32(seed);
    const cx = (colStart + colEnd) / 2, cy = (rowStart + rowEnd) / 2;
    const rx = (colEnd - colStart) / 2, ry = (rowEnd - rowStart) / 2;
    const placed = (avoid || []).slice();
    const startLen = placed.length;
    const minGapSq = 4; // keep any two points at least ~2 tiles apart
    let attempts = 0;
    while (placed.length - startLen < count && attempts < count * 60) {
        attempts++;
        const angle = rand() * Math.PI * 2;
        const radius = Math.sqrt(rand()); // sqrt -> uniform density across the disk, not clustered at the center
        const clumpCol = cx + Math.cos(angle) * radius * rx;
        const clumpRow = cy + Math.sin(angle) * radius * ry;
        const type = names[Math.floor(rand() * names.length)];
        const clumpSize = Math.min(3 + Math.floor(rand() * 3), count - (placed.length - startLen));

        for (let k = 0; k < clumpSize; k++) {
            attempts++;
            const jitterAngle = rand() * Math.PI * 2;
            const jitterRadius = rand() * 2.2; // tight - a clump, not another scattered zone
            const col = Math.round(clumpCol + Math.cos(jitterAngle) * jitterRadius);
            const row = Math.round(clumpRow + Math.sin(jitterAngle) * jitterRadius);
            if (col < colStart || col > colEnd || row < rowStart || row > rowEnd) continue;
            if (placed.some(p => (p.col - col) ** 2 + (p.row - row) ** 2 < minGapSq)) continue;
            placed.push({ col, row });
            api.spawnProp(type, col, row);
        }
    }
}

// ---- Layout (from the map spec - the same numbers are stored in the map's own "layout" field) ----
const W = 182, H = 102;
const DIR = -1;                        // -1: this level runs right -> left
const START_U = 3;                        // the hero spawns this many columns in from the start edge
const MID = 51;                        // row of the road that leads to the maze gate
const TOWN_U = 48;                        // the town fills u = 1..TOWN_U (u counts from the start edge)
const MAZE_WEST = 11, MAZE_EAST = 132;   // absolute columns of the maze block
const MAZE_NORTH = 1, MAZE_SOUTH = 100;        // its rows
const MAZE_CORRIDOR = 2, MAZE_WALL = 3;
const POCKET_U0 = 171, POCKET_U1 = 180;   // the exit pocket beyond the maze (u), 10 columns

// ============================================================================
// Two-part level shape helpers: the TOWN comes first, the MAZE after it.
// (Identical in every chapter script written in this shape.)
// ============================================================================
// `u` is a column counted from the START edge of the level (u = 0 is the border
// column the hero spawns against), so one description works for a level that
// runs left-to-right (DIR = 1) and one that runs right-to-left (DIR = -1).
function colAt(u) { return DIR > 0 ? u : W - 1 - u; }

// Where a cell sits along the maze: 0 at the entrance .. 1 at the exit.
function mazeProgress(cell) {
    const along = DIR > 0 ? cell.col - MAZE_WEST : MAZE_EAST - cell.col;
    return along / (MAZE_EAST - MAZE_WEST);
}

// Removes and returns up to `count` distinct cells from `pool` whose maze
// progress lies in [from, to]. Always consumes the same cells for the same
// seed, whether or not the caller ends up spawning anything on them - so a
// reload that skips a spawn-once guard still lines every later placement up.
function takeCells(pool, from, to, count, seed) {
    const rand = mulberry32(seed);
    const picked = [];
    for (let n = 0; n < count; n++) {
        const eligible = [];
        for (let k = 0; k < pool.length; k++) {
            const p = mazeProgress(pool[k]);
            if (p >= from && p <= to)
                eligible.push(k);
        }
        if (eligible.length === 0)
            break;
        const k = eligible[Math.floor(rand() * eligible.length)];
        picked.push(pool[k]);
        pool.splice(k, 1);
    }
    return picked;
}

// [[propName, u, rowOffsetFromTheRoad], ...] -> props. Rows are relative to
// MID, the row of the road that leads into the maze gate.
function placeProps(list) {
    list.forEach(([name, u, dr]) => api.spawnProp(name, colAt(u), MID + dr));
}

// An invisible barrier across the maze's exit opening (raise it with
// blocked = true, lift it with false).
function setExitGate(id, exitRows, blocked) {
    const firstCol = DIR > 0 ? MAZE_EAST - 1 : MAZE_WEST;   // the exit passes through the 2-deep border
    api.setBarrier(id, firstCol, exitRows[0], 2, exitRows[1] - exitRows[0] + 1, blocked);
}

// Companions follow the hero from chapter to chapter only if this puts them
// back - a loadLevel() wipes everything except vars and inventory.
function respawnCompanions() {
    if (api.getGlobalVar("vigil_recruited", false))
        api.spawnCharacter("dark_knight", colAt(START_U + 1), MID, 70);
    if (api.getGlobalVar("cobb_recruited", false))
        api.spawnCharacter("dwarf_miner", colAt(START_U + 2), MID, 75);
    if (api.getGlobalVar("vex_recruited", false))
        api.spawnCharacter("cyber_engineer", colAt(START_U + 3), MID, 70);
    if (api.getGlobalVar("nettle_recruited", false))
        api.spawnCharacter("cyber_medic", colAt(START_U + 4), MID, 70);
}

// A companion's aside, only if they've actually been recruited.
function* companionSays(flag, who, line) {
    if (api.getGlobalVar(flag, false))
        yield api.say(who, line);
}

// Spawns hostile packs onto `spots`, in order, exactly once per playthrough
// (guarded by a chapter-local var so a reload doesn't double the population).
// packs: [[archetype, count, hp], ...]
function spawnPacks(spots, packs, guardVar) {
    if (api.getVar(guardVar, false))
        return;
    api.setVar(guardVar, true);
    let k = 0;
    packs.forEach(([type, count, hp]) => {
        for (let n = 0; n < count && k < spots.length; n++, k++)
            api.spawnEnemy(type, spots[k].col, spots[k].row, hp);
    });
}

// Spawns world pickups onto `spots`, once (same guard idea as spawnPacks).
function spawnLoot(spots, itemIds, guardVar) {
    if (api.getVar(guardVar, false))
        return;
    api.setVar(guardVar, true);
    itemIds.forEach((id, k) => { if (spots[k]) api.spawnItem(id, spots[k].col, spots[k].row); });
}

// The pocket beyond the maze as an absolute column range.
function pocketCols() {
    const a = colAt(POCKET_U0), b = colAt(POCKET_U1);
    return [Math.min(a, b), Math.max(a, b)];
}


// ----------------------------------------------------------------------------
// Chapter 25 - "The Second Door" (dirt_grass, mystical). Runs RIGHT to LEFT. The
// last place on the Quiet Road: a threshold village where travellers wait
// before a door, then the Approach - a long maze of lawns and ruined walls under
// a shifting glow - and at its far end, the Second Door.
//
// QUEST (a three-form boss): the Doorkeeper holds the Second Door in three forms,
// one after the other, in the last stretch before the exit gate: its BODY (a
// war-engine), its VOICE (a necromancer) and its MEMORY (a crystal spirit). Each
// form spawns where the last one fell, and each speaks, quoting back choices the
// hero made in earlier chapters: the chord carried into the Long Room (chapter 16),
// whether the guilds made peace (21), and whether an innocent was ever accused (24).
// When the third form falls the gate lifts. The chapter, and the run so far,
// end on a hook: there is no chapter 26, so nothing is loaded.
// ----------------------------------------------------------------------------
const TOWN = [
    ["dovecote", 4, 18],
    ["wheelbarrow", 4, 37],
    ["haystack", 5, -41],
    ["bush", 8, -40],
    ["haystack", 8, 42],
    ["wheelbarrow", 9, -21],
    ["bench", 11, -40],
    ["wheelbarrow", 12, -35],
    ["fence_straight", 12, 37],
    ["rocks_small", 13, -22],
    ["oak_tree", 13, 33],
    ["castle_gate_tower", 15, -19],
    ["castle_gate_tower", 15, -8],
    ["cottage_b", 16, -44],
    ["cottage_a", 16, -14],
    ["fence_straight", 16, 29],
    ["wildflowers", 16, 41],
    ["tree_stump", 16, 43],
    ["bush", 17, -38],
    ["oak_tree", 19, -45],
    ["wheelbarrow", 19, -35],
    ["bush", 19, -13],
    ["bench", 20, 3],
    ["chapel", 20, 14],
    ["ancient_obelisk", 24, -4],
    ["notice_board", 28, -3],
    ["oak_tree", 28, 3],
    ["rocks_small", 29, -41],
    ["oak_tree", 30, -48],
    ["stone_fireplace", 30, 20],
    ["cottage_b", 30, 24],
    ["haystack", 30, 27],
    ["market_stall", 31, -39],
    ["tree_stump", 31, -26],
    ["windmill", 32, -43],
    ["cart", 32, -22],
    ["bench", 32, 46],
    ["berry_bush", 33, -35],
    ["haystack", 34, 31],
    ["haystack", 35, 35],
    ["bench", 35, 47],
    ["bench", 36, -46],
    ["berry_bush", 36, -25],
    ["berry_bush", 36, -21],
    ["wildflowers", 36, 10],
    ["tree_stump", 36, 23],
    ["oak_tree", 37, 13],
    ["rocks_small", 37, 45],
    ["bush", 39, -13],
    ["haystack", 39, 32],
    ["rocks_small", 40, 46],
    ["wildflowers", 41, -47],
    ["oak_tree", 41, 26],
    ["fence_straight", 42, -44],
    ["cottage_a", 42, -8],
    ["ley_light_wisp_cluster", 42, -3],
    ["berry_bush", 43, -5],
    ["bench", 43, 13],
    ["fence_straight", 44, -38],
    ["berry_bush", 44, -36],
    ["wildflowers", 44, -29],
    ["rocks_small", 45, 13],
    ["tree_stump", 46, -18],
    ["fence_straight", 46, -16],
    ["wheelbarrow", 46, -6],
    ["bush", 46, 45]
];
// boss forms in order: [roster key, hp, name]
const FORMS = [["mech_red_spider_tank", 220, "Body"], ["necromancer", 200, "Voice"], ["crystal_spirit", 240, "Memory"]];
const KEEPSAKES = [["clerks_stamp", "the stamp"], ["keepers_ring", "the ring"], ["reeves_ledger", "the ledger"], ["sluice_wheel", "the wheel"],
                   ["peace_banner", "the banner"], ["first_coin", "the coin"], ["surveyors_star", "the star"], ["chapel_clapper", "the clapper"]];
let bossCell = null;

function* onLevelStart() {
    api.spawnCharacter("lara_cyber", colAt(START_U), MID);
    api.giveControl("lara_cyber");
    respawnCompanions();

    buildTown();
    const exitRows = buildMaze();
    buildPocket();
    if (!api.getVar("door_open", false)) {
        setExitGate("second_door", exitRows, true);
        // Enemies do not survive a reload, so the Doorkeeper comes back in whatever form it had reached.
        const phase = api.getVar("boss_phase", 0);
        if (phase < FORMS.length)
            api.spawnEnemy(FORMS[phase][0], bossCell.col, bossCell.row, FORMS[phase][1]);
    }

    if (api.getVar("chapter25_intro_seen", false))
        return;
    api.setVar("chapter25_intro_seen", true);

    yield api.wait(0.6);
    yield api.say("Lara", "The last village on the road. I knew it the moment I saw it - everyone here is facing the same direction, the way people do in a station, or a church.");
    yield* companionSays("vigil_recruited", "Vigil", "I have kept every watch I was given. I would like to keep this one well.");
    yield* companionSays("cobb_recruited", "Cobb", "Whatever's behind that door - I'm a dwarf and a stubborn one. It'll have to go through me first.");
    yield* companionSays("vex_recruited", "Vex", "Nine places, nine keepsakes. I have a hypothesis about the pattern. I would prefer to be wrong.");
    yield* companionSays("nettle_recruited", "Nettle", "Eat something first. All of you. A door is easier on a full stomach.");
    yield api.say("Hint", "This level runs right to left. The town is behind you; the Approach is ahead, to the west, and the Second Door is at the far end of it.");
}

function buildTown() {
    placeProps(TOWN);
    api.spawnProp("signpost", colAt(TOWN_U - 1), MID - 3);
    api.spawnProp("ley_light_wisp_cluster", colAt(TOWN_U), MID + 4);

    api.spawnNpc("elf_archer", colAt(14), MID - 3);         // Sylva, the door-watcher
    api.spawnNpc("herbalist", colAt(24), MID + 5);          // Sorrel
    api.spawnNpc("dwarf_warrior", colAt(10), MID + 6);      // Captain Brann
    api.spawnNpc("gnome_wizard", colAt(30), MID - 5);       // the Archivist

    if (api.getVar("town_loot_spawned", false))
        return;
    api.setVar("town_loot_spawned", true);
    api.spawnItem("health_potion", colAt(6), MID - 9);
    api.spawnItem("health_potion", colAt(28), MID + 11);
    api.spawnItem("health_potion", colAt(34), MID - 12);
    api.spawnItem("health_potion", colAt(13), MID + 14);
    api.spawnItem("honey_jar", colAt(20), MID - 10);
}

function buildMaze() {
    const core = ["oak_tree", "pine_tree", "boulder_large", "stone_wall_corner", "ruined_chapel", "broken_arcane_statue"];
    const edge = ["bush", "wildflowers", "rocks_small", "tree_stump", "ley_light_wisp_cluster", "mushroom_cluster"];
    const cells = buildBranchingMaze(MAZE_WEST, MAZE_EAST, MAZE_NORTH, MAZE_SOUTH, MAZE_CORRIDOR, MAZE_WALL,
        core, edge, 252501, { flip: DIR < 0, diagonalSeam: true, solid: true });
    const pool = cells.slice();

    bossCell = takeCells(pool, 0.90, 0.97, 1, 252502)[0];

    spawnPacks(takeCells(pool, 0.06, 0.88, 48, 252503),
        [["orc", 8, 45], ["troll", 4, 60], ["wraith", 8, 45], ["lizardman", 8, 45], ["imp", 8, 30], ["mech_spider", 6, 35], ["ghoul", 6, 35]],
        "maze_hostiles_spawned");

    spawnLoot(takeCells(pool, 0.05, 0.92, 14, 252510),
        ["health_potion", "health_potion", "health_potion", "health_potion", "health_potion", "health_potion",
         "health_potion", "health_potion", "mana_potion", "mana_potion", "elixir_of_clarity", "stamina_draught", "antidote_vial", "reinforced_boots"],
        "maze_loot_spawned");
    return cells.exitRows;
}

function buildPocket() {
    const [c0, c1] = pocketCols();
    scatterOrganic(["ancient_obelisk", "ley_light_wisp_cluster", "broken_arcane_statue", "oak_tree"], c0, c1, MAZE_NORTH + 2, MAZE_SOUTH - 2, 8, 252520,
        [{ col: colAt(POCKET_U0 + 5), row: MID }]);
    if (!api.getVar("key_spawned", false)) {
        api.setVar("key_spawned", true);
        api.spawnItem("second_door_key", colAt(POCKET_U0 + 5), MID);
    }
}

function* onTalkTo(name) {
    const lines = {
        elf_archer: ["I have watched that door from this rooftop for six years. It has never once opened. It has never once been closed, either. It is only ever waiting.",
                     "Whatever holds it does not fight like the others. It changes. When you think you've beaten it, it isn't done. Be ready for a second wind - and a third."],
        herbalist: ["Eat. Drink. Rest in the shade. I say that to everyone who comes through and I've never once been thanked. I say it anyway.",
                    "The Approach has a hundred hiding places for a bad night. Don't sit in any of them. Keep going west."],
        dwarf_warrior: ["A door that asks and doesn't open is the worst kind. I've stood at three of them. None was worth the shield it cost me.",
                        "The forms it takes - engine, voice, memory - it takes each in turn. Don't go in half-healed. It won't wait for you to catch your breath."],
        gnome_wizard: ["I've catalogued nine keepsakes on the road. I've a page for each. If you've been carrying them, you'll know what they weigh.",
                       "The key at the end has no teeth. It isn't for the door. The door was made to ask for it. That is my whole theory and I've never dared say it aloud."],
    }[name];
    if (!lines)
        return;
    const displayName = { elf_archer: "Sylva", herbalist: "Sorrel", dwarf_warrior: "Captain Brann", gnome_wizard: "Archivist" }[name];
    const n = api.getVar("talk_" + name, 0);
    api.setVar("talk_" + name, n + 1);
    api.playSound("select");
    yield api.say(displayName, lines[n % lines.length]);
}

function keepsakesHeld() {
    return KEEPSAKES.filter(k => api.hasItem(k[0])).length;
}

// The next form appears where the last one fell, with a potion left for the fight ahead.
function nextForm(phase) {
    api.spawnEnemy(FORMS[phase][0], bossCell.col, bossCell.row, FORMS[phase][1]);
    api.spawnItem("health_potion", bossCell.col, bossCell.row);
}

function* onEnemyDefeated(name) {
    const phase = api.getVar("boss_phase", 0);
    if (!api.getVar("door_open", false) && phase < FORMS.length && name === FORMS[phase][0]) {
        api.setVar("boss_phase", phase + 1);
        api.giveExperience(80);
        if (phase === 0) {
            nextForm(1);
            yield api.wait(0.5);
            yield api.say("Lara", "The engine came apart like a clock. And out of the wreck, something stepped that had never been made of metal at all.");
            yield api.say("Doorkeeper", "*a voice like a very old hymn, sung quietly* That was only what I wear. This is what I say.");
            const held = keepsakesHeld();
            yield api.say("Doorkeeper", "You carry " + held + " of the eight keepsakes the road has given you. " + (held >= 8 ? "All of them. Even the coin that was never spent." : "Not all - but a road is not an examination."));
            const notes = api.getGlobalVar("chord_notes", -1);
            if (notes >= 9)
                yield api.say("Doorkeeper", "And in the Long Room you sounded nine notes, a full chord, and the door there opened for you gladly. I remember it. It was the first sound I had heard in years.");
            else if (notes >= 0)
                yield api.say("Doorkeeper", "And in the Long Room you sounded " + notes + " notes of nine. A chord with gaps. I remember it. I have been humming the gaps ever since.");
            yield* companionSays("vex_recruited", "Vex", "It has read our whole journey off us. That is not an attack, it is a citation.");
        } else if (phase === 1) {
            nextForm(2);
            yield api.wait(0.5);
            yield api.say("Lara", "The voice went quiet, and the air behind it took a shape I know. Not a monster. A light with a face in it.");
            yield api.say("Doorkeeper", "*gentle, and slower now* And this is what I remember. Would you like to hear it?");
            if (api.getGlobalVar("guilds_at_peace", false))
                yield api.say("Doorkeeper", "I remember two guilds sitting down at one table, because a stranger went back for the second colour. I have kept that. I keep very few things.");
            else
                yield api.say("Doorkeeper", "I remember two guilds and a grey stripe of cloth where the second colour should have been. I have kept that too. It is a good stripe.");
            const wrong = api.getGlobalVar("inquest_wrong", 0);
            if (wrong > 0)
                yield api.say("Doorkeeper", "And a court where the wrong person was named " + (wrong === 1 ? "once" : wrong + " times") + ". You carried it up the hill and did not put it down. I remember that most of all.");
            else
                yield api.say("Doorkeeper", "And a court where the thief was found by listening. It is the only trick there is, and you knew it.");
        } else {
            api.setVar("door_open", true);
            api.setBarrier("second_door", 0, 0, 1, 1, false);
            api.giveExperience(200);
            yield api.wait(0.6);
            yield api.say("Doorkeeper", "*the light thins to a thread and holds* ...That is all I was made to ask. Whoever I was keeping the door for - I think it is you.");
            yield api.say("Lara", "The Second Door is unbarred. I can hear the last of the chain from here.");
            yield* companionSays("vigil_recruited", "Vigil", "It kept its watch to the end. I would like to think I would have done as well.");
            yield* companionSays("cobb_recruited", "Cobb", "A door with three faces and a kind heart. I'll not forget it, and I'll not say so twice.");
        }
        return;
    }
    if (Math.random() > 0.1)
        return;
    if (name === "wraith") {
        yield api.wait(0.3);
        yield api.say("Lara", "It didn't fight so much as recite. Every one of them out here has been saying the same thing for years.");
    } else if (name === "ghoul") {
        yield api.wait(0.3);
        yield api.say("Lara", "It stopped at the end like it had finished a sentence.");
    }
}

function* onItemCollected(itemId) {
    if (itemId !== "second_door_key")
        return;
    yield api.wait(0.3);
    yield api.say("Lara", "A key with no teeth. It is warm, and it hums - the first hum since the Long Room. Not the old one. This one is a note held on purpose.");
    yield api.say("???", "Ninth of nine. It doesn't open the door, you know. The door was made to ask for it. It only wants to be handed the thing that proves someone came all this way.");
    yield api.say("Lara", "You've been waiting a long time.");
    yield api.say("???", "Longer than the road. But I will tell you a small thing, Lara, and you may keep it: I was not lonely. I was only early.");
    yield api.say("Lara", "The Second Door is standing open. There is a light beyond it, and it is steady, and a shape in it is turning around.");
    yield api.say("Lara", "I couldn't tell you afterwards what I saw. Only that I had expected them to look older - and that I knew them at once.");
    yield* companionSays("nettle_recruited", "Nettle", "Lara. Whoever they are - we walked nine places to get here. Nobody is walking the last step alone.");
    api.setGlobalVar("chapter", 26);
    api.setGlobalVar("second_arc_complete", true);
    api.playSound("select");
    // No loadLevel(): there is no chapter 26 yet. The story stops here, on an open door and a turning figure.
}
