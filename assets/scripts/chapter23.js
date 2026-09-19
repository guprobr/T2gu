// ============================================================================
// ShadowShine - Chapter 23: "Cartographers' Rest"
// ============================================================================
//
// Two parts: the TOWN comes first, the MAZE after it. This level runs right to left
// (the hero spawns against the east edge). Map: 176x96, tileset snow_grass, lighting none.
//   - town   cols 131-174
//   - maze   cols 11-130, rows 1-94, corridors 2 wide, walls 4 thick
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
const W = 176, H = 96;
const DIR = -1;                        // -1: this level runs right -> left
const START_U = 3;                        // the hero spawns this many columns in from the start edge
const MID = 43;                        // row of the road that leads to the maze gate
const TOWN_U = 44;                        // the town fills u = 1..TOWN_U (u counts from the start edge)
const MAZE_WEST = 11, MAZE_EAST = 130;   // absolute columns of the maze block
const MAZE_NORTH = 1, MAZE_SOUTH = 94;        // its rows
const MAZE_CORRIDOR = 2, MAZE_WALL = 4;
const POCKET_U0 = 165, POCKET_U1 = 174;   // the exit pocket beyond the maze (u), 10 columns

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
// Chapter 23 - "Cartographers' Rest" (snow_grass, no lighting - plain day). Runs
// RIGHT to LEFT. A green village in the snow where the land is measured, then
// the Survey - a maze of snowfields laid out on a grid.
//
// QUEST (coordinates): three brass survey benchmarks lie somewhere in the
// Survey. Each of three surveyors in the village knows the exact TILE
// COORDINATES of one of them, and says so aloud. The Cartographer gives the
// hero a compass; using it from the inventory (I, then Enter) prints the tile
// the hero is standing on. Walk the maze to each coordinate. The third
// benchmark closes the survey and lifts the exit gate - no need to walk back.
// The numbers are absolute map columns and rows, so this works for either
// direction; this level runs right to left, so columns count DOWN as you go.
// ----------------------------------------------------------------------------
const TOWN = [
    ["berry_bush", 3, 23],
    ["haystack", 3, 36],
    ["oak_tree", 4, 17],
    ["oak_tree", 4, 47],
    ["bush", 5, -24],
    ["rocks_small", 5, 40],
    ["market_stall", 7, 23],
    ["oak_tree", 8, -37],
    ["rocks_small", 8, -22],
    ["bush", 8, -15],
    ["windmill", 8, 21],
    ["bench", 10, 36],
    ["bush", 11, -34],
    ["pine_tree", 11, 43],
    ["stone_fireplace", 12, -40],
    ["pine_tree", 12, -31],
    ["rocks_small", 12, -19],
    ["berry_bush", 13, -36],
    ["fence_straight", 13, 41],
    ["snowy_pine", 14, 26],
    ["snowy_pine", 14, 34],
    ["rocks_small", 15, -26],
    ["laundry_line", 15, -10],
    ["fence_straight", 15, 19],
    ["bench", 16, 31],
    ["cottage_a", 16, 47],
    ["cottage_b", 17, -39],
    ["cottage_b", 17, -20],
    ["wheelbarrow", 17, 23],
    ["bench", 18, 3],
    ["bush", 18, 40],
    ["notice_board", 22, -4],
    ["well", 26, -3],
    ["snowy_pine", 26, 3],
    ["chapel", 27, 43],
    ["wheelbarrow", 29, -15],
    ["pine_tree", 30, -26],
    ["cottage_a", 31, -35],
    ["fence_straight", 31, -31],
    ["dovecote", 31, 21],
    ["cottage_b", 32, -16],
    ["wheelbarrow", 32, 19],
    ["oak_tree", 33, -23],
    ["cart", 33, 15],
    ["berry_bush", 34, -35],
    ["snowy_pine", 34, 30],
    ["haystack", 35, 48],
    ["bench", 37, -36],
    ["berry_bush", 37, -27],
    ["snowy_pine", 37, 11],
    ["pine_tree", 37, 14],
    ["haystack", 37, 18],
    ["pine_tree", 37, 40],
    ["haystack", 38, -20],
    ["rocks_small", 38, 31],
    ["wheelbarrow", 38, 49],
    ["bench", 39, 16],
    ["berry_bush", 39, 38],
    ["fence_straight", 40, -34],
    ["haystack", 40, 43],
    ["wheelbarrow", 41, -17],
    ["snowy_pine", 41, 33],
    ["oak_tree", 42, 21]
];
// surveyor NPC -> [display name, which benchmark, which stretch of the Survey]
const SURVEYORS = {
    tribal_archer_girl: ["Wynne", 0, "first"],
    lumberjack: ["Dov", 1, "middle"],
    herbalist: ["Fen", 2, "last"],
};
let markerSpots = [];   // the three benchmark cells (set by buildMaze) - the surveyors read the coordinates out of this

function* onLevelStart() {
    api.spawnCharacter("lara_cyber", colAt(START_U), MID);
    api.giveControl("lara_cyber");
    respawnCompanions();

    buildTown();
    const exitRows = buildMaze();
    buildPocket();
    if (!api.getVar("survey_done", false))
        setExitGate("survey_gate", exitRows, true);

    if (api.getVar("chapter23_intro_seen", false))
        return;
    api.setVar("chapter23_intro_seen", true);

    yield api.wait(0.6);
    yield api.say("Lara", "Plain daylight, no glow, no torches, no weather doing anything clever. After the last few places it is almost rude. Surveyors' stakes everywhere, and little brass discs set into the paving.");
    yield* companionSays("vex_recruited", "Vex", "Finally. A place that measures itself. I could stand in this square for a week and be content.");
    yield* companionSays("nettle_recruited", "Nettle", "Everything here is numbered. Even the benches. I find that comforting and slightly threatening.");
    yield api.say("Hint", "This level runs right to left. The town is behind you; the Survey is ahead, to the west.");
}

function buildTown() {
    placeProps(TOWN);
    api.spawnProp("signpost", colAt(TOWN_U - 1), MID - 3);

    api.spawnNpc("elder_2", colAt(14), MID - 3);                 // Cartographer Aldous
    api.spawnNpc("tribal_archer_girl", colAt(24), MID + 5);      // Wynne
    api.spawnNpc("lumberjack", colAt(10), MID + 6);              // Dov
    api.spawnNpc("herbalist", colAt(30), MID - 5);               // Fen

    if (api.getVar("town_loot_spawned", false))
        return;
    api.setVar("town_loot_spawned", true);
    api.spawnItem("health_potion", colAt(6), MID - 9);
    api.spawnItem("dried_rations", colAt(28), MID + 11);
    api.spawnItem("waterskin", colAt(34), MID - 12);
    api.spawnItem("health_potion", colAt(13), MID + 14);
}

function buildMaze() {
    const core = ["snowy_pine", "pine_tree", "boulder_large", "stone_wall_corner", "haystack", "cottage_b"];
    const edge = ["rocks_small", "bush", "tree_stump", "fence_straight", "broken_fence"];
    const cells = buildBranchingMaze(MAZE_WEST, MAZE_EAST, MAZE_NORTH, MAZE_SOUTH, MAZE_CORRIDOR, MAZE_WALL,
        core, edge, 232301, { flip: DIR < 0, diagonalSeam: true, solid: true });
    const pool = cells.slice();

    // One benchmark per stretch of the Survey, in a cell the maze really opens up (so the coordinates are walkable).
    const bands = [[0.10, 0.30], [0.38, 0.62], [0.70, 0.92]];
    markerSpots = bands.map((b, k) => takeCells(pool, b[0], b[1], 1, 232302 + k)[0]);
    spawnLoot(markerSpots, ["survey_marker", "survey_marker", "survey_marker"], "markers_spawned");

    spawnPacks(takeCells(pool, 0.06, 1.0, 36, 232306),
        [["wolf", 8, 30], ["bear", 6, 55], ["slime_ice", 8, 25], ["harpy", 6, 30], ["tiger", 4, 60], ["fox", 4, 25]],
        "maze_hostiles_spawned");

    spawnLoot(takeCells(pool, 0.05, 0.95, 11, 232310),
        ["health_potion", "health_potion", "health_potion", "health_potion", "health_potion", "health_potion",
         "mana_potion", "antidote_vial", "elixir_of_clarity", "stamina_draught", "reinforced_boots"], "maze_loot_spawned");
    return cells.exitRows;
}

function buildPocket() {
    const [c0, c1] = pocketCols();
    scatterOrganic(["snowy_pine", "ancient_obelisk", "pine_tree", "boulder_large"], c0, c1, MAZE_NORTH + 2, MAZE_SOUTH - 2, 8, 232320,
        [{ col: colAt(POCKET_U0 + 5), row: MID }]);
    if (!api.getVar("star_spawned", false)) {
        api.setVar("star_spawned", true);
        api.spawnItem("surveyors_star", colAt(POCKET_U0 + 5), MID);
    }
}

function* onTalkTo(name) {
    if (name === "elder_2") {
        yield* talkToCartographer();
    } else if (SURVEYORS[name]) {
        yield* talkToSurveyor(name);
    }
}

function* talkToCartographer() {
    const n = api.getVar("cartographer_talks", 0);
    api.setVar("cartographer_talks", n + 1);
    api.playSound("select");
    if (api.getVar("survey_done", false)) {
        yield api.say("Aldous", "Three benchmarks, one closed survey. It is the first time in forty years the whole valley has agreed with itself. Go on through - and take the star; it's yours by right of arithmetic.");
        return;
    }
    if (!api.getVar("compass_given", false)) {
        api.setVar("compass_given", true);
        api.giveItem("broken_compass", 1);
        yield api.say("Aldous", "Cartographers' Rest. Every stone in this village is set to a benchmark, and every benchmark is on the grid. Out in the Survey, west of here, three of them have gone astray - three brass discs, buried in the snowfields.");
        yield api.say("Aldous", "Three of my surveyors each know where one lies, to the tile. Talk to them; they'll read you the numbers. And take this compass. It is a poor one - it doesn't point anywhere - but it will tell you which tile you stand on.");
        yield api.say("Hint", "Open your inventory with I, select the compass and press Enter: it tells you the tile (column, row) you are standing on. Walk until your numbers match a surveyor's.");
        yield api.say("Aldous", "Find all three and the survey closes on its own; the exit at the far end of the Survey will unbar itself. You needn't come back to tell me.");
    } else if (n === 1) {
        yield api.say("Aldous", "Wynne, Dov and Fen. One benchmark each: first stretch, middle, last. The numbers are columns and rows, counted from the top-left corner of the whole map - so as you go west, the column falls.");
    } else {
        yield api.say("Aldous", "Compass in your pack, coordinates from my three surveyors. The Survey is a grid. Walk it like one.");
    }
}

function* talkToSurveyor(name) {
    const [who, idx, stretch] = SURVEYORS[name];
    api.playSound("select");
    const spot = markerSpots[idx];
    const n = api.getVar("surveyor_talks_" + name, 0);
    api.setVar("surveyor_talks_" + name, n + 1);
    if (n === 0) {
        yield api.say(who, "You're the one going into the Survey? Then you'll want my number. I'm the one who set the " + stretch + " benchmark, before it went astray.");
    }
    yield api.say(who, "It lies at tile (" + spot.col + ", " + spot.row + "). Column " + spot.col + ", row " + spot.row + ". " + (n === 0 ? "Write that down. I've never known anyone to keep a coordinate in their head past the first snowdrift." : "Column " + spot.col + ", row " + spot.row + ". Yes, still."));
    const found = api.getVar("markers_found", 0);
    if (found > 0)
        yield api.say(who, "I hear you've already dug up " + found + " of the three. If that includes mine, you can ignore the numbers - but I'd check the compass before you decide it does.");
}

function* onEnemyDefeated(name) {
    if (Math.random() > 0.1)
        return;
    if (name === "bear") {
        yield api.wait(0.3);
        yield api.say("Lara", "It had a surveyor's stake stuck in its fur. It must have been sitting on the benchmark for years.");
    } else if (name === "fox") {
        yield api.wait(0.3);
        yield api.say("Lara", "Quick, quiet, and gone. Even the foxes out here move in straight lines.");
    }
}

function* onItemCollected(itemId) {
    if (itemId === "survey_marker") {
        const found = api.getVar("markers_found", 0) + 1;
        api.setVar("markers_found", found);
        api.giveExperience(30);
        if (found >= 3) {
            api.setVar("survey_done", true);
            api.setBarrier("survey_gate", 0, 0, 1, 1, false);
            api.giveExperience(100);
            yield api.say("Lara", "That's the third disc. The compass in my pack gave a small click, like a lid closing, and somewhere ahead a long iron bar slid back. The survey has closed itself.");
            yield* companionSays("vex_recruited", "Vex", "Three points define a plane. That may be the most beautiful sentence in any language.");
        } else {
            yield api.say("Lara", "A brass disc, stamped with a coordinate that has been rubbed out. " + found + " of 3.");
        }
        return;
    }
    if (itemId !== "surveyors_star")
        return;
    yield api.wait(0.3);
    yield api.say("Lara", "A star of brass points. When I turn it, one point stays pointing at a spot I can't see, and it's not north.");
    yield api.say("???", "Seventh of nine. A map is only a promise that a place will be where you left it. Sometimes you have to go and make the promise true.");
    yield api.say("Lara", "You keep talking about promises. Who made you one?");
    yield api.say("???", "Someone who thought better of it, and didn't say so. The next place has a court in session over a crime I would rather it hadn't happened. I'll be listening.");
    api.setGlobalVar("chapter", 24);
    api.playSound("select");
    yield api.wait(0.8);
    api.loadLevel("chapter24.json");
}
