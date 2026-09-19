// ============================================================================
// ShadowShine - Chapter 15: "The Vigil Lights"
// ============================================================================
//
// Two parts: the TOWN comes first, the MAZE after it. This level runs right to left
// (the hero spawns against the east edge). Map: 176x96, tileset snow_grass, lighting sunset.
//   - town   cols 129-174
//   - maze   cols 11-128, rows 1-94, corridors 2 wide, walls 4 thick
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
const W = 176, H = 96;
const DIR = -1;                        // -1: this level runs right -> left
const START_U = 3;                        // the hero spawns this many columns in from the start edge
const MID = 43;                        // row of the road that leads to the maze gate
const TOWN_U = 46;                        // the town fills u = 1..TOWN_U (u counts from the start edge)
const MAZE_WEST = 11, MAZE_EAST = 128;   // absolute columns of the maze block
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
// Chapter 15 - "The Vigil Lights" (snow_grass, sunset). Runs RIGHT to LEFT.
// A snowbound village that keeps a hundred lanterns lit through the longest
// night, then the Lanternway - a maze of frozen lanes strung with them - and
// at its far end the Vigil Light itself.
//
// QUEST (wave defense): since the hum, the lanterns draw things in. The
// Lamplighter asks Lara to hold the vigil at the Vigil Light: three waves
// come for the flame. Hold all three and the light steadies and the Lanternway's
// exit gate lifts. (Talk to the Light once for the briefing, again to begin;
// the waves then follow one another on their own.)
// ----------------------------------------------------------------------------
const TOWN = [
    ["bush", 3, 23],
    ["fence_straight", 3, 31],
    ["snowy_pine", 4, -38],
    ["snowy_pine", 4, 34],
    ["snowy_pine", 5, -24],
    ["snowy_pine", 6, -31],
    ["chapel", 6, -18],
    ["bench", 7, 30],
    ["snowy_pine", 7, 33],
    ["wheelbarrow", 8, -13],
    ["haystack", 8, 14],
    ["fence_straight", 10, -36],
    ["rocks_small", 10, -20],
    ["rain_barrel", 10, 21],
    ["pine_tree", 10, 45],
    ["rain_barrel", 11, -9],
    ["fence_straight", 13, 26],
    ["wheelbarrow", 14, -17],
    ["cottage_a", 15, -30],
    ["cottage_b", 16, -25],
    ["pine_tree", 16, -20],
    ["market_stall", 17, 34],
    ["haystack", 18, -30],
    ["cart", 18, -11],
    ["fence_straight", 19, -25],
    ["bench", 19, 3],
    ["cottage_a", 19, 31],
    ["snowy_pine", 19, 48],
    ["courtyard_well", 23, -4],
    ["notice_board", 27, -3],
    ["snowy_pine", 27, 3],
    ["rocks_small", 28, 25],
    ["stone_fireplace", 29, -40],
    ["haystack", 29, 44],
    ["laundry_line", 30, -16],
    ["rocks_small", 30, 24],
    ["rain_barrel", 30, 47],
    ["rocks_small", 31, -23],
    ["cottage_a", 33, 39],
    ["cottage_b", 33, 46],
    ["bench", 35, 8],
    ["rain_barrel", 36, -19],
    ["alley_lantern_post", 36, -3],
    ["bench", 36, 23],
    ["snowy_pine", 37, -37],
    ["haystack", 37, 12],
    ["bench", 37, 38],
    ["wheelbarrow", 38, 9],
    ["fence_straight", 39, -36],
    ["rain_barrel", 39, -4],
    ["haystack", 39, 40],
    ["haystack", 40, -7],
    ["windmill", 40, 24],
    ["snowy_pine", 41, -35],
    ["alley_lantern_post", 41, -3],
    ["bush", 42, -7],
    ["pine_tree", 42, 31],
    ["wheelbarrow", 42, 44],
    ["pine_tree", 42, 49],
    ["rocks_small", 43, -27],
    ["snowy_pine", 43, 7],
    ["bush", 43, 9],
    ["bush", 43, 21],
    ["bush", 43, 35],
    ["haystack", 44, -19]
];
const WAVES = [
    [["wolf", 6, 30]],
    [["ice_spirit", 5, 35], ["slime_ice", 3, 25]],
    [["tiger", 3, 70], ["wolf", 4, 30]],
];
const WAVE_NAMES = ["wolf", "ice_spirit", "slime_ice", "tiger"];
let waveSpots = [];

function* onLevelStart() {
    api.spawnCharacter("lara_cyber", colAt(START_U), MID);
    api.giveControl("lara_cyber");
    respawnCompanions();

    // A reload mid-vigil leaves no enemies behind, so an unfinished wave simply starts over on the next talk.
    api.setVar("vigil_active", false);
    api.setVar("vigil_alive", 0);

    buildTown();
    const exitRows = buildMaze();
    buildPocket();
    if (!api.getVar("vigil_held", false))
        setExitGate("vigil_gate", exitRows, true);

    if (api.getVar("chapter15_intro_seen", false))
        return;
    api.setVar("chapter15_intro_seen", true);

    yield api.wait(0.6);
    yield api.say("Lara", "Snow, and a sky the colour of embers. And lanterns - so many lanterns, strung along every fence and eave. It's like the whole village is holding its breath.");
    yield* companionSays("vigil_recruited", "Vigil", "A vigil. My name, my duty, and I have never once been asked to keep one. I confess I am a little moved.");
    yield* companionSays("cobb_recruited", "Cobb", "Lanterns, snow, and a village that clearly knows something's coming. I hate this. I love it. Both.");
    yield api.say("Hint", "This level runs right to left. The town is behind you; the Lanternway lies ahead, to the west.");
}

function buildTown() {
    placeProps(TOWN);
    api.spawnProp("signpost", colAt(TOWN_U - 1), MID - 3);
    api.spawnProp("alley_lantern_post", colAt(TOWN_U), MID + 4);

    api.spawnNpc("elder", colAt(14), MID - 3);               // the Lamplighter
    api.spawnNpc("lumberjack_2", colAt(24), MID + 5);        // Woodcutter
    api.spawnNpc("innkeeper", colAt(10), MID + 6);           // Innkeeper
    api.spawnNpc("tribal_archer_girl", colAt(30), MID - 5);  // the Watch

    if (api.getVar("town_loot_spawned", false))
        return;
    api.setVar("town_loot_spawned", true);
    api.spawnItem("dried_rations", colAt(6), MID - 9);
    api.spawnItem("health_potion", colAt(28), MID + 11);
    api.spawnItem("health_potion", colAt(34), MID - 12);
    api.spawnItem("stamina_draught", colAt(13), MID + 14);
    api.spawnItem("handheld_torch", colAt(20), MID - 10);
}

function buildMaze() {
    const core = ["snowy_pine", "pine_tree", "cottage_b", "boulder_large", "stone_wall_corner", "haystack"];
    const edge = ["alley_lantern_post", "rocks_small", "bush", "wildflowers", "standing_torch_sconce"];
    const cells = buildBranchingMaze(MAZE_WEST, MAZE_EAST, MAZE_NORTH, MAZE_SOUTH, MAZE_CORRIDOR, MAZE_WALL,
        core, edge, 151501, { flip: DIR < 0, diagonalSeam: true, solid: true });
    const pool = cells.slice();

    // The Vigil Light stands in the last stretch, on the near side of the exit gate.
    const light = takeCells(pool, 0.86, 0.94, 1, 151502)[0];
    api.spawnNpc("crystal_spirit", light.col, light.row);
    const dist = c => Math.hypot(c.col - light.col, c.row - light.row);
    waveSpots = pool.filter(c => dist(c) >= 4 && dist(c) <= 16).sort((a, b) => dist(a) - dist(b)).slice(0, 36);

    spawnPacks(takeCells(pool, 0.06, 0.84, 40, 151503),
        [["orc", 8, 45], ["goblin", 10, 30], ["skeleton_swordsman", 8, 35], ["skeleton_archer", 8, 30], ["ghoul", 6, 35]],
        "maze_hostiles_spawned");

    spawnLoot(takeCells(pool, 0.05, 0.95, 12, 151510),
        ["health_potion", "health_potion", "health_potion", "health_potion", "health_potion", "health_potion",
         "health_potion", "mana_potion", "elixir_of_clarity", "stamina_draught", "antidote_vial", "reinforced_boots"], "maze_loot_spawned");
    return cells.exitRows;
}

function buildPocket() {
    const [c0, c1] = pocketCols();
    scatterOrganic(["snowy_pine", "alley_lantern_post", "pine_tree", "boulder_large"], c0, c1, MAZE_NORTH + 2, MAZE_SOUTH - 2, 9, 151520,
        [{ col: colAt(POCKET_U0 + 5), row: MID }]);
    if (!api.getVar("lantern_spawned", false)) {
        api.setVar("lantern_spawned", true);
        api.spawnItem("vigil_lantern", colAt(POCKET_U0 + 5), MID);
    }
}

function* onTalkTo(name) {
    if (name === "elder") {
        yield* talkToLamplighter();
    } else if (name === "crystal_spirit") {
        yield* talkToVigilLight();
    } else if (name === "lumberjack_2" || name === "innkeeper" || name === "tribal_archer_girl") {
        yield* talkToTownsfolk(name);
    }
}

function* talkToLamplighter() {
    const n = api.getVar("lamplighter_talks", 0);
    api.setVar("lamplighter_talks", n + 1);
    api.playSound("select");
    if (api.getVar("vigil_held", false)) {
        yield api.say("Lamplighter", "Every lantern in the village steadied at once. I was on a ladder. I nearly cried, and then I nearly fell off. Go on through. Take the lantern.");
    } else if (n === 0) {
        yield api.say("Lamplighter", "A hundred lanterns, on the longest night, kept lit by hand. It's the oldest custom we have. The hum got into them this year - they gutter, and they call.");
        yield api.say("Lamplighter", "Things come to a light that calls. Wolves, mostly. Worse, later in the night. They all go for the Vigil Light - the great one, at the far end of the Lanternway, west of here.");
        yield api.say("Lara", "So somebody has to stand at it.");
        yield api.say("Lamplighter", "Somebody has to stand at it. Three waves, they say. Hold all three and the light steadies - and every lantern in the village along with it. I'd go myself, but I'm eighty and I have a ladder.");
    } else {
        yield api.say("Lamplighter", "The Vigil Light, at the end of the Lanternway. Talk to it once and it'll tell you what's coming. Twice, and it begins. Bring healing. Plenty of it.");
    }
}

// The vigil: waves follow one another on their own once the Light has been asked to begin.
function* talkToVigilLight() {
    api.playSound("select");
    if (api.getVar("vigil_held", false)) {
        yield api.say("Vigil Light", "*a bright, steady glow* The night is kept. Thank you.");
        return;
    }
    if (api.getVar("vigil_active", false)) {
        yield api.say("Vigil Light", "*the flame leans, straining* They're still coming. Keep them from me.");
        return;
    }
    if (!api.getVar("vigil_briefed", false)) {
        api.setVar("vigil_briefed", true);
        yield api.say("Vigil Light", "*a warm, wavering glow, like a candle that's been running a long time* You've come to keep the watch. Three waves come for me, each worse than the last. They aren't cruel. They're only drawn.");
        yield api.say("Vigil Light", "Stand near me. Heal when you need to. When you're ready, speak to me again and the first will come.");
        return;
    }
    const wave = api.getVar("vigil_wave", 0);
    api.setVar("vigil_active", true);
    yield api.say("Vigil Light", wave === 0 ? "*the flame flares* Here they come." : "*the flame flares once more* Here they come again.");
    spawnWave(wave);
}

function spawnWave(k) {
    let i = 0, alive = 0;
    WAVES[k].forEach(([name, count, hp]) => {
        for (let j = 0; j < count; j++) {
            const s = waveSpots[(i * 7 + k * 3) % waveSpots.length];
            api.spawnEnemy(name, s.col, s.row, hp);
            i++;
            alive++;
        }
    });
    api.setVar("vigil_alive", alive);
}

function* talkToTownsfolk(name) {
    const lines = {
        lumberjack_2: ["I cut the poles the lanterns hang from. A hundred of them, every year. Never had one go crooked before the hum.",
                       "Wolves don't scare me. It's the way they walk toward the light, without any hurry, that does."],
        innkeeper: ["Hot soup, warm bed, and every window lit. That's the whole of the winter trade. Don't go out into the dark without the first two.",
                    "The Lamplighter's not as frail as he lets on. He hauled a wolf off a fence-post last week by its tail."],
        tribal_archer_girl: ["I keep watch from the ridge. Something's shifted in the hills. The wolves go quiet before they run.",
                             "Every arrow I have has a lantern-oil rag on it. Don't laugh. It works, and it looks good."],
    }[name];
    const displayName = { lumberjack_2: "Woodcutter", innkeeper: "Innkeeper", tribal_archer_girl: "Watch" }[name];
    const n = api.getVar("talk_" + name, 0);
    api.setVar("talk_" + name, n + 1);
    api.playSound("select");
    yield api.say(displayName, lines[n % lines.length]);
}

function* onEnemyDefeated(name) {
    if (api.getVar("vigil_active", false) && WAVE_NAMES.indexOf(name) >= 0) {
        const alive = api.getVar("vigil_alive", 0) - 1;
        api.setVar("vigil_alive", alive);
        if (alive > 0)
            return;
        const done = api.getVar("vigil_wave", 0) + 1;
        api.setVar("vigil_wave", done);
        api.setVar("vigil_active", false);
        api.giveExperience(40);
        if (done < WAVES.length) {
            yield api.wait(0.6);
            yield api.say("Vigil Light", "*the flame steadies, just a little* That was the " + (done === 1 ? "first" : "second") + ". Catch your breath. Speak to me when you're ready for the next.");
            return;
        }
        api.setVar("vigil_held", true);
        api.setBarrier("vigil_gate", 0, 0, 1, 1, false);
        api.giveExperience(120);
        yield api.wait(0.6);
        yield api.say("Vigil Light", "*a long, golden, perfectly still light* ...That's all of them. The night is kept. Every lantern in the valley just steadied.");
        yield* companionSays("vigil_recruited", "Vigil", "I have kept a vigil. My name means something now.");
        yield api.say("Lara", "The gate's lifting. I can hear the chain from here.");
        return;
    }
    if (Math.random() > 0.1)
        return;
    if (name === "skeleton_archer") {
        yield api.wait(0.3);
        yield api.say("Lara", "Still standing its post in the snow. It never got the order to stop.");
    } else if (name === "ghoul") {
        yield api.wait(0.3);
        yield api.say("Lara", "It didn't want the light. It wanted the warmth. There's a difference, and I'm sorry for it.");
    }
}

function* onItemCollected(itemId) {
    if (itemId !== "vigil_lantern")
        return;
    yield api.wait(0.3);
    yield api.say("Lara", "It's small, and it's lit, and it doesn't flicker at all. It feels like a hand held out.");
    yield api.say("???", "Ninth of ten. You kept the watch, and you kept the light. Nobody will ever know how much depended on it.");
    yield api.say("Lara", "I will. That's enough.");
    yield api.say("???", "Then only one place remains - the Long Room. Everything you have walked has been leading you toward it. It's where the hum begins. It's where I've been waiting.");
    api.setGlobalVar("chapter", 16);
    api.playSound("select");
    yield api.wait(0.8);
    api.loadLevel("chapter16.json");
}
