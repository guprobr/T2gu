// ============================================================================
// ShadowShine - Chapter 9: "Highgate Toll"
// ============================================================================
//
// Two parts: the TOWN comes first, the MAZE after it. This level runs right to left
// (the hero spawns against the east edge). Map: 168x90, tileset grass_stone, lighting sunset.
//   - town   cols 121-166
//   - maze   cols 11-120, rows 1-88, corridors 2 wide, walls 4 thick
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
const W = 168, H = 90;
const DIR = -1;                        // -1: this level runs right -> left
const START_U = 3;                        // the hero spawns this many columns in from the start edge
const MID = 43;                        // row of the road that leads to the maze gate
const TOWN_U = 46;                        // the town fills u = 1..TOWN_U (u counts from the start edge)
const MAZE_WEST = 11, MAZE_EAST = 120;   // absolute columns of the maze block
const MAZE_NORTH = 1, MAZE_SOUTH = 88;        // its rows
const MAZE_CORRIDOR = 2, MAZE_WALL = 4;
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
// Chapter 9 - "Highgate Toll" (grass_stone, sunset). Runs RIGHT to LEFT: a
// hill-fort village on grass with worn stone roads, then a stone-floored
// fortress maze, under a long orange sunset.
//
// QUEST (bounty / kill-count): trolls have taken the toll road. The Reeve has
// posted a bounty - five trolls - and the toll-bar at the far end of the
// Highgate maze (the maze's exit) stays down until it's collected. Eight
// trolls roam the maze; kill any five.
// ----------------------------------------------------------------------------
const TOWN = [
    ["boulder_large", 4, -19],
    ["castle_wall_section", 4, 19],
    ["fence_corner", 5, -33],
    ["castle_banner_wallmount", 5, 13],
    ["market_stall", 6, -24],
    ["water_trough", 8, 19],
    ["cart", 9, -25],
    ["boulder_large", 9, 12],
    ["oak_tree", 9, 41],
    ["oak_tree", 10, -32],
    ["bush", 10, -19],
    ["castle_banner_wallmount", 11, -35],
    ["rocks_small", 11, 19],
    ["fence_straight", 11, 25],
    ["castle_banner_wallmount", 12, -27],
    ["water_trough", 12, 27],
    ["water_trough", 12, 35],
    ["haystack", 13, 43],
    ["oak_tree", 14, 41],
    ["siege_ballista", 16, -35],
    ["armory_rack", 17, 20],
    ["bush", 17, 27],
    ["market_stall", 18, -9],
    ["boulder_large", 18, 14],
    ["cottage_b", 19, -23],
    ["armory_rack", 19, 3],
    ["well", 20, -3],
    ["notice_board", 26, -3],
    ["water_trough", 27, 3],
    ["cart", 28, -16],
    ["cottage_a", 28, -13],
    ["cottage_a", 28, 21],
    ["haystack", 29, -38],
    ["rocks_small", 30, -34],
    ["haystack", 30, 41],
    ["boulder_large", 31, -37],
    ["cart", 31, 23],
    ["bush", 32, -25],
    ["haystack", 32, -16],
    ["cottage_b", 32, 19],
    ["water_trough", 33, -35],
    ["water_trough", 33, 14],
    ["boulder_large", 33, 32],
    ["fence_straight", 33, 34],
    ["oak_tree", 33, 40],
    ["fence_straight", 35, -20],
    ["haystack", 35, 6],
    ["haystack", 36, -24],
    ["corner_turret", 36, 23],
    ["fence_corner", 37, -20],
    ["fence_corner", 38, 37],
    ["castle_gate_tower", 39, 8],
    ["bush", 39, 32],
    ["fence_straight", 40, -23],
    ["rocks_small", 41, -20],
    ["cart", 41, -10],
    ["fence_corner", 41, -7],
    ["rocks_small", 41, 16],
    ["armory_rack", 43, 13],
    ["fence_straight", 44, -10],
    ["castle_banner_wallmount", 44, 37]
];
const BOUNTY = 5;

function* onLevelStart() {
    api.spawnCharacter("lara_cyber", colAt(START_U), MID);
    api.giveControl("lara_cyber");
    respawnCompanions();

    buildTown();
    const exitRows = buildMaze();
    buildPocket();
    if (!api.getVar("bounty_done", false))
        setExitGate("toll_bar", exitRows, true);

    if (api.getVar("chapter9_intro_seen", false))
        return;
    api.setVar("chapter9_intro_seen", true);

    yield api.wait(0.6);
    yield api.say("Lara", "A fort on a hill, sunset the colour of old copper. Somebody has been collecting tolls here for a very long time.");
    yield* companionSays("vigil_recruited", "Vigil", "A proper gatehouse. Crenels, murder holes, a banner nobody has dared take down. I approve.");
    yield* companionSays("cobb_recruited", "Cobb", "Good stonework. Dry-laid, no mortar. That wall'll outlive the hill.");
    yield api.say("Hint", "This level runs right to left. The town is behind you; the fortress maze is ahead, to the west.");
}

function buildTown() {
    placeProps(TOWN);
    api.spawnProp("signpost", colAt(TOWN_U - 1), MID - 3);
    api.spawnProp("castle_banner_wallmount", colAt(TOWN_U), MID - 4);
    api.spawnProp("castle_banner_wallmount", colAt(TOWN_U), MID + 5);

    api.spawnNpc("elder_2", colAt(14), MID - 3);          // the Reeve
    api.spawnNpc("dwarf_warrior", colAt(24), MID + 5);    // the Captain of the gate-guard
    api.spawnNpc("blacksmith", colAt(10), MID + 6);
    api.spawnNpc("merchant", colAt(30), MID - 5);

    if (api.getVar("town_loot_spawned", false))
        return;
    api.setVar("town_loot_spawned", true);
    api.spawnItem("iron_sword", colAt(6), MID - 9);
    api.spawnItem("round_shield", colAt(28), MID + 11);
    api.spawnItem("whetstone", colAt(34), MID - 12);
    api.spawnItem("health_potion", colAt(13), MID + 14);
}

function buildMaze() {
    const core = ["castle_wall_section", "boulder_large", "stone_wall_corner", "stone_wall_corner_alt", "cliff_face", "corner_turret"];
    const edge = ["rocks_small", "ivy_rock", "bush", "tree_stump", "fence_corner"];
    const cells = buildBranchingMaze(MAZE_WEST, MAZE_EAST, MAZE_NORTH, MAZE_SOUTH, MAZE_CORRIDOR, MAZE_WALL,
        core, edge, 90901, { flip: DIR < 0, diagonalSeam: true, solid: true });
    const pool = cells.slice();

    // The eight trolls (the bounty) are spread through the whole maze; the rest of the hostiles fill in.
    spawnPacks(takeCells(pool, 0.10, 1.0, 8, 90902), [["troll", 8, 70]], "trolls_spawned");
    spawnPacks(takeCells(pool, 0.06, 1.0, 34, 90903),
        [["orc", 14, 40], ["goblin", 12, 30], ["wolf", 8, 30]], "maze_hostiles_spawned");

    spawnLoot(takeCells(pool, 0.05, 0.95, 12, 90910),
        ["health_potion", "health_potion", "health_potion", "health_potion", "health_potion", "health_potion",
         "silver_coin_pouch", "leather_gloves", "reinforced_boots", "stamina_draught", "gold_coin_pile", "mana_potion"], "maze_loot_spawned");
    return cells.exitRows;
}

function buildPocket() {
    const [c0, c1] = pocketCols();
    scatterOrganic(["castle_banner_wallmount", "boulder_large", "oak_tree", "stone_wall_corner"], c0, c1, MAZE_NORTH + 2, MAZE_SOUTH - 2, 9, 90920,
        [{ col: colAt(POCKET_U0 + 5), row: MID }, { col: colAt(POCKET_U0 + 2), row: MID + 3 }]);
    api.spawnNpc("dwarf_bomber", colAt(POCKET_U0 + 2), MID + 3);    // the tollkeeper's man on the far side
    if (!api.getVar("seal_spawned", false)) {
        api.setVar("seal_spawned", true);
        api.spawnItem("tollkeeper_seal", colAt(POCKET_U0 + 5), MID);
    }
}

function* onTalkTo(name) {
    if (name === "elder_2") {
        yield* talkToReeve();
    } else if (name === "dwarf_bomber") {
        yield* talkToTollman();
    } else if (name === "dwarf_warrior" || name === "blacksmith" || name === "merchant") {
        yield* talkToTownsfolk(name);
    }
}

function* talkToReeve() {
    const n = api.getVar("reeve_talks", 0);
    api.setVar("reeve_talks", n + 1);
    api.playSound("select");
    const kills = api.getVar("troll_kills", 0);
    if (api.getVar("bounty_done", false)) {
        yield api.say("Reeve", "Five trolls, and the toll-bar's up. I've never seen the road so quiet. Take the seal - the tollkeeper won't argue with it.");
    } else if (n === 0) {
        yield api.say("Reeve", "Highgate keeps a toll. Always has. It buys the road its upkeep - and lately trolls have been keeping the road instead.");
        yield api.say("Reeve", "The bounty's posted: five of them, from the Highgate maze to the west. The toll-bar there drops when the bounty's collected, not before. There are eight out there. You'll know them; they're the ones that don't step aside.");
        yield api.say("Lara", "Five trolls. That's a lot of road.");
        yield api.say("Reeve", "It's a lot of trolls.");
    } else {
        yield api.say("Reeve", kills === 0 ? "Five to collect. None yet. The maze is west, through the stone gate." : kills + " of " + BOUNTY + " collected. Keep on.");
    }
}

function* talkToTollman() {
    api.playSound("select");
    if (api.getVar("bounty_done", false)) {
        yield api.say("Tollman", "Bar's up. The seal's on the bench behind me. Don't let it go to your head.");
    } else {
        yield api.say("Tollman", "Toll-bar's down. Bounty's the price of a raise, and I'm told you're still short. I can wait. I'm very good at waiting.");
    }
}

function* talkToTownsfolk(name) {
    const lines = {
        dwarf_warrior: ["Captain of the gate-guard, which is a grand way of saying I stand near the gate. The trolls don't care about the title.",
                        "Don't take the walls head-on. Trolls hate a corner. So do I, but I hate it quietly."],
        blacksmith: ["I sharpen. I don't fight. But I've never sharpened so many blades in one week.",
                     "Whetstone's on the bench. Take it. Trolls chip a blade like it's a personal favour."],
        merchant: ["Toll's the reason there's a road. Trolls are the reason there isn't. Somebody will have to decide which matters more.",
                   "The sunset's free, at least. Best view in the county."],
    }[name];
    const displayName = { dwarf_warrior: "Captain", blacksmith: "Smith", merchant: "Merchant" }[name];
    const n = api.getVar("talk_" + name, 0);
    api.setVar("talk_" + name, n + 1);
    api.playSound("select");
    yield api.say(displayName, lines[n % lines.length]);
}

// The bounty: count troll kills. Lift the toll-bar at the fifth.
function* onEnemyDefeated(name) {
    if (name === "troll" && !api.getVar("bounty_done", false)) {
        const kills = api.getVar("troll_kills", 0) + 1;
        api.setVar("troll_kills", kills);
        api.playSound("select");
        if (kills === BOUNTY) {
            api.setVar("bounty_done", true);
            api.setBarrier("toll_bar", 0, 0, 1, 1, false);
            api.giveExperience(120);
            yield api.wait(0.3);
            yield api.say("Lara", "That's the fifth. Somewhere far west a chain rattles and a heavy bar swings up.");
            yield* companionSays("vigil_recruited", "Vigil", "The bounty stands paid. It was an honour.");
        } else if (kills === 2 || kills === 4) {
            yield api.wait(0.3);
            yield api.say("Lara", kills + " of " + BOUNTY + ".");
        }
        return;
    }
    if (Math.random() > 0.1)
        return;
    if (name === "orc") {
        yield api.wait(0.3);
        yield api.say("Lara", "Trained, at least. Somebody paid for that discipline.");
    } else if (name === "goblin") {
        yield api.wait(0.3);
        yield api.say("Lara", "Scouts for the trolls, I think. The trolls do like a warning.");
    }
}

function* onItemCollected(itemId) {
    if (itemId !== "tollkeeper_seal")
        return;
    yield api.wait(0.3);
    yield api.say("Lara", "It's heavier than it looks. Iron and wax, and somewhere inside, the smallest hum.");
    yield api.say("???", "Third of ten. Tolls are only ever paid for one thing, Lara: passage. The whole road has been asking for it.");
    yield api.say("Lara", "Then it can have it. Where next?");
    yield api.say("???", "Toward the place where the dead hold a fair, and nobody's told them it ended.");
    api.setGlobalVar("chapter", 10);
    api.playSound("select");
    yield api.wait(0.8);
    api.loadLevel("chapter10.json");
}
