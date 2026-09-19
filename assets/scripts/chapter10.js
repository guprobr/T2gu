// ============================================================================
// ShadowShine - Chapter 10: "The Mourning Fair"
// ============================================================================
//
// Two parts: the TOWN comes first, the MAZE after it. This level runs left to right
// (the hero spawns against the west edge). Map: 168x96, tileset haunted_grass_cobble, lighting mystical.
//   - town   cols 1-44
//   - maze   cols 45-156, rows 0-95, corridors 2 wide, walls 3 thick
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
const W = 168, H = 96;
const DIR = 1;                        // 1: this level runs left -> right
const START_U = 3;                        // the hero spawns this many columns in from the start edge
const MID = 45;                        // row of the road that leads to the maze gate
const TOWN_U = 44;                        // the town fills u = 1..TOWN_U (u counts from the start edge)
const MAZE_WEST = 45, MAZE_EAST = 156;   // absolute columns of the maze block
const MAZE_NORTH = 0, MAZE_SOUTH = 95;        // its rows
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
// Chapter 10 - "The Mourning Fair" (haunted_grass_cobble, mystical). Runs LEFT
// to RIGHT. A fairground where the dead keep their own hours - haunted grass
// and cobble under a slowly shifting arcane glow.
//
// QUEST (an ordered rite whose ORDER IS TAUGHT IN TOWN): the Sexton gives the
// rite as a riddle - "Night keeps the watch, day gives the warmth, and the
// storm breaks it." Three spirits stand in the Hall of Hours (the maze): moon,
// sun, storm. Speak to them in the order the riddle names them (moon, sun,
// storm) and the rite gate at the maze's exit opens. Wrong order resets it.
// ----------------------------------------------------------------------------
const TOWN = [
    ["dead_tree", 3, -15],
    ["dead_tree", 5, 32],
    ["gravestone_cluster", 6, 19],
    ["ash_covered_barrels", 7, -37],
    ["destroyed_market_stall", 9, -13],
    ["dead_tree", 10, -37],
    ["haunted_signpost", 10, -35],
    ["charred_tree", 10, 23],
    ["broken_fence", 10, 29],
    ["ash_covered_barrels", 10, 43],
    ["dead_tree", 12, -39],
    ["gravestone_cluster", 12, -8],
    ["dead_tree", 12, 32],
    ["burnt_cottage_ruin", 12, 36],
    ["dead_twisted_tree", 13, 20],
    ["charred_tree", 13, 48],
    ["ruined_chapel", 14, -25],
    ["broken_fence", 14, 24],
    ["dead_tree", 17, -18],
    ["haunted_cottage", 18, -14],
    ["gravestone_cluster", 18, 3],
    ["burnt_stump", 18, 11],
    ["burnt_stump", 18, 13],
    ["charred_tree", 18, 33],
    ["broken_fence", 18, 40],
    ["moss_grown_altar", 22, -4],
    ["haunted_signpost", 26, -3],
    ["dead_twisted_tree", 26, 3],
    ["rocks_small", 27, -40],
    ["charred_tree", 27, -32],
    ["haunted_cottage", 27, -24],
    ["ash_covered_barrels", 27, -17],
    ["dead_tree", 27, 22],
    ["gravestone_cluster", 27, 31],
    ["destroyed_market_stall", 28, 18],
    ["dead_tree", 28, 26],
    ["destroyed_market_stall", 28, 35],
    ["haunted_signpost", 29, -19],
    ["charred_tree", 30, -36],
    ["cobweb_cart", 30, -9],
    ["rocks_small", 30, 21],
    ["haunted_signpost", 31, -20],
    ["ash_covered_barrels", 31, 5],
    ["moss_grown_altar", 31, 25],
    ["haunted_signpost", 31, 28],
    ["dead_twisted_tree", 31, 42],
    ["haunted_signpost", 33, 34],
    ["dead_tree", 33, 41],
    ["burnt_stump", 35, -18],
    ["burnt_stump", 35, 19],
    ["dead_tree", 35, 24],
    ["burnt_cottage_ruin", 37, 17],
    ["dead_twisted_tree", 37, 22],
    ["dead_twisted_tree", 38, -42],
    ["gravestone_cluster", 38, -17],
    ["ash_covered_barrels", 39, -23],
    ["rocks_small", 40, -38],
    ["cobweb_cart", 40, 7],
    ["gravestone_cluster", 40, 23],
    ["rocks_small", 40, 34],
    ["dead_twisted_tree", 41, -43],
    ["gravestone_cluster", 41, -18],
    ["broken_fence", 41, -9]
];
const RITE = ["moon_spirit", "sun_spirit", "storm_spirit"];
const RITE_NAME = { moon_spirit: "Moon", sun_spirit: "Sun", storm_spirit: "Storm" };

function* onLevelStart() {
    api.spawnCharacter("lara_cyber", colAt(START_U), MID);
    api.giveControl("lara_cyber");
    respawnCompanions();

    buildTown();
    const exitRows = buildMaze();
    buildPocket();
    if (!api.getVar("rite_done", false))
        setExitGate("rite_gate", exitRows, true);

    if (api.getVar("chapter10_intro_seen", false))
        return;
    api.setVar("chapter10_intro_seen", true);

    yield api.wait(0.6);
    yield api.say("Lara", "Bunting. Stalls. A carousel with no horses. It's a fair - and every single person here left decades ago.");
    yield* companionSays("nettle_recruited", "Nettle", "Nobody's sick here. Nobody's anything. That's what's wrong with it.");
    yield* companionSays("vigil_recruited", "Vigil", "The dead keep good order, when left to it. I would rather not be the one who disturbs it.");
    yield api.say("Hint", "This level runs left to right. The town is behind you; the Hall of Hours is ahead, to the east.");
}

function buildTown() {
    placeProps(TOWN);
    api.spawnProp("haunted_signpost", colAt(TOWN_U - 1), MID - 3);
    api.spawnProp("gravestone_cluster", colAt(TOWN_U), MID + 4);

    api.spawnNpc("elder", colAt(14), MID - 3);                 // the Sexton
    api.spawnNpc("farmgirl", colAt(24), MID + 5);              // a mourner who stayed
    api.spawnNpc("tribal_gatherer_girl", colAt(10), MID + 6);  // laying flowers
    api.spawnNpc("innkeeper", colAt(30), MID - 5);             // the fair's last barker

    if (api.getVar("town_loot_spawned", false))
        return;
    api.setVar("town_loot_spawned", true);
    api.spawnItem("memory_locket", colAt(6), MID - 9);
    api.spawnItem("herb_bundle", colAt(28), MID + 11);
    api.spawnItem("antidote_vial", colAt(34), MID - 12);
    api.spawnItem("health_potion", colAt(13), MID + 14);
}

function buildMaze() {
    const core = ["haunted_cottage", "gravestone_cluster", "ruined_chapel", "charred_tree", "dead_twisted_tree", "burnt_cottage_ruin"];
    const edge = ["burnt_stump", "rocks_small", "haunted_signpost", "dead_tree"];
    const cells = buildBranchingMaze(MAZE_WEST, MAZE_EAST, MAZE_NORTH, MAZE_SOUTH, MAZE_CORRIDOR, MAZE_WALL,
        core, edge, 101001, { flip: DIR < 0, diagonalSeam: true, solid: true });
    const pool = cells.slice();

    spawnPacks(takeCells(pool, 0.06, 1.0, 50, 101002),
        [["ghoul", 14, 35], ["skeleton", 12, 30], ["skeleton_archer", 8, 30], ["wraith", 6, 45], ["zombie_peasant", 10, 30]],
        "maze_hostiles_spawned");

    // The three spirits, spread through the maze: moon early, sun in the middle, storm late.
    const bands = [[0.16, 0.36], [0.44, 0.64], [0.72, 0.92]];
    RITE.forEach((name, k) => {
        const spot = takeCells(pool, bands[k][0], bands[k][1], 1, 101003 + k)[0];
        api.spawnNpc(name, spot.col, spot.row);
    });

    spawnLoot(takeCells(pool, 0.05, 0.95, 11, 101010),
        ["health_potion", "health_potion", "health_potion", "health_potion", "health_potion", "health_potion",
         "mana_potion", "sealed_vial_of_mist", "ornate_ring", "withering_petal", "elixir_of_clarity"], "maze_loot_spawned");
    return cells.exitRows;
}

function buildPocket() {
    const [c0, c1] = pocketCols();
    scatterOrganic(["gravestone_cluster", "dead_twisted_tree", "charred_tree", "burnt_stump"], c0, c1, MAZE_NORTH + 2, MAZE_SOUTH - 2, 9, 101020,
        [{ col: colAt(POCKET_U0 + 5), row: MID }]);
    if (!api.getVar("lantern_spawned", false)) {
        api.setVar("lantern_spawned", true);
        api.spawnItem("wake_lantern", colAt(POCKET_U0 + 5), MID);
    }
}

function* onTalkTo(name) {
    if (name === "elder") {
        yield* talkToSexton();
    } else if (RITE.indexOf(name) >= 0) {
        yield* speakToSpirit(name);
    } else if (name === "farmgirl" || name === "tribal_gatherer_girl" || name === "innkeeper") {
        yield* talkToTownsfolk(name);
    }
}

function* talkToSexton() {
    const n = api.getVar("sexton_talks", 0);
    api.setVar("sexton_talks", n + 1);
    api.playSound("select");
    if (api.getVar("rite_done", false)) {
        yield api.say("Sexton", "The Hall keeps its hours again. Take the lantern - it was always meant for someone who could carry a sorrow without spilling it.");
    } else if (n === 0) {
        yield api.say("Sexton", "You've come to the Fair. Nobody comes to the Fair. They come *through* it, and quickly.");
        yield api.say("Sexton", "The Hall of Hours past the gate keeps the dead's calendar. To pass it, you say goodnight to each of the hour-keepers in turn. I'll give you the order, and I'll give it the way my mother gave it to me: as a riddle.");
        yield api.say("Sexton", "\"Night keeps the watch. Day gives the warmth. And last, the storm that breaks it.\" Three keepers. In that order. Say it wrong and they'll only ask you to start over.");
        yield api.say("Lara", "Night, day, storm. That's the moon, the sun, and - the storm itself?");
        yield api.say("Sexton", "You'll know them when you meet them. They're not shy. They're only very, very patient.");
    } else {
        yield api.say("Sexton", "Night keeps the watch. Day gives the warmth. And last, the storm that breaks it. Go on.");
    }
}

// The rite: moon -> sun -> storm. A wrong keeper resets it, with a hint, never a hard fail.
function* speakToSpirit(name) {
    const step = api.getVar("rite_step", 0);
    api.playSound("select");
    if (api.getVar("rite_done", false)) {
        yield api.say(RITE_NAME[name], "*a slow, peaceful shimmer* The hour is kept.");
        return;
    }
    if (RITE[step] === name) {
        const next = step + 1;
        api.setVar("rite_step", next);
        if (next === 1) {
            yield api.say("Moon", "*a pale, patient light* Goodnight, traveller. Night keeps the watch - and I have kept it very long. Who comes after me?");
        } else if (next === 2) {
            yield api.say("Sun", "*a warm gold glow, like a hand at the back of the neck* Goodnight. Day gives the warmth, and I gave what I had. There's one more.");
        } else {
            yield api.say("Storm", "*a low, rolling rumble, softer than it sounds* Goodnight. And last, the storm that breaks it - and, this once, only breaks the lock.");
            yield api.say("Lara", "Night, day, storm. The Sexton's riddle in three goodnights.");
            api.setVar("rite_done", true);
            api.setBarrier("rite_gate", 0, 0, 1, 1, false);
            api.giveExperience(110);
            yield* companionSays("cobb_recruited", "Cobb", "Never thought I'd see the day a lock got put to bed.");
        }
    } else {
        api.setVar("rite_step", 0);
        yield api.say(RITE_NAME[name], "*a soft, unhurried flicker* Not yet. The riddle has an order. Start again, from the first hour.");
    }
}

function* talkToTownsfolk(name) {
    const lines = {
        farmgirl: ["I came back to lay a wreath and forgot to leave. There's a lot of that, here.",
                   "The carousel turns once a night. Never on the same night twice."],
        tribal_gatherer_girl: ["Flowers keep. Grief doesn't. I bring both.",
                                "The Sexton talks in riddles because the truth is too plain to say out loud."],
        innkeeper: ["Step right up! Free admission, on account of nobody to charge. Mind the ones who aren't there.",
                    "Tickets are just the memory of tickets. But the sausage rolls, oddly enough, are real."],
    }[name];
    const displayName = { farmgirl: "Mourner", tribal_gatherer_girl: "Gatherer", innkeeper: "Barker" }[name];
    const n = api.getVar("talk_" + name, 0);
    api.setVar("talk_" + name, n + 1);
    api.playSound("select");
    yield api.say(displayName, lines[n % lines.length]);
}

function* onEnemyDefeated(name) {
    if (Math.random() > 0.1)
        return;
    if (name === "wraith") {
        yield api.wait(0.3);
        yield api.say("Lara", "It didn't fight so much as forget to keep being here.");
    } else if (name === "zombie_peasant") {
        yield api.wait(0.3);
        yield api.say("Lara", "Rest, then. Somebody should.");
    }
}

function* onItemCollected(itemId) {
    if (itemId !== "wake_lantern")
        return;
    yield api.wait(0.3);
    yield api.say("Lara", "It lit the instant I touched it. Warm. Sad, in a way that's easy to live with.");
    yield api.say("???", "Fourth of ten. You did that gently. They'll remember it, in whatever way the dead remember.");
    yield api.say("Lara", "Do you? Remember, I mean. Every one of these places.");
    yield api.say("???", "Every one. Somewhere below all the others there's a market that never stops arguing about prices. That's next.");
    api.setGlobalVar("chapter", 11);
    api.playSound("select");
    yield api.wait(0.8);
    api.loadLevel("chapter11.json");
}
