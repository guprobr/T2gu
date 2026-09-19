// ============================================================================
// ShadowShine - Chapter 21: "The Rival Quarter"
// ============================================================================
//
// Two parts: the TOWN comes first, the MAZE after it. This level runs right to left
// (the hero spawns against the east edge). Map: 166x96, tileset stone_grass, lighting sunrise.
//   - town   cols 119-164
//   - maze   cols 11-118, rows 1-94, corridors 2 wide, walls 3 thick
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
const W = 166, H = 96;
const DIR = -1;                        // -1: this level runs right -> left
const START_U = 3;                        // the hero spawns this many columns in from the start edge
const MID = 46;                        // row of the road that leads to the maze gate
const TOWN_U = 46;                        // the town fills u = 1..TOWN_U (u counts from the start edge)
const MAZE_WEST = 11, MAZE_EAST = 118;   // absolute columns of the maze block
const MAZE_NORTH = 1, MAZE_SOUTH = 94;        // its rows
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
// Chapter 21 - "The Rival Quarter" (stone_grass, sunrise). Runs RIGHT to LEFT.
// A grassy town with paved streets, split down the middle between the Smiths'
// Guild and the Weavers' Circle, then the Stoneyards - a maze of quarries and
// workshops in the first light of morning.
//
// QUEST (two guilds): each guild wants two of its own goods, found out in the
// Stoneyards (three of each lie about). Serving EITHER guild lifts the quarter
// gate. Serving both is harder - and makes peace: the guilds sit down together
// and the ending changes. Nothing forces the harder path.
// ----------------------------------------------------------------------------
const TOWN = [
    ["market_stall", 4, -16],
    ["fence_straight", 5, -35],
    ["haystack", 5, 22],
    ["barrels_crates", 5, 26],
    ["rain_barrel", 6, -19],
    ["fence_straight", 6, 29],
    ["bush", 8, -20],
    ["laundry_line", 8, 24],
    ["haystack", 8, 42],
    ["blacksmith_forge", 10, -23],
    ["barrels_crates", 11, -40],
    ["rocks_small", 11, -14],
    ["bush", 11, 22],
    ["rocks_small", 11, 34],
    ["fence_straight", 13, 40],
    ["wooden_chest", 14, -13],
    ["bench", 15, 10],
    ["wooden_chest", 15, 26],
    ["rocks_small", 15, 46],
    ["rain_barrel", 16, -24],
    ["bench", 16, 24],
    ["barrels_crates", 17, -11],
    ["stone_fireplace", 17, 43],
    ["bench", 18, 25],
    ["laundry_line", 18, 29],
    ["haystack", 18, 46],
    ["bench", 19, -42],
    ["wheelbarrow", 19, -28],
    ["stacked_ale_barrels", 19, 3],
    ["laundry_line", 19, 37],
    ["courtyard_well", 23, -4],
    ["notice_board", 27, -3],
    ["laundry_line", 27, 3],
    ["stone_fireplace", 28, -18],
    ["cottage_a", 28, 22],
    ["barrels_crates", 29, -13],
    ["bush", 30, -20],
    ["cart", 30, 28],
    ["fence_straight", 31, -29],
    ["rain_barrel", 31, 23],
    ["haystack", 32, 27],
    ["cottage_a", 33, 20],
    ["wooden_chest", 35, 36],
    ["barrels_crates", 36, -43],
    ["laundry_line", 37, -20],
    ["barrels_crates", 37, -18],
    ["alley_lantern_post", 38, -3],
    ["chapel", 38, 8],
    ["bench", 38, 23],
    ["rocks_small", 39, -39],
    ["rain_barrel", 39, -17],
    ["bush", 39, 43],
    ["wooden_chest", 40, 14],
    ["rain_barrel", 41, -10],
    ["market_stall", 41, 24],
    ["wooden_chest", 42, -43],
    ["rocks_small", 42, -35],
    ["cottage_b", 42, -16],
    ["bush", 42, 13],
    ["wheelbarrow", 42, 42],
    ["armory_rack", 43, -12],
    ["laundry_line", 43, -8],
    ["wheelbarrow", 43, 9],
    ["wheelbarrow", 44, 33]
];
const GUILDS = {
    blacksmith: { good: "guild_ore", who: "Master Brakk", name: "Smiths' Guild", gift: ["whetstone", "small_ingot"], rival: "Weavers" },
    farmgirl: { good: "guild_wool", who: "Weaver Ysa", name: "Weavers' Circle", gift: ["woven_talisman", "cloth_bolt"], rival: "Smiths" },
};
const NEED = 2;

function* onLevelStart() {
    api.spawnCharacter("lara_cyber", colAt(START_U), MID);
    api.giveControl("lara_cyber");
    respawnCompanions();

    buildTown();
    const exitRows = buildMaze();
    buildPocket();
    if (!api.getVar("quarter_open", false))
        setExitGate("quarter_gate", exitRows, true);

    if (api.getVar("chapter21_intro_seen", false))
        return;
    api.setVar("chapter21_intro_seen", true);

    yield api.wait(0.6);
    yield api.say("Lara", "A morning that looks like it has been washed. Two banners on the same street - a hammer on one side, a shuttle on the other - and not one person crossing between them.");
    yield* companionSays("nettle_recruited", "Nettle", "Two halves of a town, and neither will admit they cannot do without the other. I have treated worse. Usually with tea.");
    yield* companionSays("vigil_recruited", "Vigil", "A feud. I have kept the peace at a few. The trick is that both sides are usually correct about the same insult.");
    yield api.say("Hint", "This level runs right to left. The town is behind you; the Stoneyards are ahead, to the west.");
}

function buildTown() {
    placeProps(TOWN);
    api.spawnProp("signpost", colAt(TOWN_U - 1), MID - 3);
    api.spawnProp("alley_lantern_post", colAt(TOWN_U), MID + 4);

    api.spawnNpc("blacksmith", colAt(14), MID - 3);         // Master Brakk (Smiths)
    api.spawnNpc("farmgirl", colAt(30), MID - 5);           // Weaver Ysa (Weavers)
    api.spawnNpc("innkeeper", colAt(24), MID + 5);          // the Landlord, who serves both
    api.spawnNpc("merchant", colAt(10), MID + 6);           // the Broker

    if (api.getVar("town_loot_spawned", false))
        return;
    api.setVar("town_loot_spawned", true);
    api.spawnItem("health_potion", colAt(6), MID - 9);
    api.spawnItem("bread_loaf", colAt(28), MID + 11);
    api.spawnItem("waterskin", colAt(34), MID - 12);
    api.spawnItem("health_potion", colAt(13), MID + 14);
}

function buildMaze() {
    const core = ["castle_wall_section", "stone_wall_corner", "stone_wall_corner_alt", "cottage_b", "stacked_ale_barrels", "boulder_large"];
    const edge = ["rocks_small", "barrels_crates", "ivy_rock", "bush", "crate_stack_cat"];
    const cells = buildBranchingMaze(MAZE_WEST, MAZE_EAST, MAZE_NORTH, MAZE_SOUTH, MAZE_CORRIDOR, MAZE_WALL,
        core, edge, 212101, { flip: DIR < 0, diagonalSeam: true, solid: true });
    const pool = cells.slice();

    // Three lumps of ore and three bolts of wool, interleaved through the maze (one spare of each).
    const oreBands = [[0.08, 0.26], [0.36, 0.54], [0.66, 0.84]], woolBands = [[0.16, 0.34], [0.46, 0.64], [0.76, 0.94]];
    const goods = [];
    oreBands.forEach((b, k) => goods.push([takeCells(pool, b[0], b[1], 1, 212102 + k)[0], "guild_ore"]));
    woolBands.forEach((b, k) => goods.push([takeCells(pool, b[0], b[1], 1, 212106 + k)[0], "guild_wool"]));
    spawnLoot(goods.map(g => g[0]), goods.map(g => g[1]), "guild_goods_spawned");

    spawnPacks(takeCells(pool, 0.06, 1.0, 36, 212110),
        [["orc", 10, 45], ["goblin", 8, 30], ["troll", 4, 60], ["lizardman", 8, 45], ["imp", 6, 30]],
        "maze_hostiles_spawned");

    spawnLoot(takeCells(pool, 0.05, 0.95, 11, 212120),
        ["health_potion", "health_potion", "health_potion", "health_potion", "health_potion", "health_potion",
         "mana_potion", "repair_kit", "elixir_of_clarity", "stamina_draught", "reinforced_boots"], "maze_loot_spawned");
    return cells.exitRows;
}

function buildPocket() {
    const [c0, c1] = pocketCols();
    scatterOrganic(["cottage_b", "stone_wall_corner", "boulder_large", "castle_banner_wallmount"], c0, c1, MAZE_NORTH + 2, MAZE_SOUTH - 2, 8, 212130,
        [{ col: colAt(POCKET_U0 + 5), row: MID }]);
    if (!api.getVar("banner_spawned", false)) {
        api.setVar("banner_spawned", true);
        api.spawnItem("peace_banner", colAt(POCKET_U0 + 5), MID);
    }
}

function servedBoth() {
    return api.getVar("served_blacksmith", false) && api.getVar("served_farmgirl", false);
}

function* onTalkTo(name) {
    if (GUILDS[name]) {
        yield* talkToGuild(name);
    } else if (name === "innkeeper" || name === "merchant") {
        yield* talkToNeutral(name);
    }
}

function* talkToGuild(name) {
    const g = GUILDS[name];
    api.playSound("select");
    if (api.getVar("served_" + name, false)) {
        yield api.say(g.who, servedBoth()
            ? "We sat down with the " + g.rival + " last night. I said nothing about the seam, and they said nothing about the hammer. I have not slept so well in ten years."
            : "You served the " + g.name + ". We remember that. As for the " + g.rival + " - well. They will have to find their own way to the table.");
        return;
    }
    if (api.getItemCount(g.good) >= NEED) {
        api.removeItem(g.good, NEED);
        api.setVar("served_" + name, true);
        api.giveExperience(60);
        g.gift.forEach(item => api.giveItem(item, 1));
        yield api.say(g.who, "*checks the stamp on each, and then both again* Two, and both true. The " + g.name + " thanks you. Take this - our maker's mark, and something for the road.");
        if (!api.getVar("quarter_open", false)) {
            api.setVar("quarter_open", true);
            api.setBarrier("quarter_gate", 0, 0, 1, 1, false);
            yield api.say("Lara", "The gate at the far end of the Stoneyards just came unbolted. I can hear it from here.");
        }
        if (servedBoth()) {
            api.giveExperience(150);
            yield api.say(g.who, "...And I hear the other guild has been served too. By the same hands. *a long pause* I suppose that means we will have to talk.");
            yield* companionSays("nettle_recruited", "Nettle", "And there it is. Two sides, one kettle. I'll put it on.");
        } else {
            yield api.say(g.who, "Now, if you happen to pass the " + g.rival + "... no. Never mind. I have said too much already.");
        }
        return;
    }
    const n = api.getVar("guild_talks_" + name, 0);
    api.setVar("guild_talks_" + name, n + 1);
    const have = api.getItemCount(g.good);
    if (n === 0) {
        if (name === "blacksmith") {
            yield api.say(g.who, "The Smiths' Guild has been forging this quarter's ironwork since before there was a quarter. The Weavers' Circle across the way says the seam of a good cloak matters more than the edge of a good blade. They are wrong.");
            yield api.say(g.who, "I need two lumps of stamped ore from the Stoneyards, west of here. Guild ore, with our hammer-mark. Bring me two and the Guild will owe you one.");
        } else {
            yield api.say(g.who, "The Weavers' Circle has clothed this quarter longer than the Smiths have armed it. They say a blade is worth more than a cloak. They have never once been cold in a good cloak.");
            yield api.say(g.who, "I need two bolts of stamped wool from the Stoneyards, west of here. Circle wool, with our shuttle-mark. Bring two and the Circle will owe you one.");
        }
        yield api.say("Lara", "And the other guild?");
        yield api.say(g.who, name === "blacksmith" ? "Don't get me started." : "Please don't.");
    } else {
        yield api.say(g.who, "You have " + have + " of the " + NEED + " I need. The Stoneyards, west - three are lying about, and I only need two.");
    }
}

function* talkToNeutral(name) {
    const lines = {
        innkeeper: ["I serve both guilds. They sit at opposite ends of my taproom and pretend not to hear each other's arguments. I keep the middle table free, just in case.",
                    "A feud is like a stew - leave it long enough and it changes, but it never stops being the same pot."],
        merchant: ["I broker between them. Ore for wool, wool for ore. They think I am paid by the other side. I am paid by both, which is the only way it works.",
                   "Two of each is what they ask for. There are three of each out in the yards. Take the spare and you could serve both sides. I'm not suggesting anything. I'm just saying the arithmetic."],
    }[name];
    const displayName = { innkeeper: "Landlord", merchant: "Broker" }[name];
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
        yield api.say("Lara", "A quarryman's ghost, or near enough. It just wanted the stone back.");
    } else if (name === "goblin") {
        yield api.wait(0.3);
        yield api.say("Lara", "It had a scrap of both guilds' cloth tied round its arm. Even the vermin here can't pick a side.");
    }
}

function* onItemCollected(itemId) {
    if (itemId !== "peace_banner")
        return;
    yield api.wait(0.3);
    if (servedBoth()) {
        yield api.say("Lara", "Two colours in one cloth, and the seam is not quite straight. Somebody sewed it in a hurry and nobody has ever wanted to fix it.");
        yield api.say("???", "Fifth of nine. And you served both. You could have stopped at one - most people do. I want you to know that I saw the second trip.");
        yield api.say("Lara", "It was mostly Nettle's tea.");
        yield api.say("???", "It usually is. Onward: a mile of market where nothing costs money and everything costs something.");
    } else {
        yield api.say("Lara", "A banner in one guild's colour, with a plain grey stripe stitched down the side where the other should be. Someone left room.");
        yield api.say("???", "Fifth of nine. You served one guild and the gate opened; nobody could fault you. But the grey stripe is still there. There is always room for the second colour, if you go back for it.");
        yield api.say("Lara", "And if I don't?");
        yield api.say("???", "Then you don't. It is a road, Lara, not an examination. Onward: a mile of market where nothing costs money and everything costs something.");
    }
    api.setGlobalVar("chapter", 22);
    api.setGlobalVar("guilds_at_peace", servedBoth());
    api.playSound("select");
    yield api.wait(0.8);
    api.loadLevel("chapter22.json");
}
