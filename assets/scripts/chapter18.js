// ============================================================================
// ShadowShine - Chapter 18: "The Keepwalk"
// ============================================================================
//
// Two parts: the TOWN comes first, the MAZE after it. This level runs left to right
// (the hero spawns against the west edge). Map: 166x90, tileset haunted_cobble_grass, lighting cavern.
//   - town   cols 1-44
//   - maze   cols 45-154, rows 0-89, corridors 2 wide, walls 4 thick
//   - pocket cols 155-164 (where the maze lets out)
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
const W = 166, H = 90;
const DIR = 1;                        // 1: this level runs left -> right
const START_U = 3;                        // the hero spawns this many columns in from the start edge
const MID = 42;                        // row of the road that leads to the maze gate
const TOWN_U = 44;                        // the town fills u = 1..TOWN_U (u counts from the start edge)
const MAZE_WEST = 45, MAZE_EAST = 154;   // absolute columns of the maze block
const MAZE_NORTH = 0, MAZE_SOUTH = 89;        // its rows
const MAZE_CORRIDOR = 2, MAZE_WALL = 4;
const POCKET_U0 = 155, POCKET_U1 = 164;   // the exit pocket beyond the maze (u), 10 columns

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
// Chapter 18 - "The Keepwalk" (haunted_cobble_grass, cavern). Runs LEFT to
// RIGHT. A cobbled bailey under a keep, then the Undercroft - a maze of vaults
// with TWO LOCKED DOORS built into it.
//
// QUEST (keys and doors): the Undercroft is built as THREE consecutive mazes
// (buildBranchingMaze called once per stage, each with its own wall-barrier
// prefix), so every stage is connected on its own; a door stands in each seam.
// Each door has a Doorward who will open it for one key, and each key lies
// inside the stage BEFORE its own door, watched over by whatever was left to
// guard it. Bronze key -> first door -> silver key -> second door -> the way
// out. (One random maze cut by a wall would leave stranded fragments of the near
// side - the static check caught exactly that - which is why it is built in stages.)
// This chapter runs left to right only.
// ----------------------------------------------------------------------------
const TOWN = [
    ["bench", 4, -33],
    ["bush", 4, -27],
    ["bush", 4, 20],
    ["wooden_chest", 7, 31],
    ["rocks_small", 8, -38],
    ["barrels_crates", 8, 15],
    ["cart", 9, -22],
    ["fence_straight", 9, -17],
    ["tavern_bar_counter", 9, 23],
    ["stacked_ale_barrels", 10, -19],
    ["barrels_crates", 11, -25],
    ["rocks_small", 12, -27],
    ["cart", 12, -14],
    ["rain_barrel", 12, 36],
    ["bench", 12, 42],
    ["rocks_small", 15, -38],
    ["cart", 15, -26],
    ["stone_fireplace", 15, -10],
    ["bush", 15, 41],
    ["fence_straight", 16, -36],
    ["wooden_chest", 16, -16],
    ["castle_gate_tower", 18, -7],
    ["armory_rack", 18, 3],
    ["castle_gate_tower", 18, 10],
    ["wooden_chest", 18, 19],
    ["courtyard_well", 22, -4],
    ["notice_board", 26, -3],
    ["stacked_ale_barrels", 26, 3],
    ["chapel", 27, -27],
    ["cottage_a", 27, -20],
    ["armory_rack", 27, -17],
    ["rain_barrel", 27, -10],
    ["market_stall", 27, 44],
    ["cottage_b", 29, 20],
    ["rocks_small", 29, 23],
    ["stacked_ale_barrels", 29, 34],
    ["stacked_ale_barrels", 29, 40],
    ["barrels_crates", 31, -17],
    ["rocks_small", 31, 37],
    ["water_trough", 32, -28],
    ["cottage_a", 32, 29],
    ["bush", 33, -24],
    ["cart", 34, -16],
    ["barrels_crates", 34, 13],
    ["water_trough", 34, 18],
    ["water_trough", 35, -7],
    ["blacksmith_forge", 35, 24],
    ["cart", 36, -3],
    ["cart", 36, 12],
    ["bench", 37, -16],
    ["bush", 38, -21],
    ["standing_torch_sconce", 38, -3],
    ["barrels_crates", 38, 10],
    ["fence_straight", 38, 28],
    ["bench", 38, 41],
    ["rain_barrel", 39, -27],
    ["rain_barrel", 40, -38],
    ["water_trough", 40, -15],
    ["bench", 41, -19],
    ["fence_straight", 41, -4],
    ["wooden_chest", 42, -37],
    ["stacked_ale_barrels", 42, -21],
    ["rain_barrel", 42, 6],
    ["barrels_crates", 42, 30]
];
// Doorward NPC -> the barrier it opens, the key it wants, and how it speaks
const DOORS = {
    tribal_warrior_man: { id: "door_bronze", key: "keep_key_bronze", who: "Doorward Halric", metal: "bronze", next: "the second door, further in" },
    tribal_caveman_warrior: { id: "door_silver", key: "keep_key_silver", who: "Doorward Orn", metal: "silver", next: "the way out" },
};
let doorInfo = null;   // set by buildMaze: the two door columns and the rows of the openings they close

function* onLevelStart() {
    api.spawnCharacter("lara_cyber", colAt(START_U), MID);
    api.giveControl("lara_cyber");
    respawnCompanions();

    buildTown();
    buildMaze();
    buildPocket();
    // The doors go up on every load until their own quest var says they were opened.
    const doorH = doorInfo.rows[1] - doorInfo.rows[0] + 1;
    if (!api.getVar("door_bronze_open", false))
        api.setBarrier("door_bronze", doorInfo.bronzeCol, doorInfo.rows[0], 2, doorH, true);
    if (!api.getVar("door_silver_open", false))
        api.setBarrier("door_silver", doorInfo.silverCol, doorInfo.rows[0], 2, doorH, true);

    if (api.getVar("chapter18_intro_seen", false))
        return;
    api.setVar("chapter18_intro_seen", true);

    yield api.wait(0.6);
    yield api.say("Lara", "Cobbles, a gatehouse, a forge with its fire banked low. The bailey of a keep - and above us, the keep itself, with every window shuttered.");
    yield* companionSays("vex_recruited", "Vex", "The locks here are mechanical, not magical. Pin tumblers. That is a comfort, in its way - a pin tumbler cannot resent you.");
    yield* companionSays("vigil_recruited", "Vigil", "Someone locked these doors from the inside, and then left by another way. I know that kind of tiredness.");
    yield api.say("Hint", "This level runs left to right. The town is behind you; the Undercroft is ahead, to the east, and it has doors.");
}

function buildTown() {
    placeProps(TOWN);
    api.spawnProp("signpost", colAt(TOWN_U - 1), MID - 3);
    api.spawnProp("standing_torch_sconce", colAt(TOWN_U), MID + 4);

    api.spawnNpc("dwarf_warrior", colAt(14), MID - 3);      // Captain Brann
    api.spawnNpc("blacksmith", colAt(24), MID + 5);         // the Smith
    api.spawnNpc("innkeeper", colAt(10), MID + 6);          // the Landlord
    api.spawnNpc("elder", colAt(30), MID - 5);              // the Chaplain

    if (api.getVar("town_loot_spawned", false))
        return;
    api.setVar("town_loot_spawned", true);
    api.spawnItem("health_potion", colAt(6), MID - 9);
    api.spawnItem("bread_loaf", colAt(28), MID + 11);
    api.spawnItem("whetstone", colAt(34), MID - 12);
    api.spawnItem("health_potion", colAt(13), MID + 14);
}

function buildMaze() {
    const core = ["castle_wall_section", "stone_wall_corner", "stone_wall_corner_alt", "support_beam", "cave_in_rubble", "stalagmite_formation"];
    const edge = ["rocks_small", "cave_torch_sconce", "ivy_rock", "barrels_crates", "stalactite_cluster"];
    // Three stages side by side. Each is a whole maze with its entrance and exit on the same middle rows, so the
    // exit of one lines up with the entrance of the next; the door goes in that seam (like an exit gate).
    const third = Math.floor((MAZE_EAST - MAZE_WEST + 1) / 3);
    const stages = [[MAZE_WEST, MAZE_WEST + third - 1], [MAZE_WEST + third, MAZE_WEST + 2 * third], [MAZE_WEST + 2 * third + 1, MAZE_EAST]];
    const built = stages.map(([w, e], k) => buildBranchingMaze(w, e, MAZE_NORTH, MAZE_SOUTH, MAZE_CORRIDOR, MAZE_WALL,
        core, edge, 181801 + k * 7, { flip: DIR < 0, diagonalSeam: true, solid: true, wallPrefix: "mzwall_" + "abc"[k] + "_" }));
    const cells = built[0].concat(built[1], built[2]);
    const pool = cells.slice();
    const rows = built[0].exitRows;
    doorInfo = { bronzeCol: stages[0][1] - 1, silverCol: stages[1][1] - 1, rows };

    // Each Doorward waits in the last column of cells before its door: the row nearest the opening, but not the
    // opening's own cell (so the doorway stays clear).
    const wardCell = k => {
        const lastCol = Math.max(...built[k].map(c => c.col));
        const inMouth = c => c.row >= rows[0] - 1 && c.row <= rows[1] + 1;
        const cands = pool.filter(c => built[k].indexOf(c) >= 0 && c.col === lastCol && !inMouth(c))
            .sort((a, b) => Math.abs(a.row - MID) - Math.abs(b.row - MID));
        const cell = cands[0];
        pool.splice(pool.indexOf(cell), 1);
        return cell;
    };
    const ward1 = wardCell(0), ward2 = wardCell(1);
    api.spawnNpc("tribal_warrior_man", ward1.col, ward1.row);
    api.spawnNpc("tribal_caveman_warrior", ward2.col, ward2.row);

    // Each key lies inside the stage before its own door, with two guards left near it.
    const progressOf = col => (col - MAZE_WEST) / (MAZE_EAST - MAZE_WEST);
    const p1 = progressOf(stages[0][1]), p2 = progressOf(stages[1][1]);
    const key1 = takeCells(pool, 0.04, p1 - 0.02, 1, 181802)[0];
    const key2 = takeCells(pool, p1 + 0.03, p2 - 0.02, 1, 181803)[0];
    spawnLoot([key1, key2], ["keep_key_bronze", "keep_key_silver"], "keys_spawned");
    const guardsFor = spot => pool.map(c => ({ c, d: Math.hypot(c.col - spot.col, c.row - spot.row) }))
        .filter(x => x.d >= 4).sort((a, b) => a.d - b.d).slice(0, 2).map(x => x.c);
    if (!api.getVar("key_guards_spawned", false)) {
        api.setVar("key_guards_spawned", true);
        guardsFor(key1).forEach(g => api.spawnEnemy("orc", g.col, g.row, 50));
        guardsFor(key2).forEach(g => api.spawnEnemy("troll", g.col, g.row, 70));
    }

    spawnPacks(takeCells(pool, 0.06, 1.0, 44, 181804),
        [["skeleton_swordsman", 10, 35], ["skeleton_archer", 8, 30], ["mummy", 8, 45], ["ghoul", 8, 35], ["zombie_peasant", 10, 30]],
        "maze_hostiles_spawned");

    spawnLoot(takeCells(pool, 0.05, 0.95, 12, 181810),
        ["health_potion", "health_potion", "health_potion", "health_potion", "health_potion", "health_potion",
         "health_potion", "mana_potion", "elixir_of_clarity", "stamina_draught", "antidote_vial", "reinforced_boots"], "maze_loot_spawned");
    return built[2].exitRows;
}

function buildPocket() {
    const [c0, c1] = pocketCols();
    scatterOrganic(["stone_archway", "standing_torch_sconce", "stalagmite_formation", "support_beam"], c0, c1, MAZE_NORTH + 2, MAZE_SOUTH - 2, 8, 181820,
        [{ col: colAt(POCKET_U0 + 5), row: MID }]);
    if (!api.getVar("ring_spawned", false)) {
        api.setVar("ring_spawned", true);
        api.spawnItem("keepers_ring", colAt(POCKET_U0 + 5), MID);
    }
}

function* onTalkTo(name) {
    if (name === "dwarf_warrior") {
        yield* talkToCaptain();
    } else if (DOORS[name]) {
        yield* talkToDoorward(name);
    } else if (name === "blacksmith" || name === "innkeeper" || name === "elder") {
        yield* talkToTownsfolk(name);
    }
}

function* talkToCaptain() {
    const n = api.getVar("captain_talks", 0);
    api.setVar("captain_talks", n + 1);
    api.playSound("select");
    if (api.getVar("door_silver_open", false)) {
        yield api.say("Captain Brann", "Both doors open. I have not seen the far end of the Undercroft in nineteen years. Go on - and shut nothing behind you.");
    } else if (n === 0) {
        yield api.say("Captain Brann", "The Keepwalk. Once the keep's bailey, now the town that grew in its lee. The Undercroft below is where the old garrison kept everything worth stealing - and where they locked everything they were afraid of.");
        yield api.say("Captain Brann", "Two doors cross it. The bronze door about a third of the way in, the silver door two-thirds. Each has a Doorward who was told: open for the key, and for nothing else. They are very good at it.");
        yield api.say("Lara", "And the keys?");
        yield api.say("Captain Brann", "In the stretch before each door, guarded by whatever we left to guard them. The bronze key first, then the silver. You can't reach the silver key without the bronze door open - I have tried. Twice.");
    } else {
        yield api.say("Captain Brann", "Bronze key opens the first door, silver key the second. Each key lies before its own door. Bring plenty of potions - the guards were told to be thorough.");
    }
}

function* talkToDoorward(name) {
    const d = DOORS[name];
    api.playSound("select");
    if (api.getVar(d.id + "_open", false)) {
        yield api.say(d.who, "Door's open. I'll keep the post anyway. Somebody should.");
        return;
    }
    if (api.hasItem(d.key)) {
        api.removeItem(d.key, 1);
        api.setVar(d.id + "_open", true);
        api.setBarrier(d.id, 0, 0, 1, 1, false);
        api.giveExperience(80);
        yield api.say(d.who, "*he turns the " + d.metal + " key in the air, looks at the stamp on it, and nods once* That's the one. Stand back.");
        yield api.say(d.who, "*a long iron sound as the door swings inward along the whole width of the vault* Go on. " + d.next.charAt(0).toUpperCase() + d.next.slice(1) + " is yours.");
        yield* companionSays("vex_recruited", "Vex", "Pin tumbler, seven pins, bronze. Elegant. I would like to meet whoever made it, and I suspect they are long gone.");
        return;
    }
    const n = api.getVar("ward_talks_" + name, 0);
    api.setVar("ward_talks_" + name, n + 1);
    if (n === 0) {
        yield api.say(d.who, "This door opens for the " + d.metal + " key and for nothing else. Not a favour, not a fight. I was told that, and I was told that anyone who says otherwise is trying to get past me.");
        yield api.say("Lara", "And where is the key?");
        yield api.say(d.who, "Back the way you came, in the stretch before this door. Whatever was left to guard it will not be pleased to see you.");
    } else {
        yield api.say(d.who, "The " + d.metal + " key. Before this door, not after. Guarded.");
    }
}

function* talkToTownsfolk(name) {
    const lines = {
        blacksmith: ["I made half the locks in the Undercroft. Good locks. It's a strange thing, being proud of work whose entire purpose is to keep people out.",
                     "The bronze key wears green at the edges. That's how you know it's the true one. The silver ones stay bright, which makes them easier to fake."],
        innkeeper: ["The Undercroft draws a cold breath every evening. Warm soup, warm bed, warm words. That's the whole trade.",
                    "Nobody comes back from the Undercroft in a hurry. They come back thoughtful, mostly."],
        elder: ["A keep is a promise made of stone. This one was made in a hurry, by people who were sure of very little except that the dark was coming.",
                "Frightened people build the strongest doors. It's the gentlest ones that need opening."],
    }[name];
    const displayName = { blacksmith: "Smith", innkeeper: "Landlord", elder: "Chaplain" }[name];
    const n = api.getVar("talk_" + name, 0);
    api.setVar("talk_" + name, n + 1);
    api.playSound("select");
    yield api.say(displayName, lines[n % lines.length]);
}

function* onEnemyDefeated(name) {
    if (Math.random() > 0.1)
        return;
    if (name === "skeleton_archer") {
        yield api.wait(0.3);
        yield api.say("Lara", "Still nocking an arrow at the door it was told to watch. The door is behind me now.");
    } else if (name === "mummy") {
        yield api.wait(0.3);
        yield api.say("Lara", "Whoever was wrapped in these must have been very afraid of being found.");
    }
}

function* onItemCollected(itemId) {
    if (itemId !== "keepers_ring")
        return;
    yield api.wait(0.3);
    yield api.say("Lara", "An iron ring, two keys' worth of wear on it, and room for a third. It sits on my finger like it has been waiting for one.");
    yield api.say("???", "Second of nine. Keys are only trust, made small enough to carry. Whoever locked those doors was afraid, not cruel - remember that when you are the one holding the ring.");
    yield api.say("Lara", "You keep saying that. Like you've held one yourself.");
    yield api.say("???", "Once. It was heavier than I expected. Onward - a village of gold, now, that has forgotten what gold is for.");
    api.setGlobalVar("chapter", 19);
    api.playSound("select");
    yield api.wait(0.8);
    api.loadLevel("chapter19.json");
}
