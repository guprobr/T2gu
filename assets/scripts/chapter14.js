// ============================================================================
// ShadowShine - Chapter 14: "Mirrorwater Ford"
// ============================================================================
//
// Two parts: the TOWN comes first, the MAZE after it. This level runs left to right
// (the hero spawns against the west edge). Map: 164x84, tileset grass_water, lighting mystical.
//   - town   cols 1-40
//   - river  cols 41-44 (one ford)
//   - maze   cols 45-154, rows 1-82, corridors 2 wide, walls 4 thick
//   - pocket cols 155-162 (where the maze lets out)
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
const W = 164, H = 84;
const DIR = 1;                        // 1: this level runs left -> right
const START_U = 3;                        // the hero spawns this many columns in from the start edge
const MID = 37;                        // row of the road that leads to the maze gate
const TOWN_U = 40;                        // the town fills u = 1..TOWN_U (u counts from the start edge)
const MAZE_WEST = 45, MAZE_EAST = 154;   // absolute columns of the maze block
const MAZE_NORTH = 1, MAZE_SOUTH = 82;        // its rows
const MAZE_CORRIDOR = 2, MAZE_WALL = 4;
const POCKET_U0 = 155, POCKET_U1 = 162;   // the exit pocket beyond the maze (u), 8 columns

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
// Chapter 14 - "Mirrorwater Ford" (grass_water, mystical). Runs LEFT to RIGHT.
// A river village whose water keeps a copy of everything that crosses it, a
// single ford, and beyond it the Glass Maze - reeds, standing stones and
// shards of a mirror that isn't there any more.
//
// QUEST (a toll paid in town): the ford is closed. The Ferrywoman on the
// near bank will only let you cross once you leave three valuables with the
// river - the ford's rent. Valuables are lying around the village (and more
// in the maze, for anyone who over-pays). Pay, and the crossing opens.
// ----------------------------------------------------------------------------
const TOWN = [
    ["fence_straight", 3, 14],
    ["fence_straight", 4, 17],
    ["wildflowers", 4, 25],
    ["wildflowers", 4, 27],
    ["wheelbarrow", 4, 32],
    ["cottage_a", 5, -21],
    ["rocks_small", 5, 14],
    ["haystack", 6, 17],
    ["fence_straight", 6, 24],
    ["bush", 7, 11],
    ["rain_barrel", 8, -32],
    ["mushroom_cluster", 9, 23],
    ["berry_bush", 9, 30],
    ["oak_tree", 10, 26],
    ["windmill", 10, 35],
    ["mushroom_cluster", 10, 42],
    ["cottage_b", 11, -34],
    ["market_stall", 11, 21],
    ["chicken_coop", 12, 43],
    ["laundry_line", 13, -10],
    ["rain_barrel", 13, 35],
    ["chapel", 14, 28],
    ["mushroom_cluster", 14, 41],
    ["wildflowers", 15, -31],
    ["fence_straight", 15, -10],
    ["bench", 16, 3],
    ["rocks_small", 16, 9],
    ["berry_bush", 16, 35],
    ["bench", 16, 41],
    ["whispering_well", 20, -4],
    ["notice_board", 24, -3],
    ["oak_tree", 24, 3],
    ["rain_barrel", 25, -33],
    ["oak_tree", 25, -19],
    ["oak_tree", 25, 41],
    ["berry_bush", 27, -14],
    ["bush", 28, -18],
    ["rocks_small", 28, 34],
    ["wheelbarrow", 28, 38],
    ["bush", 29, 30],
    ["haystack", 29, 40],
    ["cottage_b", 30, -31],
    ["wildflowers", 30, -25],
    ["berry_bush", 30, -12],
    ["market_stall", 30, 5],
    ["bush", 31, -23],
    ["reeds", 31, 30],
    ["reeds", 32, -29],
    ["mushroom_cluster", 32, 17],
    ["bench", 33, 15],
    ["rocks_small", 33, 23],
    ["wheelbarrow", 34, 28],
    ["reeds", 34, 35],
    ["cottage_a", 35, -18],
    ["rain_barrel", 35, -5],
    ["haystack", 35, 12],
    ["bench", 36, -31],
    ["vegetable_garden", 36, -24],
    ["wheelbarrow", 36, 32],
    ["dovecote", 37, -16],
    ["oak_tree", 37, 15],
    ["cottage_b", 37, 19],
    ["bench", 38, 43]
];
const RIVER_COLS = 4;
const TOLL = 3;
const VALUABLES = ["silver_coin_pouch", "pearl_strand", "ancient_coin", "ornate_ring", "gold_coin_pile", "jeweled_pendant"];

function* onLevelStart() {
    api.spawnCharacter("lara_cyber", colAt(START_U), MID);
    api.giveControl("lara_cyber");
    respawnCompanions();

    buildTown();
    buildMaze();
    buildPocket();
    if (!api.getVar("toll_paid", false))
        setFordGate(true);

    if (api.getVar("chapter14_intro_seen", false))
        return;
    api.setVar("chapter14_intro_seen", true);

    yield api.wait(0.6);
    yield api.say("Lara", "A river so still it looks like a second sky. There's a village on this bank and another - the same one, upside down - underneath it.");
    yield* companionSays("nettle_recruited", "Nettle", "Don't look down for too long. Something in there looks back a little late.");
    yield* companionSays("vigil_recruited", "Vigil", "I do not care for water that does not move. It is always waiting on something.");
    yield api.say("Hint", "This level runs left to right. The town is behind you; the Glass Maze lies beyond the river, to the east.");
}

// The ford: a land gap through the river, rows MID-1..MID+2. The gate covers exactly the river's columns.
function setFordGate(blocked) {
    const a = colAt(TOWN_U + 1), b = colAt(TOWN_U + RIVER_COLS);
    api.setBarrier("ford_gate", Math.min(a, b), MID - 1, RIVER_COLS, 4, blocked);
}

function buildTown() {
    placeProps(TOWN);

    for (let r = MAZE_NORTH + 3; r < MAZE_SOUTH - 2; r += 4) {
        if (r >= MID - 3 && r <= MID + 4)
            continue;
        api.spawnProp("reeds", colAt(TOWN_U), r);
        if (r % 8 === 3)
            api.spawnProp("lily_pads", colAt(TOWN_U + 2), r + 1);
    }
    api.spawnProp("wooden_bridge", colAt(TOWN_U + 2), MID);
    api.spawnProp("signpost", colAt(TOWN_U - 2), MID - 3);

    api.spawnNpc("angler", colAt(39), MID - 2);          // the Ferrywoman
    api.spawnNpc("herbalist", colAt(14), MID - 3);       // Mossback
    api.spawnNpc("baker_2", colAt(24), MID + 5);         // Baker
    api.spawnNpc("farmhand_young", colAt(10), MID + 6);  // Reed
    api.spawnNpc("fisherman", colAt(30), MID - 5);       // Fisher

    if (api.getVar("town_loot_spawned", false))
        return;
    api.setVar("town_loot_spawned", true);
    api.spawnItem("silver_coin_pouch", colAt(6), MID - 9);
    api.spawnItem("pearl_strand", colAt(28), MID + 11);
    api.spawnItem("ancient_coin", colAt(34), MID - 12);
    api.spawnItem("ornate_ring", colAt(13), MID + 14);
    api.spawnItem("health_potion", colAt(20), MID + 9);
}

function buildMaze() {
    const core = ["shattered_mirror_shard", "ancient_obelisk", "runic_standing_stone", "broken_arcane_statue", "oak_tree", "ruined_chapel"];
    const edge = ["reeds", "wildflowers", "mushroom_cluster", "ley_light_wisp_cluster", "rocks_small"];
    const cells = buildBranchingMaze(MAZE_WEST, MAZE_EAST, MAZE_NORTH, MAZE_SOUTH, MAZE_CORRIDOR, MAZE_WALL,
        core, edge, 141401, { flip: DIR < 0, diagonalSeam: true, solid: true });
    const pool = cells.slice();

    spawnPacks(takeCells(pool, 0.06, 1.0, 42, 141402),
        [["water_spirit", 10, 30], ["slime_water", 10, 25], ["crocodile", 6, 50], ["harpy", 8, 30], ["wraith", 8, 45]],
        "maze_hostiles_spawned");

    spawnLoot(takeCells(pool, 0.05, 0.95, 11, 141410),
        ["health_potion", "health_potion", "health_potion", "health_potion", "health_potion", "health_potion",
         "mana_potion", "sealed_vial_of_mist", "jeweled_pendant", "elixir_of_clarity", "stamina_draught"], "maze_loot_spawned");
    return cells.exitRows;
}

function buildPocket() {
    const [c0, c1] = pocketCols();
    scatterOrganic(["shattered_mirror_shard", "ley_light_wisp_cluster", "runic_standing_stone", "will_o_wisp"], c0, c1, MAZE_NORTH + 2, MAZE_SOUTH - 2, 7, 141420,
        [{ col: colAt(POCKET_U0 + 4), row: MID }]);
    if (!api.getVar("shard_spawned", false)) {
        api.setVar("shard_spawned", true);
        api.spawnItem("mirror_shard", colAt(POCKET_U0 + 4), MID);
    }
}

function valuablesHeld() {
    let n = 0;
    VALUABLES.forEach(id => { n += api.getItemCount(id); });
    return n;
}

function* onTalkTo(name) {
    if (name === "angler") {
        yield* talkToFerrywoman();
    } else if (name === "herbalist" || name === "baker_2" || name === "farmhand_young" || name === "fisherman") {
        yield* talkToTownsfolk(name);
    }
}

function* talkToFerrywoman() {
    api.playSound("select");
    if (api.getVar("toll_paid", false)) {
        yield api.say("Ferrywoman", "It's kept its rent, so it's kept its word. Cross when you like. Try not to wave at your reflection - it gets ideas.");
        return;
    }
    const held = valuablesHeld();
    const first = !api.getVar("ferry_met", false);
    api.setVar("ferry_met", true);
    if (first) {
        yield api.say("Ferrywoman", "The ford's closed. It closes itself, the moment anyone gets near it with nothing to give. The river keeps a copy of everything that crosses, you see, and it's got a very good eye for what's worth copying.");
        yield api.say("Ferrywoman", "The rent is three valuables. Anything with a shine and a story - coins, pearls, a ring. Leave them with me and I'll drop them in. The river takes them down to the other village, the reflected one, and the ford opens.");
        yield api.say("Lara", "That's what the toll is? A donation to a river?");
        yield api.say("Ferrywoman", "It's rent, love. Everyone has one landlord or another.");
    }
    if (held < TOLL) {
        yield api.say("Ferrywoman", "You're carrying " + held + ". I need " + TOLL + ". Look about the village - folk lose things all the time, and the river isn't the only one that keeps them.");
        return;
    }
    let owed = TOLL;
    VALUABLES.forEach(id => {
        const take = Math.min(api.getItemCount(id), owed);
        if (take > 0) {
            api.removeItem(id, take);
            owed -= take;
        }
    });
    api.setVar("toll_paid", true);
    setFordGate(false);
    api.giveExperience(90);
    yield api.say("Ferrywoman", "*she holds them out over the water, one at a time; each is gone before it lands* There. Paid in full. You can hear it, can't you? The river settling.");
    yield api.say("Lara", "The ford's open?");
    yield api.say("Ferrywoman", "It's open. What's on the far side is a matter between you and whatever you brought.");
    yield* companionSays("cobb_recruited", "Cobb", "Paid rent to a river. I've been evicted for less.");
}

function* talkToTownsfolk(name) {
    const lines = {
        herbalist: ["Reeds, cattails, a little marsh mint. The river gives more than it takes, mostly. It only takes when it's asked to.",
                    "Some of the herbs I grow on this bank grow, in exact copy, in the reflected village. I've never checked which one is the real one."],
        baker_2: ["Bread tastes better on this side of the ford. I don't know why. I've never eaten any on the other.",
                  "The bakery in the reflected village has the exact same smell. Which is upsetting, because I haven't lit my oven today."],
        farmhand_young: ["I dropped my grandmother's ring in the reflection once. Not the river - the reflection. Nothing splashed.",
                         "The Ferrywoman says the river likes shiny things. I say it likes the *idea* of shiny things. Same result."],
        fisherman: ["I don't fish the ford. Nobody does. The fish in it are the wrong way up.",
                    "Cross at dawn if you can. At dawn the two villages agree with each other."],
    }[name];
    const displayName = { herbalist: "Mossback", baker_2: "Baker", farmhand_young: "Reed", fisherman: "Fisher" }[name];
    const n = api.getVar("talk_" + name, 0);
    api.setVar("talk_" + name, n + 1);
    api.playSound("select");
    yield api.say(displayName, lines[n % lines.length]);
}

function* onEnemyDefeated(name) {
    if (Math.random() > 0.1)
        return;
    if (name === "water_spirit") {
        yield api.wait(0.3);
        yield api.say("Lara", "It went back into the river the way a story goes back into a book.");
    } else if (name === "wraith") {
        yield api.wait(0.3);
        yield api.say("Lara", "It had my face, for a second. I'd rather it hadn't.");
    }
}

function* onItemCollected(itemId) {
    if (itemId !== "mirror_shard")
        return;
    yield api.wait(0.3);
    yield api.say("Lara", "I held it up and saw myself... and someone a step behind me, who wasn't a reflection. Then just me again.");
    yield api.say("???", "Eighth of ten. You saw it, then. Good. Most people keep their eyes on the glass and miss the one who's standing beside it.");
    yield api.say("Lara", "Who was that?");
    yield api.say("???", "The next place will ask you to keep a vigil, not walk one. Bring patience, and a great many lanterns.");
    api.setGlobalVar("chapter", 15);
    api.playSound("select");
    yield api.wait(0.8);
    api.loadLevel("chapter15.json");
}
