// ============================================================================
// ShadowShine - Chapter 7: "The Frostmarket"
// ============================================================================
//
// Two parts: the TOWN comes first, the MAZE after it. This level runs right to left
// (the hero spawns against the east edge). Map: 156x84, tileset dirt_snow, lighting sunrise.
//   - town   cols 113-154
//   - maze   cols 13-112, rows 1-82, corridors 2 wide, walls 3 thick
//   - pocket cols 1-12 (where the maze lets out)
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
const W = 156, H = 84;
const DIR = -1;                        // -1: this level runs right -> left
const START_U = 3;                        // the hero spawns this many columns in from the start edge
const MID = 41;                        // row of the road that leads to the maze gate
const TOWN_U = 42;                        // the town fills u = 1..TOWN_U (u counts from the start edge)
const MAZE_WEST = 13, MAZE_EAST = 112;   // absolute columns of the maze block
const MAZE_NORTH = 1, MAZE_SOUTH = 82;        // its rows
const MAZE_CORRIDOR = 2, MAZE_WALL = 3;
const POCKET_U0 = 143, POCKET_U1 = 154;   // the exit pocket beyond the maze (u), 12 columns

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
// Chapter 7 - "The Frostmarket" (dirt_snow, sunrise). Runs RIGHT to LEFT: the
// hero steps out of the Threshold at the far east edge of the map, at dawn, on
// the edge of a frozen market town.
//
// QUEST (gather-N): the herder's three draft horses bolted into the Whiteout
// Rows when the hum began. The old rule of the market: the pasture gate stays
// frozen shut while a horse is out. Find all three in the maze - any order -
// and calm each one so it heads home; when the last is home, the pasture gate
// (the maze's exit) unlatches and the frost-bell waits beyond it.
// ----------------------------------------------------------------------------
const TOWN = [
    ["rocks_small", 3, -35],
    ["rain_barrel", 3, -29],
    ["snowy_pine", 4, -25],
    ["cart", 5, -28],
    ["pine_tree", 5, 30],
    ["cottage_a", 7, -23],
    ["poor_market_stall", 8, -19],
    ["pine_tree", 8, 15],
    ["cottage_a", 8, 19],
    ["pine_tree", 9, -30],
    ["bush", 9, 33],
    ["snowy_pine", 10, -15],
    ["rocks_small", 11, -24],
    ["wheelbarrow", 12, -36],
    ["fence_straight", 12, -29],
    ["market_stall", 12, 20],
    ["snowy_pine", 12, 24],
    ["fence_straight", 14, -32],
    ["cottage_b", 15, 9],
    ["chicken_coop", 17, -32],
    ["stacked_ale_barrels", 17, 3],
    ["water_trough", 17, 20],
    ["snowy_pine", 17, 27],
    ["courtyard_well", 18, -3],
    ["notice_board", 24, -3],
    ["water_trough", 25, 3],
    ["pine_tree", 26, -25],
    ["fence_corner", 26, 36],
    ["cottage_b", 27, -34],
    ["rocks_small", 27, -30],
    ["poor_market_stall", 27, -13],
    ["bench", 27, 25],
    ["snowy_pine", 29, -30],
    ["bush", 29, 26],
    ["water_trough", 30, -28],
    ["fence_straight", 30, -23],
    ["wheelbarrow", 30, 15],
    ["fence_corner", 30, 30],
    ["laundry_line", 31, 21],
    ["market_stall", 31, 27],
    ["cottage_a", 31, 33],
    ["bush", 31, 38],
    ["rain_barrel", 32, -36],
    ["haystack", 32, -21],
    ["wheelbarrow", 33, -19],
    ["snowy_pine", 34, -25],
    ["water_trough", 35, -17],
    ["wheelbarrow", 35, 18],
    ["bench", 35, 26],
    ["bench", 35, 28],
    ["fence_corner", 35, 37],
    ["rain_barrel", 36, 5],
    ["bush", 36, 33],
    ["fence_corner", 37, -25],
    ["snowy_pine", 37, -21],
    ["bench", 37, 15],
    ["fence_straight", 37, 27],
    ["cart", 38, -19],
    ["snowy_pine", 38, 7],
    ["stacked_ale_barrels", 39, -8],
    ["rain_barrel", 40, -16],
    ["water_trough", 40, 30],
    ["cart", 40, 38]
];
const STRAYS = ["horse_bay_draft", "horse_chestnut_draft", "horse_dun"];

function* onLevelStart() {
    api.spawnCharacter("lara_cyber", colAt(START_U), MID);
    api.giveControl("lara_cyber");
    respawnCompanions();

    buildTown();
    const exitRows = buildMaze();
    buildPocket();
    if (!api.getVar("strays_home", false))
        setExitGate("pasture_gate", exitRows, true);

    if (api.getVar("chapter7_intro_seen", false))
        return;
    api.setVar("chapter7_intro_seen", true);

    yield api.wait(0.6);
    yield api.say("Lara", "...That's a market. Stalls, smoke, someone arguing about the price of salt. Just past the edge of where the Threshold spat us out.");
    yield* companionSays("vigil_recruited", "Vigil", "Dawn on frozen ground. Whoever keeps this place rises early, or never sleeps.");
    yield* companionSays("cobb_recruited", "Cobb", "I can smell the ale from here. Warm ale. There is a God, and He runs a tavern.");
    yield api.say("Hint", "This level runs right to left. The town is behind you; the maze is ahead, to the west.");
}

// ============================================================================
// Part one - the Frostmarket.
// ============================================================================
function buildTown() {
    placeProps(TOWN);

    // A gate-house of sorts where the market road meets the maze.
    api.spawnProp("signpost", colAt(TOWN_U - 1), MID - 3);
    api.spawnProp("standing_torch_sconce", colAt(TOWN_U), MID - 3);
    api.spawnProp("standing_torch_sconce", colAt(TOWN_U), MID + 4);

    api.spawnNpc("lumberjack_2", colAt(14), MID - 3);   // the herder
    api.spawnNpc("merchant", colAt(24), MID - 4);
    api.spawnNpc("innkeeper", colAt(26), MID + 5);
    api.spawnNpc("baker_2", colAt(9), MID + 6);

    if (api.getVar("town_loot_spawned", false))
        return;
    api.setVar("town_loot_spawned", true);
    api.spawnItem("dried_rations", colAt(6), MID - 9);
    api.spawnItem("bread_loaf", colAt(30), MID + 10);
    api.spawnItem("waterskin", colAt(34), MID - 12);
    api.spawnItem("honey_jar", colAt(13), MID + 14);
    api.spawnItem("health_potion", colAt(33), MID - 6);
}

// ============================================================================
// Part two - the Whiteout Rows, a maze of snow-laden pine and boulder. Returns
// the exit rows so the caller can hang the pasture gate on the exit.
// ============================================================================
function buildMaze() {
    const core = ["snowy_pine", "pine_tree", "boulder_large", "cliff_face", "fallen_log", "dead_tree"];
    const edge = ["bush", "rocks_small", "tree_stump", "ivy_rock"];
    const cells = buildBranchingMaze(MAZE_WEST, MAZE_EAST, MAZE_NORTH, MAZE_SOUTH, MAZE_CORRIDOR, MAZE_WALL,
        core, edge, 70701, { flip: DIR < 0, diagonalSeam: true, solid: true });
    const pool = cells.slice();

    // 38 hostiles, none in the first stretch by the town.
    spawnPacks(takeCells(pool, 0.06, 1.0, 38, 70702),
        [["wolf", 14, 30], ["slime_ice", 10, 30], ["troll", 6, 60], ["tiger", 8, 45]], "maze_hostiles_spawned");

    // The three strays, one in each third of the maze - unless already sent home.
    const bands = [[0.12, 0.38], [0.40, 0.66], [0.68, 0.92]];
    STRAYS.forEach((name, k) => {
        const spot = takeCells(pool, bands[k][0], bands[k][1], 1, 70703 + k)[0];
        if (!api.getVar("stray_home_" + name, false))
            api.spawnNpc(name, spot.col, spot.row);
    });

    spawnLoot(takeCells(pool, 0.05, 0.95, 12, 70710),
        ["health_potion", "health_potion", "health_potion", "health_potion", "health_potion", "health_potion",
         "mana_potion", "stamina_draught", "silver_coin_pouch", "rope_coil", "herb_bundle", "whetstone"], "maze_loot_spawned");
    return cells.exitRows;
}

// The pasture beyond the gate: where the frost-bell hangs.
function buildPocket() {
    const [c0, c1] = pocketCols();
    scatterOrganic(["fence_straight", "haystack", "water_trough", "snowy_pine", "bush"], c0, c1, MAZE_NORTH + 2, MAZE_SOUTH - 2, 10, 70720,
        [{ col: colAt(POCKET_U0 + 6), row: MID }]);
    if (!api.getVar("bell_spawned", false)) {
        api.setVar("bell_spawned", true);
        api.spawnItem("frostmarket_bell", colAt(POCKET_U0 + 6), MID);
    }
}

// ============================================================================
// Conversations
// ============================================================================
function* onTalkTo(name) {
    if (name === "lumberjack_2") {
        yield* talkToHerder();
    } else if (STRAYS.indexOf(name) >= 0) {
        yield* calmStray(name);
    } else if (name === "merchant" || name === "innkeeper" || name === "baker_2") {
        yield* talkToTownsfolk(name);
    }
}

function* talkToHerder() {
    const n = api.getVar("herder_talks", 0);
    api.setVar("herder_talks", n + 1);
    api.playSound("select");
    if (api.getVar("strays_home", false)) {
        yield api.say("Herder", "All three home, and the gate just let go on its own. Go on through - you've earned the bell, and the bell's earned a rest.");
    } else if (n === 0) {
        yield api.say("Herder", "You're the ones who walked out of the east, aren't you. The market's been talking about nothing else.");
        yield api.say("Herder", "I'll trade you a favour for it. Three of my draft horses bolted into the Whiteout Rows the night the hum started - bay, chestnut, and the dun. The pasture gate at the far end of the maze won't unlatch while a horse is out. Old rule. Older than the gate.");
        yield api.say("Lara", "So we find the horses, and the gate opens.");
        yield api.say("Herder", "Find them, and talk them down - they'll come home on their own once they're calm. Any order. Mind the wolves. And the trolls. And, honestly, the weather.");
    } else {
        const left = 3 - STRAYS.filter(s => api.getVar("stray_home_" + s, false)).length;
        yield api.say("Herder", left === 3 ? "Three still out there. Bay, chestnut, dun. Any order." : "Just " + left + " to go. They won't have gone far - horses never go far from a wall.");
    }
}

// Talking a stray down sends it home (it vanishes from the maze). When the third
// is home, the pasture gate lifts.
function* calmStray(name) {
    const displayName = { horse_bay_draft: "Bay", horse_chestnut_draft: "Chestnut", horse_dun: "Dun" }[name];
    api.playSound("select");
    api.setVar("stray_home_" + name, true);
    api.despawnNpc(name);
    api.giveExperience(30);
    const home = STRAYS.filter(s => api.getVar("stray_home_" + s, false)).length;
    if (home < 3) {
        yield api.say(displayName, "*snorts, plants its hooves, and stops shaking - then sets off at a walk toward the market road, tail high*");
        yield api.say("Lara", (3 - home) + " more to find.");
    } else {
        api.setVar("strays_home", true);
        api.giveExperience(60);
        yield api.say(displayName, "*leans into your hand for a moment, then trots off after the others*");
        yield api.say("Lara", "That's all three. Listen - far behind us, that's the pasture gate. It sounds like somebody striking a bell.");
        yield* companionSays("nettle_recruited", "Nettle", "Frost releasing its hold on iron. It does that, when it's been asked properly.");
        // The gate at the west end of the maze is now free.
        api.setBarrier("pasture_gate", 0, 0, 1, 1, false);   // lifts by id - the coordinates are ignored
    }
}

function* talkToTownsfolk(name) {
    const lines = {
        merchant: ["Salt, iron, rope, and one lantern nobody has managed to blow out. None of it for sale to anyone who hums.",
                   "Frostmarket runs at dawn because the frost keeps prices honest. Nothing rots. Nothing lies."],
        innkeeper: ["Cold ale, colder soup. The soup's a compliment, in this weather.",
                    "The herder hasn't sat down in three days. Tell him the stew's on me if he brings those horses home."],
        baker_2: ["Rye, mostly. Snow doesn't rise, so neither do I, before dawn.",
                  "If you go into the maze, go early. The snow drifts back over your own tracks by noon."],
    }[name];
    const displayName = { merchant: "Merchant", innkeeper: "Innkeeper", baker_2: "Baker" }[name];
    const n = api.getVar("talk_" + name, 0);
    api.setVar("talk_" + name, n + 1);
    api.playSound("select");
    yield api.say(displayName, lines[n % lines.length]);
}

function* onEnemyDefeated(name) {
    if (Math.random() > 0.1)
        return;
    if (name === "troll") {
        yield api.wait(0.3);
        yield api.say("Lara", "Big things fall loudest. Somebody's going to hear that back in town.");
    } else if (name === "slime_ice") {
        yield api.wait(0.3);
        yield api.say("Lara", "Snow that was never snow. The hum's doing something to the weather, too.");
    }
}

function* onItemCollected(itemId) {
    if (itemId !== "frostmarket_bell")
        return;
    yield api.wait(0.3);
    yield api.say("Lara", "It rings the moment my fingers close on it - one clear note, and the frost on every roof in the market answers.");
    yield api.say("???", "First of ten. I hid them where a kind person would eventually have to walk, so no single road could ever finish what I started.");
    yield api.say("Lara", "Ten. You said ten.");
    yield api.say("???", "Ten places, ten notes. Walk on. West is where the road bends back toward the sea.");
    yield* companionSays("vex_recruited", "Vex", "Ten notes. That's a chord. Somebody built a chord out of geography.");
    api.setGlobalVar("chapter", 8);
    api.playSound("select");
    yield api.wait(0.8);
    api.loadLevel("chapter8.json");
}
