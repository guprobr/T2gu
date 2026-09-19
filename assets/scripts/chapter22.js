// ============================================================================
// ShadowShine - Chapter 22: "The Barter Mile"
// ============================================================================
//
// Two parts: the TOWN comes first, the MAZE after it. This level runs left to right
// (the hero spawns against the west edge). Map: 168x90, tileset dirty_plate_asphalt, lighting sunset.
//   - town   cols 1-44
//   - maze   cols 45-156, rows 0-89, corridors 2 wide, walls 3 thick
//   - pocket cols 157-166 (where the maze lets out)
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
const W = 168, H = 90;
const DIR = 1;                        // 1: this level runs left -> right
const START_U = 3;                        // the hero spawns this many columns in from the start edge
const MID = 45;                        // row of the road that leads to the maze gate
const TOWN_U = 44;                        // the town fills u = 1..TOWN_U (u counts from the start edge)
const MAZE_WEST = 45, MAZE_EAST = 156;   // absolute columns of the maze block
const MAZE_NORTH = 0, MAZE_SOUTH = 89;        // its rows
const MAZE_CORRIDOR = 2, MAZE_WALL = 3;
const POCKET_U0 = 157, POCKET_U1 = 166;   // the exit pocket beyond the maze (u), 10 columns

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
// Chapter 22 - "The Barter Mile" (dirty_plate_asphalt, sunset). Runs LEFT to
// RIGHT. A market town of plate-steel stalls where nothing has a price - every
// deal is a swap - then the Mile itself, a maze of stalls and shutters under a
// low orange sun.
//
// QUEST (a barter chain): nobody on the Mile takes money, and nobody gives
// anything for nothing. Three swaps, in order, each done with a different trader:
//   1. the Tinker (town) trades a brass gear for a bundle of copper wire (lying about in town);
//   2. the Mystic (in the maze) trades a signal lens for the gear;
//   3. the Gate-drone (last stretch) opens the mile gate for the lens.
// ----------------------------------------------------------------------------
const TOWN = [
    ["wrecked_cart", 3, -28],
    ["data_pillar", 3, -14],
    ["ash_covered_barrels", 3, 12],
    ["salvage_pile", 3, 17],
    ["cyber_supply_crate", 3, 32],
    ["barrels_crates", 3, 34],
    ["rain_barrel", 4, -20],
    ["leaning_tenement", 5, -22],
    ["wrecked_cart", 5, 35],
    ["salvage_pile", 6, 16],
    ["crate_stack_cat", 6, 18],
    ["salvage_pile", 7, -26],
    ["data_pillar", 7, 25],
    ["street_water_pump", 7, 40],
    ["rain_barrel", 9, -20],
    ["crate_stack_cat", 11, -31],
    ["rain_barrel", 11, 37],
    ["signal_relay_mast", 14, 20],
    ["ash_covered_barrels", 14, 42],
    ["crate_tarp_shanty", 15, -39],
    ["salvage_pile", 16, -32],
    ["vendor_kiosk", 16, -20],
    ["cyber_supply_crate", 16, -10],
    ["patched_pushcart", 17, -12],
    ["data_pillar", 18, -41],
    ["cyber_supply_crate", 18, -39],
    ["cyber_supply_crate", 18, -25],
    ["holo_terminal", 18, 3],
    ["street_water_pump", 22, -4],
    ["vendor_kiosk", 26, -3],
    ["patched_pushcart", 26, 3],
    ["rain_barrel", 27, -38],
    ["crate_stack_cat", 27, 19],
    ["leaning_tenement", 27, 23],
    ["holo_terminal", 28, 38],
    ["patched_pushcart", 29, -10],
    ["patched_pushcart", 29, 30],
    ["barrels_crates", 30, -25],
    ["signal_relay_mast", 30, -19],
    ["street_water_pump", 31, 17],
    ["street_water_pump", 31, 31],
    ["poor_market_stall", 32, -26],
    ["data_pillar", 32, -22],
    ["salvage_pile", 32, -19],
    ["crate_stack_cat", 32, 5],
    ["street_water_pump", 32, 19],
    ["barrels_crates", 32, 37],
    ["ash_covered_barrels", 33, -36],
    ["wrecked_cart", 33, -17],
    ["vendor_kiosk", 33, 14],
    ["wrecked_cart", 35, -3],
    ["rain_barrel", 36, 19],
    ["crate_stack_cat", 36, 22],
    ["patched_pushcart", 36, 25],
    ["wrecked_cart", 37, -39],
    ["data_pillar", 37, -32],
    ["cyber_supply_crate", 38, -17],
    ["ash_covered_barrels", 38, 18],
    ["patched_pushcart", 39, -5],
    ["barrels_crates", 39, 31],
    ["cyber_supply_crate", 40, -32],
    ["ash_covered_barrels", 40, -8],
    ["street_water_pump", 40, 37],
    ["alley_lantern_post", 41, -3],
    ["crate_tarp_shanty", 41, 14],
    ["patched_pushcart", 42, 8],
    ["barrels_crates", 42, 26]
];

function* onLevelStart() {
    api.spawnCharacter("lara_cyber", colAt(START_U), MID);
    api.giveControl("lara_cyber");
    respawnCompanions();

    buildTown();
    const exitRows = buildMaze();
    buildPocket();
    if (!api.getVar("mile_open", false))
        setExitGate("mile_gate", exitRows, true);

    if (api.getVar("chapter22_intro_seen", false))
        return;
    api.setVar("chapter22_intro_seen", true);

    yield api.wait(0.6);
    yield api.say("Lara", "A mile of plate-steel stalls with the shutters half up and the awnings the colour of the sky. No price tags. Not one. Just people holding things out.");
    yield* companionSays("vex_recruited", "Vex", "A barter economy at this density is a distributed computation. Every swap is a comparison. I am delighted, and slightly afraid.");
    yield* companionSays("cobb_recruited", "Cobb", "Nobody takes coin. Good. Coin never did have any manners.");
    yield api.say("Hint", "This level runs left to right. The town is behind you; the Mile is ahead, to the east.");
}

function buildTown() {
    placeProps(TOWN);
    api.spawnProp("signpost", colAt(TOWN_U - 1), MID - 3);
    api.spawnProp("alley_lantern_post", colAt(TOWN_U), MID + 4);

    api.spawnNpc("gnome_inventor", colAt(14), MID - 3);     // the Tinker
    api.spawnNpc("merchant", colAt(24), MID + 5);           // the Hawker
    api.spawnNpc("cyber_rogue", colAt(10), MID + 6);        // Runner
    api.spawnNpc("android", colAt(30), MID - 5);            // Ledger

    if (api.getVar("town_loot_spawned", false))
        return;
    api.setVar("town_loot_spawned", true);
    api.spawnItem("copper_bundle", colAt(28), MID + 11);     // in the south alley
    api.spawnItem("health_potion", colAt(6), MID - 9);
    api.spawnItem("stamina_draught", colAt(34), MID - 12);
    api.spawnItem("repair_kit", colAt(13), MID + 14);
}

function buildMaze() {
    const core = ["crate_tarp_shanty", "salvage_pile", "leaning_tenement", "conduit_coil", "cyber_supply_crate", "data_pillar"];
    const edge = ["barrels_crates", "ash_covered_barrels", "crate_stack_cat", "rain_barrel", "patched_pushcart"];
    const cells = buildBranchingMaze(MAZE_WEST, MAZE_EAST, MAZE_NORTH, MAZE_SOUTH, MAZE_CORRIDOR, MAZE_WALL,
        core, edge, 222201, { flip: DIR < 0, diagonalSeam: true, solid: true });
    const pool = cells.slice();

    // The Mystic sits about half-way along; the Gate-drone waits in the last stretch, on the near side of the gate.
    const mystic = takeCells(pool, 0.42, 0.58, 1, 222202)[0];
    const drone = takeCells(pool, 0.92, 0.98, 1, 222203)[0];
    api.spawnNpc("cyber_mystic", mystic.col, mystic.row);
    api.spawnNpc("mech_stealth_fighter", drone.col, drone.row);

    spawnPacks(takeCells(pool, 0.06, 0.90, 38, 222204),
        [["goblin", 10, 30], ["imp", 8, 30], ["slime_bronze", 8, 30], ["cyber_brawler", 6, 45], ["mech_spider", 6, 35]],
        "maze_hostiles_spawned");

    spawnLoot(takeCells(pool, 0.05, 0.95, 12, 222210),
        ["health_potion", "health_potion", "health_potion", "health_potion", "health_potion", "health_potion",
         "health_potion", "mana_potion", "tech_gauntlet", "silver_coin_pouch", "elixir_of_clarity", "stamina_draught"], "maze_loot_spawned");
    return cells.exitRows;
}

function buildPocket() {
    const [c0, c1] = pocketCols();
    scatterOrganic(["vendor_kiosk", "alley_lantern_post", "salvage_pile", "data_pillar"], c0, c1, MAZE_NORTH + 2, MAZE_SOUTH - 2, 8, 222220,
        [{ col: colAt(POCKET_U0 + 5), row: MID }]);
    if (!api.getVar("coin_spawned", false)) {
        api.setVar("coin_spawned", true);
        api.spawnItem("first_coin", colAt(POCKET_U0 + 5), MID);
    }
}

function* onTalkTo(name) {
    if (name === "gnome_inventor") {
        yield* talkToTinker();
    } else if (name === "cyber_mystic") {
        yield* talkToMystic();
    } else if (name === "mech_stealth_fighter") {
        yield* talkToDrone();
    } else if (name === "merchant" || name === "cyber_rogue" || name === "android") {
        yield* talkToTownsfolk(name);
    }
}

// Swap 1 (in town): copper wire for a brass gear.
function* talkToTinker() {
    api.playSound("select");
    if (api.getVar("swap1_done", false)) {
        yield api.say("Tinker", "The gear I gave you? Take it to the Mystic in the Mile - she's the only one who'll know what it's for. Don't ask me. I only make them.");
        return;
    }
    if (api.hasItem("copper_bundle")) {
        api.removeItem("copper_bundle", 1);
        api.giveItem("brass_gear", 1);
        api.setVar("swap1_done", true);
        api.giveExperience(40);
        yield api.say("Tinker", "*unrolls a hand's length of the wire, sniffs it, nods* Copper. Proper copper, and not a scrap of solder in it. A fair swap, then - a brass gear for your bundle.");
        yield api.say("Tinker", "The Mystic in the Mile has been asking after gears. Half-way along, you'll find her. She trades lenses for them, and I don't know why, and I've decided that's the right amount to know.");
        return;
    }
    const n = api.getVar("tinker_talks", 0);
    api.setVar("tinker_talks", n + 1);
    if (n === 0) {
        yield api.say("Tinker", "Nothing costs money on the Mile. Everything costs something. I'll give you a brass gear - a good one - for a bundle of copper wire. I'm out. Somebody left one lying by the south alley, if you care to look.");
        yield api.say("Lara", "A brass gear. What do I do with a gear?");
        yield api.say("Tinker", "Nothing, by itself. That's how you know it's a swap and not a gift.");
    } else {
        yield api.say("Tinker", "A bundle of copper wire, for a brass gear. It's lying about in the south alley - if the pigeons haven't had it.");
    }
}

// Swap 2 (in the maze): the gear for a signal lens.
function* talkToMystic() {
    api.playSound("select");
    if (api.getVar("swap2_done", false)) {
        yield api.say("Mystic", "The lens is the only one of its kind left. The Gate-drone at the far end has been waiting on it. Hold it up, and look through it, and it will let you by.");
        return;
    }
    if (api.hasItem("brass_gear")) {
        api.removeItem("brass_gear", 1);
        api.giveItem("signal_lens", 1);
        api.setVar("swap2_done", true);
        api.giveExperience(40);
        yield api.say("Mystic", "*she turns the gear against the light, and something inside it clicks into place* There. It always was missing exactly one tooth. Here - the lens. Fair is fair.");
        yield api.say("Mystic", "The Gate-drone at the end of the Mile checks everyone who passes. It reads what it sees through this. Without it, it only reads static - and static, as far as it's concerned, is a threat.");
        return;
    }
    const n = api.getVar("mystic_talks", 0);
    api.setVar("mystic_talks", n + 1);
    if (n === 0) {
        yield api.say("Mystic", "I have a lens - a signal lens, the last clear one. I will trade it for a brass gear. Nothing else. I've tried everything else, and everything else is just noise.");
        yield api.say("Lara", "Where would I find a gear?");
        yield api.say("Mystic", "The Tinker back in the town makes them. For copper wire, I am told. I am told a great many things; I try to keep only the useful ones.");
    } else {
        yield api.say("Mystic", "A brass gear, and I will give you the lens. The Tinker in the town makes them. That is the whole of what I know.");
    }
}

// Swap 3 (last stretch): the lens for the gate.
function* talkToDrone() {
    api.playSound("select");
    if (api.getVar("mile_open", false)) {
        yield api.say("Gate-drone", "*a soft, almost happy chirp* SCAN CLEAR. YOU MAY PASS. PLEASE MIND THE... sunset.");
        return;
    }
    if (api.hasItem("signal_lens")) {
        api.removeItem("signal_lens", 1);
        api.setVar("mile_open", true);
        api.setBarrier("mile_gate", 0, 0, 1, 1, false);
        api.giveExperience(100);
        yield api.say("Gate-drone", "*a long, deliberate scan, which appears to be the first clear image it has seen in some time* ...SCAN CLEAR. PERSON: LARA. COMPANIONS: FOUR. THREAT LEVEL: ...LOW. HOW VERY ODD.");
        yield api.say("Gate-drone", "GATE OPEN. THANK YOU FOR THE LENS. I HAD BEGUN TO THINK EVERYONE WAS STATIC.");
        yield* companionSays("vex_recruited", "Vex", "It has spent years mistaking every traveller for interference. I find that intensely relatable.");
        return;
    }
    const n = api.getVar("drone_talks", 0);
    api.setVar("drone_talks", n + 1);
    if (n === 0) {
        yield api.say("Gate-drone", "SCAN FAILED. INPUT: STATIC. THIS UNIT REQUIRES A SIGNAL LENS TO READ TRAVELLERS. NO LENS, NO GATE.");
        yield api.say("Lara", "Where do I get a lens?");
        yield api.say("Gate-drone", "*a long, whirring pause* THIS UNIT DOES NOT KNOW. THIS UNIT HAS ONLY EVER BEEN ASKED FOR IT. THE MYSTIC, BACK ALONG THE MILE, MAY KNOW.");
    } else {
        yield api.say("Gate-drone", "NO LENS. STATIC. THE MYSTIC MAY KNOW.");
    }
}

function* talkToTownsfolk(name) {
    const lines = {
        merchant: [api.getGlobalVar("guilds_at_peace", false)
                       ? "I heard the Smiths and the Weavers ate at one table, back down the road. Good for business. Terrible for the gossip trade."
                       : "Everything on the Mile is a swap. If you have nothing to swap, you have something to earn.",
                   "I have swapped a boot for a boat and a boat for a song. I have not once regretted the song."],
        cyber_rogue: ["The Tinker only deals in gears. The Mystic only deals in lenses. The Gate-drone only deals in the lens. It's a chain. Miss a link, and it snaps at you.",
                      "I tried to bribe the Gate-drone with a bag of scrap. It said 'STATIC' and started to cry. Or hum. It's hard to tell."],
        android: ["Every trade I've ever recorded balances to zero. That has always seemed to me like a kind of grace.",
                  "Do you know the oldest object on the Mile? A single coin that has never once been spent. It is out beyond the gate, somewhere, and nobody has had the heart to take it."],
    }[name];
    const displayName = { merchant: "Hawker", cyber_rogue: "Runner", android: "Ledger" }[name];
    const n = api.getVar("talk_" + name, 0);
    api.setVar("talk_" + name, n + 1);
    api.playSound("select");
    yield api.say(displayName, lines[n % lines.length]);
}

function* onEnemyDefeated(name) {
    if (Math.random() > 0.1)
        return;
    if (name === "imp") {
        yield api.wait(0.3);
        yield api.say("Lara", "It was trying to swap me my own boot for my own boot. I'll give it points for consistency.");
    } else if (name === "mech_spider") {
        yield api.wait(0.3);
        yield api.say("Lara", "A stall's worth of wiring, still running the last order it was given. Don't ask what.");
    }
}

function* onItemCollected(itemId) {
    if (itemId !== "first_coin")
        return;
    yield api.wait(0.3);
    yield api.say("Lara", "It's blank. Not worn blank - blank, like it was never stamped at all. And it's warm, like someone's been holding it for me.");
    yield api.say("???", "Sixth of nine. The first coin ever traded on the Mile, and it has never once been spent. Some things are more valuable for having been kept.");
    yield api.say("Lara", "Was it you? Did you keep it?");
    yield api.say("???", "I kept a great many things. Most of them were meant for you. The next place is where a map is drawn from the middle outward, and I'd like you to see how.");
    api.setGlobalVar("chapter", 23);
    api.playSound("select");
    yield api.wait(0.8);
    api.loadLevel("chapter23.json");
}
