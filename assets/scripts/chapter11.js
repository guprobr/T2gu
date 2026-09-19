// ============================================================================
// ShadowShine - Chapter 11: "The Bramble Bazaar"
// ============================================================================
//
// Two parts: the TOWN comes first, the MAZE after it. This level runs right to left
// (the hero spawns against the east edge). Map: 160x84, tileset grass_dirt, lighting none.
//   - town   cols 119-158
//   - maze   cols 11-118, rows 1-82, corridors 2 wide, walls 4 thick
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
const W = 160, H = 84;
const DIR = -1;                        // -1: this level runs right -> left
const START_U = 3;                        // the hero spawns this many columns in from the start edge
const MID = 37;                        // row of the road that leads to the maze gate
const TOWN_U = 40;                        // the town fills u = 1..TOWN_U (u counts from the start edge)
const MAZE_WEST = 11, MAZE_EAST = 118;   // absolute columns of the maze block
const MAZE_NORTH = 1, MAZE_SOUTH = 82;        // its rows
const MAZE_CORRIDOR = 2, MAZE_WALL = 4;
const POCKET_U0 = 149, POCKET_U1 = 158;   // the exit pocket beyond the maze (u), 10 columns

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
// Chapter 11 - "The Bramble Bazaar" (grass_dirt, no lighting overlay: flat,
// honest daylight). Runs RIGHT to LEFT. A sprawling market of stalls and carts
// at the edge of a thorn-choked maze.
//
// QUEST (craft): the old alchemist Sorrel lives in the pocket beyond the
// thorn maze and can brew a thorn-cutter that opens the way onward - if he's
// brought one of each: a herb bundle, a jar of honey and a withering petal.
// Each lies in a different stretch of the maze. Carry all three to Sorrel; he
// brews them together and hands over the bramble crown.
// ----------------------------------------------------------------------------
const TOWN = [
    ["berry_bush", 4, 22],
    ["bush", 4, 36],
    ["wheelbarrow", 5, 29],
    ["wheelbarrow", 5, 34],
    ["rocks_small", 6, -34],
    ["rain_barrel", 6, -15],
    ["vendor_kiosk", 6, 9],
    ["berry_bush", 6, 19],
    ["chicken_coop", 7, 24],
    ["patched_pushcart", 8, 15],
    ["poor_market_stall", 8, 19],
    ["haystack", 9, -14],
    ["berry_bush", 9, 36],
    ["haystack", 9, 42],
    ["wheelbarrow", 10, -28],
    ["vegetable_garden", 11, 30],
    ["oak_tree", 12, -24],
    ["market_stall", 12, -22],
    ["rain_barrel", 12, -13],
    ["rocks_small", 12, 19],
    ["wheelbarrow", 12, 40],
    ["poor_market_stall", 13, 21],
    ["oak_tree", 14, -27],
    ["bush", 14, -7],
    ["berry_bush", 14, 27],
    ["fence_corner", 15, -34],
    ["fence_straight", 15, -20],
    ["market_stall", 15, -14],
    ["bush", 15, 42],
    ["haystack", 16, -18],
    ["barrels_crates", 16, 3],
    ["fence_straight", 16, 25],
    ["notice_board", 17, -3],
    ["street_water_pump", 23, -3],
    ["vendor_kiosk", 24, 3],
    ["fence_corner", 25, -19],
    ["patched_pushcart", 25, 31],
    ["rain_barrel", 26, -31],
    ["cart", 26, -26],
    ["chicken_coop", 26, -11],
    ["fence_corner", 26, -8],
    ["wheelbarrow", 26, 21],
    ["fence_corner", 28, -10],
    ["rocks_small", 28, 20],
    ["market_stall", 28, 37],
    ["oak_tree", 29, -28],
    ["haystack", 29, 5],
    ["cart", 29, 40],
    ["barrels_crates", 30, -9],
    ["fence_corner", 31, -29],
    ["rain_barrel", 31, 35],
    ["barrels_crates", 32, -23],
    ["oak_tree", 32, 31],
    ["bush", 33, -25],
    ["oak_tree", 33, 39],
    ["rain_barrel", 34, 18],
    ["fence_straight", 35, -21],
    ["fence_straight", 35, 21],
    ["rocks_small", 35, 33],
    ["barrels_crates", 35, 37],
    ["berry_bush", 36, -3],
    ["barrels_crates", 36, 35],
    ["barrels_crates", 37, 20],
    ["haystack", 37, 33],
    ["fence_straight", 38, 14],
    ["bush", 38, 29]
];
const INGREDIENTS = [["herb_bundle", "herb bundle"], ["honey_jar", "jar of honey"], ["withering_petal", "withering petal"]];

function* onLevelStart() {
    api.spawnCharacter("lara_cyber", colAt(START_U), MID);
    api.giveControl("lara_cyber");
    respawnCompanions();

    buildTown();
    buildMaze();
    buildPocket();

    if (api.getVar("chapter11_intro_seen", false))
        return;
    api.setVar("chapter11_intro_seen", true);

    yield api.wait(0.6);
    yield api.say("Lara", "Noise. Wonderful, ordinary noise: haggling, hens, a cart with a bad wheel. After the last few places, I could cry.");
    yield* companionSays("cobb_recruited", "Cobb", "A market this size means somebody's got real ore stashed under a cheese stall. Mark my words.");
    yield* companionSays("vex_recruited", "Vex", "I've counted four separate currencies already. None of them the same denomination twice.");
    yield api.say("Hint", "This level runs right to left. The town is behind you; the thorn maze is ahead, to the west.");
}

function buildTown() {
    placeProps(TOWN);
    api.spawnProp("signpost", colAt(TOWN_U - 1), MID - 3);
    api.spawnProp("berry_bush", colAt(TOWN_U), MID - 3);
    api.spawnProp("berry_bush", colAt(TOWN_U), MID + 4);

    api.spawnNpc("merchant", colAt(14), MID - 3);         // the Haggler, who knows about Sorrel
    api.spawnNpc("farmgirl", colAt(24), MID + 5);
    api.spawnNpc("fisherman", colAt(10), MID + 6);
    api.spawnNpc("baker", colAt(30), MID - 5);

    if (api.getVar("town_loot_spawned", false))
        return;
    api.setVar("town_loot_spawned", true);
    api.spawnItem("bread_loaf", colAt(6), MID - 9);
    api.spawnItem("berry_pouch", colAt(28), MID + 11);
    api.spawnItem("waterskin", colAt(34), MID - 12);
    api.spawnItem("health_potion", colAt(13), MID + 14);
}

function buildMaze() {
    const core = ["oak_tree", "pine_tree", "dead_twisted_tree", "boulder_large", "haystack", "cliff_face"];
    const edge = ["berry_bush", "bush", "tree_stump", "rocks_small", "wheelbarrow"];
    const cells = buildBranchingMaze(MAZE_WEST, MAZE_EAST, MAZE_NORTH, MAZE_SOUTH, MAZE_CORRIDOR, MAZE_WALL,
        core, edge, 111101, { flip: DIR < 0, diagonalSeam: true, solid: true });
    const pool = cells.slice();

    spawnPacks(takeCells(pool, 0.06, 1.0, 40, 111102),
        [["boar", 14, 35], ["bear", 8, 45], ["goblin", 12, 30], ["imp", 6, 30]], "maze_hostiles_spawned");

    // One ingredient in each third of the maze. Only spawned if not already gathered or handed over.
    const bands = [[0.12, 0.36], [0.40, 0.64], [0.68, 0.94]];
    const spots = bands.map((b, k) => takeCells(pool, b[0], b[1], 1, 111103 + k)[0]);
    if (!api.getVar("crown_made", false) && !api.getVar("ingredients_spawned", false)) {
        api.setVar("ingredients_spawned", true);
        INGREDIENTS.forEach(([id], k) => api.spawnItem(id, spots[k].col, spots[k].row));
    }

    spawnLoot(takeCells(pool, 0.05, 0.95, 10, 111110),
        ["health_potion", "health_potion", "health_potion", "health_potion", "health_potion", "health_potion",
         "mana_potion", "gold_coin_pile", "rope_coil", "stamina_draught"], "maze_loot_spawned");
}

// Sorrel's cottage-garden in the pocket beyond the maze.
function buildPocket() {
    const [c0, c1] = pocketCols();
    scatterOrganic(["berry_bush", "vegetable_garden", "bush", "fence_straight", "haystack"], c0, c1, MAZE_NORTH + 2, MAZE_SOUTH - 2, 9, 111120,
        [{ col: colAt(POCKET_U0 + 4), row: MID }]);
    api.spawnNpc("gnome_alchemist", colAt(POCKET_U0 + 4), MID);
}

function* onTalkTo(name) {
    if (name === "merchant") {
        yield* talkToHaggler();
    } else if (name === "gnome_alchemist") {
        yield* talkToSorrel();
    } else if (name === "farmgirl" || name === "fisherman" || name === "baker") {
        yield* talkToTownsfolk(name);
    }
}

function* talkToHaggler() {
    const n = api.getVar("haggler_talks", 0);
    api.setVar("haggler_talks", n + 1);
    api.playSound("select");
    if (n === 0) {
        yield api.say("Haggler", "Everything here's for sale except the way west. That's grown over with bramble thick enough to turn a plough.");
        yield api.say("Haggler", "Old Sorrel, at the far end, brews a thorn-cutter that opens it - but he's cranky, and he won't lift a spoon without ingredients. A herb bundle. A jar of honey. A withering petal. One of each, from out in the thorn rows.");
        yield api.say("Lara", "Where in the maze?");
        yield api.say("Haggler", "The herb grows near the town side, where it's still sunny. The honey's deep in the middle, in whatever the bees are guarding. The petal - the petal only ever blooms at the far end. That's all I know, and I'm exaggerating the last part.");
    } else {
        const have = INGREDIENTS.filter(([id]) => api.hasItem(id)).length;
        yield api.say("Haggler", "Herb near the town, honey in the middle, petal near the far end. " + (have > 0 ? "You've got " + have + " of them already. Good." : "You've got none yet - start walking."));
    }
}

function* talkToSorrel() {
    api.playSound("select");
    if (api.getVar("crown_made", false)) {
        yield api.say("Sorrel", "It's yours. Mind the points. It bites the ungrateful.");
        return;
    }
    const missing = INGREDIENTS.filter(([id]) => !api.hasItem(id));
    if (missing.length > 0) {
        yield api.say("Sorrel", "*peers up from a mortar* Company. How tiresome. What have you brought?");
        yield api.say("Sorrel", "I need a herb bundle, a jar of honey, and a withering petal. You're missing " + missing.map(m => "the " + m[1]).join(" and ") + ". Come back when you're not.");
        return;
    }
    INGREDIENTS.forEach(([id]) => api.removeItem(id, 1));
    api.setVar("crown_made", true);
    api.giveExperience(100);
    yield api.say("Sorrel", "*peers at the three of them, then at you* ...Well. Somebody raised you properly.");
    yield api.say("Sorrel", "Herb to soothe, honey to bind, petal to remember why it hurts. Stand back - it smokes. It smells of sage and, faintly, of regret.");
    yield api.say("Lara", "That's the crown? It's tiny.");
    yield api.say("Sorrel", "It isn't a crown for wearing. It's a crown for *finishing* things. Here.");
    api.giveItem("bramble_crown", 1);
    yield* finishChapter();
}

function* finishChapter() {
    yield api.wait(0.3);
    yield api.say("Lara", "Thorn and dried berry, woven small. It's warm - and it hums. A different note again.");
    yield api.say("???", "Fifth of ten. You carried three small things a very long way for someone you'd never met. I keep noticing that you do that.");
    yield api.say("Lara", "It's not a big secret. People ask, and then you just... go.");
    yield api.say("???", "It's the biggest secret there is. Come on - the next one is somewhere hot, and loud, and full of people who make things out of fire.");
    yield* companionSays("nettle_recruited", "Nettle", "She says that like it's nothing. It's the whole reason we're here, isn't it.");
    api.setGlobalVar("chapter", 12);
    api.playSound("select");
    yield api.wait(0.8);
    api.loadLevel("chapter12.json");
}

function* talkToTownsfolk(name) {
    const lines = {
        farmgirl: ["Thorn rows grew up overnight, after the hum. Not a hedge - a *decision*.",
                   "If Sorrel hands you a mug, don't drink it. Or do. Nobody's been able to tell me which."],
        fisherman: ["I sell fish nobody asked for to people who didn't want them. It's a good living.",
                    "Sorrel sent a message once by pigeon. The pigeon has not been seen since. Neither, honestly, has the message."],
        baker: ["Best rolls in the Bazaar. Also the only rolls. Competition is a lovely rumour.",
                "Take a berry pouch for the road. Thorn rows get hungry work out of anyone."],
    }[name];
    const displayName = { farmgirl: "Farmgirl", fisherman: "Fisherman", baker: "Baker" }[name];
    const n = api.getVar("talk_" + name, 0);
    api.setVar("talk_" + name, n + 1);
    api.playSound("select");
    yield api.say(displayName, lines[n % lines.length]);
}

function* onEnemyDefeated(name) {
    if (Math.random() > 0.1)
        return;
    if (name === "boar") {
        yield api.wait(0.3);
        yield api.say("Lara", "Every hedge has one of these. This one just had a bad week.");
    } else if (name === "imp") {
        yield api.wait(0.3);
        yield api.say("Lara", "Small, loud, and vanishes when you look at it directly. I've dated worse.");
    }
}
