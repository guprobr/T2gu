// ============================================================================
// ShadowShine - Chapter 19: "Gildmere"
// ============================================================================
//
// Two parts: the TOWN comes first, the MAZE after it. This level runs right to left
// (the hero spawns against the east edge). Map: 166x90, tileset grass_dirt, lighting mystical.
//   - town   cols 123-164
//   - maze   cols 11-122, rows 1-88, corridors 2 wide, walls 3 thick
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
const W = 166, H = 90;
const DIR = -1;                        // -1: this level runs right -> left
const START_U = 3;                        // the hero spawns this many columns in from the start edge
const MID = 41;                        // row of the road that leads to the maze gate
const TOWN_U = 42;                        // the town fills u = 1..TOWN_U (u counts from the start edge)
const MAZE_WEST = 11, MAZE_EAST = 122;   // absolute columns of the maze block
const MAZE_NORTH = 1, MAZE_SOUTH = 88;        // its rows
const MAZE_CORRIDOR = 2, MAZE_WALL = 3;
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
// Chapter 19 - "Gildmere" (grass_dirt, mystical). Runs RIGHT to LEFT. A dirt-lane
// village that was once the richest on the road, then the Gilded Meadow - a
// maze of hedged lawns under a shifting arcane glow.
//
// QUEST (cursed treasure): four heirlooms of Gildmere lie out in the meadow, and
// each one springs an ambush the moment it is picked up (enemies rise from the
// cells around it). Bring all four back to the Reeve and the road out, which
// will not open while the gilt is out of its place, is unsealed.
// ----------------------------------------------------------------------------
const TOWN = [
    ["wildflowers", 3, 24],
    ["bush", 4, 33],
    ["mushroom_cluster", 4, 38],
    ["berry_bush", 5, -28],
    ["mushroom_cluster", 5, 23],
    ["fence_straight", 6, 13],
    ["oak_tree", 6, 29],
    ["rocks_small", 8, -35],
    ["rocks_small", 8, -31],
    ["wildflowers", 9, -25],
    ["bench", 10, 36],
    ["haystack", 11, -8],
    ["haystack", 11, 23],
    ["cottage_a", 12, -36],
    ["berry_bush", 12, 32],
    ["rocks_small", 13, -17],
    ["cottage_b", 13, 20],
    ["bench", 14, -31],
    ["windmill", 14, -26],
    ["dovecote", 14, -23],
    ["cart", 14, -14],
    ["cottage_b", 14, 39],
    ["oak_tree", 15, -19],
    ["haystack", 15, 44],
    ["oak_tree", 16, 10],
    ["fence_straight", 16, 20],
    ["haystack", 16, 29],
    ["mushroom_cluster", 16, 36],
    ["wheelbarrow", 17, -11],
    ["bench", 17, 3],
    ["berry_bush", 17, 26],
    ["courtyard_well", 21, -4],
    ["notice_board", 25, -3],
    ["oak_tree", 25, 3],
    ["wheelbarrow", 26, -17],
    ["mushroom_cluster", 26, -15],
    ["market_stall", 27, 36],
    ["stone_fireplace", 28, -19],
    ["berry_bush", 28, 24],
    ["cart", 29, 41],
    ["bench", 30, 32],
    ["bush", 31, -24],
    ["chicken_coop", 31, -17],
    ["cottage_a", 31, 18],
    ["bench", 32, -34],
    ["rocks_small", 32, 6],
    ["wheelbarrow", 33, 30],
    ["berry_bush", 34, 10],
    ["chapel", 34, 14],
    ["mushroom_cluster", 34, 44],
    ["wildflowers", 35, 31],
    ["bush", 36, -4],
    ["fence_straight", 36, 19],
    ["wheelbarrow", 37, -35],
    ["haystack", 37, 17],
    ["fence_straight", 38, -26],
    ["wheelbarrow", 38, 13],
    ["wildflowers", 38, 35],
    ["fence_straight", 38, 39],
    ["rocks_small", 39, -23],
    ["bush", 39, 10],
    ["oak_tree", 40, -28],
    ["oak_tree", 40, 30]
];
const HEIRLOOMS = [
    // item id, display name, ambush: [[enemy, count, hp], ...]
    ["gildmere_chalice", "the chalice", [["slime_gold", 3, 30]]],
    ["gildmere_signet", "the signet", [["slime_bronze", 3, 30], ["imp", 2, 30]]],
    ["gildmere_censer", "the censer", [["goblin", 4, 35]]],
    ["gildmere_crown", "the crown", [["lizardman", 3, 45], ["slime_pearl", 2, 35]]],
];
let ambushSpots = [];   // per heirloom: the cells around it an ambush rises from (set by buildMaze)

function* onLevelStart() {
    api.spawnCharacter("lara_cyber", colAt(START_U), MID);
    api.giveControl("lara_cyber");
    respawnCompanions();

    buildTown();
    const exitRows = buildMaze();
    buildPocket();
    if (!api.getVar("gilt_returned_all", false))
        setExitGate("gilt_gate", exitRows, true);

    if (api.getVar("chapter19_intro_seen", false))
        return;
    api.setVar("chapter19_intro_seen", true);

    yield api.wait(0.6);
    yield api.say("Lara", "Gildmere. Every gate-post has a gilt finial and every finial has been polished by somebody who has nothing else left to polish.");
    yield* companionSays("nettle_recruited", "Nettle", "All this gold and nobody's eating properly. I could weep. I might. Later.");
    yield* companionSays("cobb_recruited", "Cobb", "Gilt is not gold, lass. It's gold's shy cousin. Still - it takes a proper dwarf to know.");
    yield api.say("Hint", "This level runs right to left. The town is behind you; the Gilded Meadow is ahead, to the west.");
}

function buildTown() {
    placeProps(TOWN);
    api.spawnProp("signpost", colAt(TOWN_U - 1), MID - 3);
    api.spawnProp("ley_light_wisp_cluster", colAt(TOWN_U), MID + 4);

    api.spawnNpc("elder", colAt(14), MID - 3);               // the Reeve
    api.spawnNpc("merchant", colAt(24), MID + 5);            // the Goldsmith
    api.spawnNpc("baker_2", colAt(10), MID + 6);             // Baker
    api.spawnNpc("farmhand_pitchfork", colAt(30), MID - 5);  // Hob

    if (api.getVar("town_loot_spawned", false))
        return;
    api.setVar("town_loot_spawned", true);
    api.spawnItem("health_potion", colAt(6), MID - 9);
    api.spawnItem("honey_jar", colAt(28), MID + 11);
    api.spawnItem("bread_loaf", colAt(34), MID - 12);
    api.spawnItem("health_potion", colAt(13), MID + 14);
}

function buildMaze() {
    const core = ["oak_tree", "cottage_b", "boulder_large", "haystack", "chapel", "stone_wall_corner"];
    const edge = ["bush", "wildflowers", "berry_bush", "fence_straight", "mushroom_cluster", "ley_light_wisp_cluster"];
    const cells = buildBranchingMaze(MAZE_WEST, MAZE_EAST, MAZE_NORTH, MAZE_SOUTH, MAZE_CORRIDOR, MAZE_WALL,
        core, edge, 191901, { flip: DIR < 0, diagonalSeam: true, solid: true });
    const pool = cells.slice();

    // One heirloom per quarter of the meadow; the ambush cells are the five nearest cells 4-14 tiles away.
    const bands = [[0.10, 0.28], [0.32, 0.50], [0.54, 0.72], [0.76, 0.94]];
    const spots = bands.map((b, k) => takeCells(pool, b[0], b[1], 1, 191902 + k)[0]);
    ambushSpots = spots.map(s => pool.map(c => ({ c, d: Math.hypot(c.col - s.col, c.row - s.row) }))
        .filter(x => x.d >= 4 && x.d <= 14).sort((a, b) => a.d - b.d).slice(0, 5).map(x => x.c));
    spawnLoot(spots, HEIRLOOMS.map(h => h[0]), "heirlooms_spawned");

    spawnPacks(takeCells(pool, 0.06, 1.0, 38, 191906),
        [["goblin", 10, 30], ["imp", 8, 30], ["lizardman", 8, 45], ["slime_gold", 6, 30], ["slime_bronze", 6, 30]],
        "maze_hostiles_spawned");

    spawnLoot(takeCells(pool, 0.05, 0.95, 11, 191910),
        ["health_potion", "health_potion", "health_potion", "health_potion", "health_potion", "health_potion",
         "mana_potion", "gold_coin_pile", "silver_coin_pouch", "elixir_of_clarity", "stamina_draught"], "maze_loot_spawned");
    return cells.exitRows;
}

function buildPocket() {
    const [c0, c1] = pocketCols();
    scatterOrganic(["oak_tree", "ley_light_wisp_cluster", "boulder_large", "bush"], c0, c1, MAZE_NORTH + 2, MAZE_SOUTH - 2, 8, 191920,
        [{ col: colAt(POCKET_U0 + 5), row: MID }]);
    if (!api.getVar("ledger_spawned", false)) {
        api.setVar("ledger_spawned", true);
        api.spawnItem("reeves_ledger", colAt(POCKET_U0 + 5), MID);
    }
}

function returnedCount() {
    return HEIRLOOMS.filter(h => api.getVar("returned_" + h[0], false)).length;
}

function* onTalkTo(name) {
    if (name === "elder") {
        yield* talkToReeve();
    } else if (name === "merchant" || name === "baker_2" || name === "farmhand_pitchfork") {
        yield* talkToTownsfolk(name);
    }
}

function* talkToReeve() {
    api.playSound("select");
    if (api.getVar("gilt_returned_all", false)) {
        yield api.say("Reeve", "Every piece back in its place, and the ground has stopped humming at me. Take the ledger. It has a page left blank on purpose - I'd like you to have the choosing of what goes on it.");
        return;
    }
    // Hand in whatever heirlooms are held (any number, any order).
    const held = HEIRLOOMS.filter(h => api.hasItem(h[0]) && !api.getVar("returned_" + h[0], false));
    if (held.length > 0) {
        for (const h of held) {
            api.removeItem(h[0], 1);
            api.setVar("returned_" + h[0], true);
            api.giveExperience(30);
        }
        const total = returnedCount();
        yield api.say("Reeve", "*he takes " + held.map(h => h[1]).join(" and ") + " in both hands, and his shoulders drop a little* Home. That's " + total + " of " + HEIRLOOMS.length + ".");
        if (total >= HEIRLOOMS.length) {
            api.setVar("gilt_returned_all", true);
            api.setBarrier("gilt_gate", 0, 0, 1, 1, false);
            api.giveExperience(100);
            yield api.say("Reeve", "That is all four. *he sets them on the old plinth, and the light in the room changes* The road will open now. It would not, before - a road cannot cross ground that is missing its treasure.");
            yield* companionSays("nettle_recruited", "Nettle", "I thought the gold was the curse. It was never the gold. It was that it wasn't where it belonged.");
        } else {
            yield api.say("Reeve", "Bring the rest when you have them. They will not come quietly - none of them did.");
        }
        return;
    }
    const n = api.getVar("reeve_talks", 0);
    api.setVar("reeve_talks", n + 1);
    if (n === 0) {
        yield api.say("Reeve", "Gildmere was the richest village on the road. Four heirlooms, kept on the plinth in the hall: a chalice, a signet, a censer and a crown. Gilt, not gold - but gilt that meant something.");
        yield api.say("Reeve", "When the hum stopped, they walked out. I don't say that lightly. They were on the plinth at dusk and in the Gilded Meadow by dawn, west of here, and something has been watching over each of them since.");
        yield api.say("Lara", "Watching how?");
        yield api.say("Reeve", "Every one that's been touched has called something up to look after it. Bring them home anyway. The road out will not open while they're gone.");
    } else {
        yield api.say("Reeve", "Chalice, signet, censer, crown. Four out in the meadow, and each one guarded when you lift it. I will hold the plinth for them.");
    }
}

function* talkToTownsfolk(name) {
    const lines = {
        merchant: ["I priced everything in this village once. Then the hum stopped, and I found I couldn't remember what a price was for.",
                   "Gilt over lead, gilt over wood - it's all the same underneath. It's what it did to the room that mattered."],
        baker_2: ["Bread doesn't care what your walls are gilded with. It just needs flour and someone who's up early.",
                  "The heirlooms sat in the hall for three hundred years, and we polished them every Sunday. Not once did anyone ask if they wanted to stay."],
        farmhand_pitchfork: ["I watched the chalice walk out. Honest - it just went, like a cat leaving a room it had decided was too loud.",
                             "Don't pick them up with your bare hand if you can help it. Well. You can't help it. Just - be ready to run."],
    }[name];
    const displayName = { merchant: "Goldsmith", baker_2: "Baker", farmhand_pitchfork: "Hob" }[name];
    const n = api.getVar("talk_" + name, 0);
    api.setVar("talk_" + name, n + 1);
    api.playSound("select");
    yield api.say(displayName, lines[n % lines.length]);
}

// Each heirloom springs its own ambush, once, the moment it is picked up.
function* springAmbush(index) {
    if (api.getVar("ambush_" + index, false))
        return;
    api.setVar("ambush_" + index, true);
    const spots = ambushSpots[index] || [];
    if (spots.length === 0)
        return;
    let i = 0;
    HEIRLOOMS[index][2].forEach(([enemy, count, hp]) => {
        for (let j = 0; j < count; j++) {
            const s = spots[i % spots.length];
            api.spawnEnemy(enemy, s.col, s.row, hp);
            i++;
        }
    });
}

function* onEnemyDefeated(name) {
    if (Math.random() > 0.1)
        return;
    if (name === "slime_gold") {
        yield api.wait(0.3);
        yield api.say("Lara", "It left a smear of gilt on the grass, and the grass took it back.");
    } else if (name === "imp") {
        yield api.wait(0.3);
        yield api.say("Lara", "It was only guarding what it thought was its own. So was everything else out here.");
    }
}

function* onItemCollected(itemId) {
    const index = HEIRLOOMS.findIndex(h => h[0] === itemId);
    if (index >= 0) {
        yield* springAmbush(index);
        yield api.say("Lara", "The moment my fingers close on " + HEIRLOOMS[index][1] + " the ground around me stirs. Something has been waiting for exactly this.");
        return;
    }
    if (itemId !== "reeves_ledger")
        return;
    yield api.wait(0.3);
    yield api.say("Lara", "A thin ledger, and I already know which page is the blank one. It's the last. Of course it is.");
    yield api.say("???", "Third of nine. You gave every heirloom back, and asked for nothing. I'll tell you a secret about gold, Lara: it is only ever heavy to the person carrying it away.");
    yield api.say("Lara", "That sounds like something someone once said to you.");
    yield api.say("???", "Someone said it to me at a river, once. Speaking of which - the next place has a flood in it that somebody built a lock to hold back, and then lost the keys of.");
    api.setGlobalVar("chapter", 20);
    api.playSound("select");
    yield api.wait(0.8);
    api.loadLevel("chapter20.json");
}
