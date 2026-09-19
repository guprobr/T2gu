// ============================================================================
// ShadowShine - Chapter 13: "The Undertrack"
// ============================================================================
//
// Two parts: the TOWN comes first, the MAZE after it. This level runs right to left
// (the hero spawns against the east edge). Map: 172x90, tileset asphalt_dirty_plate, lighting cavern.
//   - town   cols 127-170
//   - maze   cols 11-126, rows 0-89, corridors 2 wide, walls 3 thick
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
const W = 172, H = 90;
const DIR = -1;                        // -1: this level runs right -> left
const START_U = 3;                        // the hero spawns this many columns in from the start edge
const MID = 45;                        // row of the road that leads to the maze gate
const TOWN_U = 44;                        // the town fills u = 1..TOWN_U (u counts from the start edge)
const MAZE_WEST = 11, MAZE_EAST = 126;   // absolute columns of the maze block
const MAZE_NORTH = 0, MAZE_SOUTH = 89;        // its rows
const MAZE_CORRIDOR = 2, MAZE_WALL = 3;
const POCKET_U0 = 161, POCKET_U1 = 170;   // the exit pocket beyond the maze (u), 10 columns

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
// Chapter 13 - "The Undertrack" (asphalt_dirty_plate, cavern). Runs RIGHT to
// LEFT. A settlement under the old railway: plate-steel floors, cave torches,
// crystal seams in the ceiling - then the Signal Tunnels, a maze of
// abandoned track galleries.
//
// QUEST (a relay chain): the tunnel's exit bulkhead is on the signal
// interlock, and the line is dead. Three relay units stand along the tunnels;
// each wakes only once the one UPSTREAM of it is live, and each, once awake,
// tells you which half of the tunnels the next one is in. Waking the third
// throws the interlock and the bulkhead lifts.
// ----------------------------------------------------------------------------
const TOWN = [
    ["salvage_pile", 3, 19],
    ["cyber_supply_crate", 4, -16],
    ["signal_relay_mast", 4, -14],
    ["mine_cart", 4, 36],
    ["cave_in_rubble", 6, -38],
    ["rain_barrel", 6, -26],
    ["cave_in_rubble", 6, -19],
    ["barrels_crates", 6, 18],
    ["rocks_small", 7, -16],
    ["mine_cart", 8, 14],
    ["mine_cart", 8, 27],
    ["mine_cart", 9, 19],
    ["barrels_crates", 10, -43],
    ["glowing_crystal_cluster", 10, -29],
    ["salvage_pile", 11, -40],
    ["support_beam", 11, -24],
    ["holo_terminal", 11, 20],
    ["mine_cart", 11, 33],
    ["crate_tarp_shanty", 12, -43],
    ["stalagmite_formation", 13, -30],
    ["support_beam", 13, 22],
    ["rocks_small", 13, 24],
    ["crate_tarp_shanty", 13, 40],
    ["poor_market_stall", 15, -24],
    ["underground_fungus_growth", 15, -21],
    ["rain_barrel", 15, 23],
    ["crate_tarp_shanty", 17, -18],
    ["salvage_pile", 17, -8],
    ["support_beam", 18, -30],
    ["stalagmite_formation", 18, -25],
    ["leaning_tenement", 18, -20],
    ["mine_cart", 18, 3],
    ["holo_terminal", 19, -3],
    ["glowing_crystal_cluster", 25, -3],
    ["underground_fungus_growth", 26, 3],
    ["vendor_kiosk", 27, 22],
    ["cave_in_rubble", 27, 28],
    ["underground_fungus_growth", 28, -14],
    ["glowing_crystal_cluster", 28, 20],
    ["cave_in_rubble", 28, 38],
    ["rain_barrel", 29, -43],
    ["poor_market_stall", 29, -24],
    ["barrels_crates", 29, -9],
    ["underground_fungus_growth", 30, -37],
    ["leaning_tenement", 30, -26],
    ["stone_fireplace", 31, 20],
    ["salvage_pile", 31, 25],
    ["rocks_small", 33, -37],
    ["salvage_pile", 33, 39],
    ["stalagmite_formation", 34, -43],
    ["glowing_crystal_cluster", 34, -39],
    ["stalagmite_formation", 34, 27],
    ["barrels_crates", 35, -35],
    ["underground_fungus_growth", 35, -32],
    ["stalagmite_formation", 36, -26],
    ["rocks_small", 36, -3],
    ["rain_barrel", 37, 35],
    ["crate_tarp_shanty", 38, 20],
    ["cave_in_rubble", 39, -16],
    ["mine_cart", 39, 8],
    ["glowing_crystal_cluster", 40, -12],
    ["support_beam", 40, -6],
    ["rain_barrel", 40, 19],
    ["underground_fungus_growth", 40, 41],
    ["support_beam", 41, -20],
    ["rocks_small", 41, -15],
    ["cave_torch_sconce", 41, -3]
];
const RELAYS = ["mech_arcane_fighter", "mech_crimson_warbot_2", "mech_stealth_fighter"];
const RELAY_NAME = { mech_arcane_fighter: "Relay One", mech_crimson_warbot_2: "Relay Two", mech_stealth_fighter: "Relay Three" };

function* onLevelStart() {
    api.spawnCharacter("lara_cyber", colAt(START_U), MID);
    api.giveControl("lara_cyber");
    respawnCompanions();

    buildTown();
    const exitRows = buildMaze();
    buildPocket();
    if (!api.getVar("line_live", false))
        setExitGate("relay_gate", exitRows, true);

    if (api.getVar("chapter13_intro_seen", false))
        return;
    api.setVar("chapter13_intro_seen", true);

    yield api.wait(0.6);
    yield api.say("Lara", "Below the railway. Steel plate underfoot, torches on the walls, and a ceiling that glitters when you're not looking straight at it.");
    yield* companionSays("cobb_recruited", "Cobb", "Now THIS is proper depth. Cool air, honest stone, and not a windmill in sight.");
    yield* companionSays("nettle_recruited", "Nettle", "Everything down here is damp and glowing. Ask me about the mushrooms before somebody eats one.");
    yield api.say("Hint", "This level runs right to left. The town is behind you; the Signal Tunnels are ahead, to the west.");
}

function buildTown() {
    placeProps(TOWN);
    api.spawnProp("holo_terminal", colAt(TOWN_U - 1), MID - 3);
    api.spawnProp("cave_torch_sconce", colAt(TOWN_U), MID + 4);

    api.spawnNpc("gnome_engineer", colAt(14), MID - 3);     // Fuse, the line keeper
    api.spawnNpc("miner", colAt(24), MID + 5);              // Digger
    api.spawnNpc("elder_2", colAt(10), MID + 6);            // the Stationmaster
    api.spawnNpc("mushroom_gnome", colAt(30), MID - 5);     // Cap

    if (api.getVar("town_loot_spawned", false))
        return;
    api.setVar("town_loot_spawned", true);
    api.spawnItem("repair_kit", colAt(6), MID - 9);
    api.spawnItem("spool_of_copper_wire", colAt(28), MID + 11);
    api.spawnItem("stamina_draught", colAt(34), MID - 12);
    api.spawnItem("health_potion", colAt(13), MID + 14);
}

function buildMaze() {
    const core = ["stalagmite_formation", "cave_in_rubble", "mine_cart", "support_beam", "stone_wall_corner", "glowing_crystal_cluster"];
    const edge = ["rocks_small", "underground_fungus_growth", "cave_torch_sconce", "salvage_pile", "stalactite_cluster"];
    const cells = buildBranchingMaze(MAZE_WEST, MAZE_EAST, MAZE_NORTH, MAZE_SOUTH, MAZE_CORRIDOR, MAZE_WALL,
        core, edge, 131301, { flip: DIR < 0, diagonalSeam: true, solid: true });
    const pool = cells.slice();

    spawnPacks(takeCells(pool, 0.06, 1.0, 40, 131302),
        [["goblin", 12, 30], ["slime_void", 10, 35], ["mech_spider", 8, 35], ["mech_red_spider_tank", 4, 60], ["orc", 6, 45]],
        "maze_hostiles_spawned");

    // The relay chain, downstream: one unit per third of the tunnels.
    const bands = [[0.14, 0.32], [0.44, 0.62], [0.74, 0.92]];
    RELAYS.forEach((name, k) => {
        const spot = takeCells(pool, bands[k][0], bands[k][1], 1, 131303 + k)[0];
        api.spawnNpc(name, spot.col, spot.row);
        api.setVar("relay_row_" + k, spot.row);
    });

    spawnLoot(takeCells(pool, 0.05, 0.95, 11, 131310),
        ["health_potion", "health_potion", "health_potion", "health_potion", "health_potion", "health_potion",
         "mana_potion", "repair_kit", "spool_of_copper_wire", "elixir_of_clarity", "stamina_draught"], "maze_loot_spawned");
    return cells.exitRows;
}

function buildPocket() {
    const [c0, c1] = pocketCols();
    scatterOrganic(["stalagmite_formation", "glowing_crystal_cluster", "mine_cart", "cave_torch_sconce"], c0, c1, MAZE_NORTH + 2, MAZE_SOUTH - 2, 9, 131320,
        [{ col: colAt(POCKET_U0 + 5), row: MID }]);
    if (!api.getVar("fork_spawned", false)) {
        api.setVar("fork_spawned", true);
        api.spawnItem("relay_tuning_fork", colAt(POCKET_U0 + 5), MID);
    }
}

// Which half of the tunnels the next relay is in, and which way to walk to reach it.
function relayHint(k) {
    const row = api.getVar("relay_row_" + k, MID);
    const half = row < MID ? "north" : "south";
    const way = DIR > 0 ? "east" : "west";
    return "It's in the " + half + "ern galleries, further " + way + " along the line.";
}

function* onTalkTo(name) {
    if (name === "gnome_engineer") {
        yield* talkToFuse();
    } else if (RELAYS.indexOf(name) >= 0) {
        yield* speakToRelay(name);
    } else if (name === "miner" || name === "elder_2" || name === "mushroom_gnome") {
        yield* talkToTownsfolk(name);
    }
}

function* talkToFuse() {
    const n = api.getVar("fuse_talks", 0);
    api.setVar("fuse_talks", n + 1);
    api.playSound("select");
    if (api.getVar("line_live", false)) {
        yield api.say("Fuse", "I can hear it! The whole line, end to end, humming in tune - with itself, this time. Take the fork. It's how the signals were originally kept honest.");
    } else if (n === 0) {
        yield api.say("Fuse", "Welcome to the Undertrack. We keep the old railway's signals alive. Three relays carry the line through the Signal Tunnels, west of here.");
        yield api.say("Fuse", "Every relay listens to the one upstream of it. Wake the first and it wakes the second, wake the second and it wakes the third. Since the hum, none of them will start on their own.");
        yield api.say("Lara", "And the bulkhead at the end of the tunnels?");
        yield api.say("Fuse", "It's on the same interlock. Live line, open door. Dead line, wall. Talk to the relays in order - each will tell you where the next one is.");
    } else {
        yield api.say("Fuse", "One, two, three. Downstream, in order. If one of them says it hears nothing, you skipped a link.");
    }
}

// The chain: One -> Two -> Three. A relay out of turn is only "no carrier", never a fail.
function* speakToRelay(name) {
    const step = api.getVar("relay_step", 0);
    const idx = RELAYS.indexOf(name);
    api.playSound("select");
    if (idx < step) {
        yield api.say(RELAY_NAME[name], "*a steady tone* Carrier live.");
        return;
    }
    if (idx > step) {
        yield api.say(RELAY_NAME[name], "*static* ...no carrier from upstream. Wake " + RELAY_NAME[RELAYS[step]] + " first.");
        return;
    }
    api.setVar("relay_step", step + 1);
    api.giveExperience(30);
    if (step === 0) {
        yield api.say("Relay One", "*a bulb flickers on, then holds* ...signal. Carrier live. Sending it down the line.");
        yield api.say("Relay One", "Next unit: " + relayHint(1));
    } else if (step === 1) {
        yield api.say("Relay Two", "*two amber lights, then a low tone* Carrier live. Signal doubled. One more link.");
        yield api.say("Relay Two", "Last unit: " + relayHint(2));
    } else {
        yield api.say("Relay Three", "*a chime that goes on far too long* CARRIER LIVE. Interlock thrown.");
        api.setVar("line_live", true);
        api.setBarrier("relay_gate", 0, 0, 1, 1, false);
        api.giveExperience(110);
        yield api.say("Lara", "Somewhere down the tunnel, a bulkhead just let go of its frame.");
        yield* companionSays("cobb_recruited", "Cobb", "Three little boxes, all listening to each other. That's a whole dwarf gathering right there.");
    }
}

function* talkToTownsfolk(name) {
    const lines = {
        miner: ["I dig. That's all I do. The tunnels west of here I didn't dig. Somebody with longer arms did.",
                "Ceilings that sparkle mean crystal. Ceilings that drip mean water. Ceilings that do neither, you run."],
        elder_2: ["The last train left eleven years ago. We keep the platform swept in case it comes back.",
                  "The Stationmaster's rule: anyone who arrives gets a bench and a hot drink, and nobody asks where from."],
        mushroom_gnome: ["Blue caps are for soup. Red caps are for arguments. Don't mix them. I've mixed them.",
                         "Everything down here is quietly growing. It's the only place I've ever felt at home."],
    }[name];
    const displayName = { miner: "Digger", elder_2: "Stationmaster", mushroom_gnome: "Cap" }[name];
    const n = api.getVar("talk_" + name, 0);
    api.setVar("talk_" + name, n + 1);
    api.playSound("select");
    yield api.say(displayName, lines[n % lines.length]);
}

function* onEnemyDefeated(name) {
    if (Math.random() > 0.1)
        return;
    if (name === "mech_spider") {
        yield api.wait(0.3);
        yield api.say("Lara", "A maintenance crawler still trying to maintain something. I'm sorry it had to be me.");
    } else if (name === "slime_void") {
        yield api.wait(0.3);
        yield api.say("Lara", "It left a darker patch on the plate where it stood. It fades slowly.");
    }
}

function* onItemCollected(itemId) {
    if (itemId !== "relay_tuning_fork")
        return;
    yield api.wait(0.3);
    yield api.say("Lara", "It rang the moment I closed my hand on it. One clean note, and everything in the tunnel went quiet to listen.");
    yield api.say("???", "Seventh of ten. A tuning fork doesn't make the note. It only reminds everything else what the note was.");
    yield api.say("Lara", "That's what the hum is, isn't it. A note somebody forgot.");
    yield api.say("???", "Closer than you know. Onward. There's a river ahead that keeps a copy of everything that crosses it - try not to argue with your reflection.");
    api.setGlobalVar("chapter", 14);
    api.playSound("select");
    yield api.wait(0.8);
    api.loadLevel("chapter14.json");
}
