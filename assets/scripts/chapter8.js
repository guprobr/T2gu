// ============================================================================
// ShadowShine - Chapter 8: "Lanternside"
// ============================================================================
//
// Two parts: the TOWN comes first, the MAZE after it. This level runs left to right
// (the hero spawns against the west edge). Map: 162x90, tileset dirty_plate_asphalt, lighting torch.
//   - town   cols 1-44
//   - maze   cols 45-150, rows 0-89, corridors 2 wide, walls 3 thick
//   - pocket cols 151-160 (where the maze lets out)
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
        api.setBarrier("mzwall_" + k, firstCol, rect.r0, rect.c1 - rect.c0 + 1, rect.r1 - rect.r0 + 1, true);
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
const W = 162, H = 90;
const DIR = 1;                        // 1: this level runs left -> right
const START_U = 3;                        // the hero spawns this many columns in from the start edge
const MID = 45;                        // row of the road that leads to the maze gate
const TOWN_U = 44;                        // the town fills u = 1..TOWN_U (u counts from the start edge)
const MAZE_WEST = 45, MAZE_EAST = 150;   // absolute columns of the maze block
const MAZE_NORTH = 0, MAZE_SOUTH = 89;        // its rows
const MAZE_CORRIDOR = 2, MAZE_WALL = 3;
const POCKET_U0 = 151, POCKET_U1 = 160;   // the exit pocket beyond the maze (u), 10 columns

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
// Chapter 8 - "Lanternside" (dirty_plate_asphalt, torch). Runs LEFT to RIGHT.
// A slum of tarp shanties and tenements lit by lanterns that never go out;
// the torch lighting flickers over everything.
//
// QUEST (fetch-N): the checkpoint at the far end of the Lanternside Stacks
// only lets a traveller through for three permit chips. The chips only exist
// out in the stacks - four of them lie scattered through the maze. Hand three
// to the checkpoint's warden and the checkpoint gate (the maze's exit) lifts.
// ----------------------------------------------------------------------------
const TOWN = [
    ["rain_barrel", 3, -30],
    ["crate_stack_cat", 3, 37],
    ["wrecked_cart", 3, 41],
    ["leaning_tenement", 4, 12],
    ["crate_stack_cat", 5, -41],
    ["wrecked_cart", 5, -29],
    ["barrels_crates", 5, -16],
    ["barrels_crates", 6, -26],
    ["cyber_supply_crate", 7, 18],
    ["crate_stack_cat", 8, -39],
    ["data_pillar", 8, -24],
    ["ash_covered_barrels", 9, -14],
    ["barrels_crates", 10, 31],
    ["cyber_supply_crate", 11, -19],
    ["crate_tarp_shanty", 11, -13],
    ["cyber_supply_crate", 11, 24],
    ["rain_barrel", 11, 27],
    ["salvage_pile", 12, -40],
    ["ash_covered_barrels", 12, -38],
    ["leaning_tenement", 12, -22],
    ["wrecked_cart", 12, 21],
    ["wrecked_cart", 12, 29],
    ["salvage_pile", 13, 26],
    ["data_pillar", 14, -17],
    ["barrels_crates", 14, -12],
    ["crate_tarp_shanty", 16, 23],
    ["barrels_crates", 17, -37],
    ["wrecked_cart", 17, -30],
    ["signal_relay_mast", 17, -26],
    ["data_pillar", 17, -18],
    ["cyber_supply_crate", 18, -22],
    ["data_pillar", 18, 3],
    ["holo_terminal", 19, -3],
    ["vendor_kiosk", 25, -3],
    ["crate_stack_cat", 26, 3],
    ["rain_barrel", 27, -39],
    ["vendor_kiosk", 27, -24],
    ["data_pillar", 27, 29],
    ["salvage_pile", 27, 39],
    ["crate_tarp_shanty", 28, 19],
    ["cyber_supply_crate", 29, -31],
    ["ash_covered_barrels", 29, -9],
    ["salvage_pile", 32, -34],
    ["salvage_pile", 32, -28],
    ["data_pillar", 32, -25],
    ["leaning_tenement", 32, -16],
    ["holo_terminal", 33, 22],
    ["crate_stack_cat", 33, 24],
    ["barrels_crates", 33, 31],
    ["patched_pushcart", 34, 9],
    ["cyber_supply_crate", 34, 28],
    ["salvage_pile", 34, 41],
    ["patched_pushcart", 35, 38],
    ["ash_covered_barrels", 36, -18],
    ["salvage_pile", 36, -5],
    ["patched_pushcart", 36, 40],
    ["crate_stack_cat", 37, -43],
    ["rain_barrel", 38, 16],
    ["leaning_tenement", 39, 13],
    ["barrels_crates", 39, 18],
    ["patched_pushcart", 39, 33],
    ["poor_market_stall", 40, -8],
    ["ash_covered_barrels", 40, 9],
    ["alley_lantern_post", 41, -3],
    ["barrels_crates", 41, 35],
    ["barrels_crates", 42, -25],
    ["patched_pushcart", 42, -10]
];

function* onLevelStart() {
    api.spawnCharacter("lara_cyber", colAt(START_U), MID);
    api.giveControl("lara_cyber");
    respawnCompanions();

    buildTown();
    const exitRows = buildMaze();
    buildPocket();
    if (!api.getVar("checkpoint_open", false))
        setExitGate("checkpoint_gate", exitRows, true);

    if (api.getVar("chapter8_intro_seen", false))
        return;
    api.setVar("chapter8_intro_seen", true);

    yield api.wait(0.6);
    yield api.say("Lara", "Lanterns. Hundreds of them, strung between rooftops, every one lit, not a wick or a flame in sight.");
    yield* companionSays("vex_recruited", "Vex", "Those aren't lanterns. That's a power line with opinions. Beautiful work, honestly.");
    yield* companionSays("nettle_recruited", "Nettle", "The people here look tired in the way that means they've stopped noticing they're tired.");
    yield api.say("Hint", "This level runs left to right. The town is behind you; the maze is ahead, to the east.");
}

function buildTown() {
    placeProps(TOWN);
    api.spawnProp("holo_terminal", colAt(TOWN_U - 1), MID - 3);
    api.spawnProp("signal_relay_mast", colAt(TOWN_U - 1), MID + 4);

    api.spawnNpc("android", colAt(13), MID - 3);          // Ledger, the fixer
    api.spawnNpc("gnome_inventor", colAt(24), MID + 5);   // Tinker
    api.spawnNpc("cyber_rogue", colAt(10), MID + 6);      // Runner
    api.spawnNpc("merchant", colAt(30), MID - 5);

    if (api.getVar("town_loot_spawned", false))
        return;
    api.setVar("town_loot_spawned", true);
    api.spawnItem("repair_kit", colAt(6), MID - 9);
    api.spawnItem("stamina_draught", colAt(28), MID + 11);
    api.spawnItem("spool_of_copper_wire", colAt(34), MID - 12);
    api.spawnItem("health_potion", colAt(14), MID + 14);
    api.spawnItem("health_potion", colAt(20), MID - 11);
}

function buildMaze() {
    const core = ["crate_tarp_shanty", "salvage_pile", "leaning_tenement", "conduit_coil", "overgrown_solar_array", "dormant_sentry_turret", "data_pillar"];
    const edge = ["barrels_crates", "ash_covered_barrels", "crate_stack_cat", "rain_barrel", "cyber_supply_crate"];
    const cells = buildBranchingMaze(MAZE_WEST, MAZE_EAST, MAZE_NORTH, MAZE_SOUTH, MAZE_CORRIDOR, MAZE_WALL,
        core, edge, 80801, { flip: DIR < 0, diagonalSeam: true, solid: true });
    const pool = cells.slice();

    spawnPacks(takeCells(pool, 0.06, 1.0, 38, 80802),
        [["mech_spider", 12, 35], ["mech_crimson_warbot", 8, 45], ["mech_red_spider_tank", 4, 60], ["cyber_brawler", 8, 45], ["cyber_swordfighter", 6, 40]],
        "maze_hostiles_spawned");

    // The warden stands in the last stretch before the exit gate - reachable, on the near side of it.
    const warden = takeCells(pool, 0.94, 1.0, 1, 80803)[0];
    api.spawnNpc("cyber_trooper", warden.col, warden.row);

    // Four permit chips in four different stretches of the maze (three are enough).
    const chipBands = [[0.10, 0.30], [0.32, 0.52], [0.54, 0.74], [0.76, 0.92]];
    const chipSpots = chipBands.map((b, k) => takeCells(pool, b[0], b[1], 1, 80804 + k)[0]);
    spawnLoot(chipSpots, ["tech_chip", "tech_chip", "tech_chip", "tech_chip"], "chips_spawned");

    spawnLoot(takeCells(pool, 0.05, 0.95, 10, 80810),
        ["health_potion", "health_potion", "health_potion", "health_potion", "health_potion", "health_potion",
         "small_ingot", "cyber_visor", "tech_gauntlet", "mana_potion"], "maze_loot_spawned");
    return cells.exitRows;
}

function buildPocket() {
    const [c0, c1] = pocketCols();
    scatterOrganic(["alley_lantern_post", "salvage_pile", "cyber_supply_crate", "data_pillar"], c0, c1, MAZE_NORTH + 2, MAZE_SOUTH - 2, 10, 80820,
        [{ col: colAt(POCKET_U0 + 5), row: MID }]);
    if (!api.getVar("core_spawned", false)) {
        api.setVar("core_spawned", true);
        api.spawnItem("lantern_core", colAt(POCKET_U0 + 5), MID);
    }
}

function* onTalkTo(name) {
    if (name === "android") {
        yield* talkToLedger();
    } else if (name === "cyber_trooper") {
        yield* talkToWarden();
    } else if (name === "gnome_inventor" || name === "cyber_rogue" || name === "merchant") {
        yield* talkToTownsfolk(name);
    }
}

function* talkToLedger() {
    const n = api.getVar("ledger_talks", 0);
    api.setVar("ledger_talks", n + 1);
    api.playSound("select");
    if (n === 0) {
        yield api.say("Ledger", "Good. Someone with boots. The Stacks run east from here - a maze of everything this district ever threw away.");
        yield api.say("Ledger", "At the far end there's a checkpoint. It wants three permit chips to open. Permit chips don't get sold; they get *found*. Four are lying out in the Stacks. Bring three to the warden.");
        yield api.say("Lara", "And past the checkpoint?");
        yield api.say("Ledger", "The lantern-core. Every light in Lanternside runs off a copy of it, and the original stopped answering its own name three nights ago. Same night as the hum.");
    } else {
        yield api.say("Ledger", "Chips first, warden second. He can count, and he doesn't take promises.");
    }
}

function* talkToWarden() {
    api.playSound("select");
    if (api.getVar("checkpoint_open", false)) {
        yield api.say("Warden", "Go on through. Mind the core. It's been in a mood.");
        return;
    }
    const have = api.getItemCount("tech_chip");
    if (have < 3) {
        yield api.say("Warden", "CHECKPOINT. Three permit chips, please. You have " + have + ".");
        yield api.say("Lara", "There are four out in the Stacks, aren't there.");
        yield api.say("Warden", "*static* ...I'm not permitted to confirm the number.");
        return;
    }
    api.removeItem("tech_chip", 3);
    api.setVar("checkpoint_open", true);
    api.setBarrier("checkpoint_gate", 0, 0, 1, 1, false);
    api.giveExperience(100);
    yield api.say("Warden", "One. Two. Three. VALID. *a heavy clunk from the gate behind him* ...Honestly? I was hoping someone would finally use those.");
    yield* companionSays("cobb_recruited", "Cobb", "Bribing a wall with paperwork. I've seen dwarves do worse with less.");
}

function* talkToTownsfolk(name) {
    const lines = {
        gnome_inventor: ["I built the first lantern here. Well, I plugged in the first lantern. Somebody else built it. I forget who. Probably me.",
                         "If the Stacks buzz at you, that's not a threat. That's a bad ground wire."],
        cyber_rogue: ["Runners go in for scrap and come out for air. I've done both. Prefer neither.",
                      "Four chips out there, warden takes three. You can keep the extra. Or sell it. Whichever hurts less."],
        merchant: ["Everything's for sale except the lanterns. Those aren't ours to sell.",
                   "Prices are up. Not because of the hum. I just like the sound of saying it."],
    }[name];
    const displayName = { gnome_inventor: "Tinker", cyber_rogue: "Runner", merchant: "Merchant" }[name];
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
        yield api.say("Lara", "Wired for a job somebody cancelled. It kept going anyway.");
    } else if (name === "cyber_brawler") {
        yield api.wait(0.3);
        yield api.say("Lara", "Hired muscle. Nobody's paying the muscle any more.");
    }
}

function* onItemCollected(itemId) {
    if (itemId !== "lantern_core")
        return;
    yield api.wait(0.3);
    yield api.say("Lara", "It's warm, and it's *steady* - the first thing I've touched in three days that isn't flickering.");
    yield api.say("???", "Second of ten. Do you hear it yet? Not the hum. The thing under the hum, that the hum is trying to say.");
    yield api.say("Lara", "Every time I think I have it, it's the next word that matters.");
    yield api.say("???", "Then walk to the next word. East gives way to hills, and hills to a road with a price on it.");
    api.setGlobalVar("chapter", 9);
    api.playSound("select");
    yield api.wait(0.8);
    api.loadLevel("chapter9.json");
}
