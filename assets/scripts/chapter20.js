// ============================================================================
// ShadowShine - Chapter 20: "Sluicegate"
// ============================================================================
//
// Two parts: the TOWN comes first, the MAZE after it. This level runs left to right
// (the hero spawns against the west edge). Map: 162x84, tileset grass_water, lighting sunset.
//   - town   cols 1-40
//   - river  cols 41-44 (one ford)
//   - maze   cols 45-152, rows 1-82, corridors 2 wide, walls 4 thick
//   - pocket cols 153-160 (where the maze lets out)
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
const W = 162, H = 84;
const DIR = 1;                        // 1: this level runs left -> right
const START_U = 3;                        // the hero spawns this many columns in from the start edge
const MID = 37;                        // row of the road that leads to the maze gate
const TOWN_U = 40;                        // the town fills u = 1..TOWN_U (u counts from the start edge)
const MAZE_WEST = 45, MAZE_EAST = 152;   // absolute columns of the maze block
const MAZE_NORTH = 1, MAZE_SOUTH = 82;        // its rows
const MAZE_CORRIDOR = 2, MAZE_WALL = 4;
const POCKET_U0 = 153, POCKET_U1 = 160;   // the exit pocket beyond the maze (u), 8 columns

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
// Chapter 20 - "Sluicegate" (grass_water, sunset). Runs LEFT to RIGHT. A
// mill village on the bank of a river that has risen and closed the ford,
// then the Millrace Meadow - a hedged maze on the far bank under a low sun.
//
// QUEST (drain the flood): unlike chapters 1 and 14 this river has NO ford - the
// map is one unbroken band of water. The Lockkeeper can drain the crossing
// but the sluice wheel was wrecked when the water rose: its crank, chain and
// gear were flung around the village. Find all three, give them to the
// Lockkeeper, and he opens the sluice. The script then rewrites the water
// tiles of the ford (api.setTile) to the same land and bank tiles the other
// river chapters are generated with. The map file always loads flooded, so the
// drain is re-applied on every load once it has happened.
// ----------------------------------------------------------------------------
const TOWN = [
    ["fence_straight", 3, -28],
    ["haystack", 3, 34],
    ["haystack", 4, -31],
    ["bench", 4, -16],
    ["windmill", 4, 21],
    ["reeds", 5, 28],
    ["rocks_small", 6, 41],
    ["bush", 7, 19],
    ["bench", 7, 37],
    ["wheelbarrow", 8, -28],
    ["reeds", 9, 12],
    ["cottage_b", 10, 25],
    ["cart", 10, 37],
    ["wheelbarrow", 10, 40],
    ["market_stall", 11, -26],
    ["haystack", 11, 22],
    ["oak_tree", 11, 31],
    ["rain_barrel", 12, -8],
    ["cottage_a", 12, 20],
    ["rocks_small", 12, 37],
    ["berry_bush", 13, -12],
    ["oak_tree", 14, -29],
    ["reeds", 15, -26],
    ["bench", 16, 3],
    ["rain_barrel", 16, 23],
    ["rain_barrel", 16, 33],
    ["well", 20, -4],
    ["notice_board", 24, -3],
    ["oak_tree", 24, 3],
    ["dovecote", 25, -32],
    ["bush", 25, -14],
    ["oak_tree", 25, 38],
    ["oak_tree", 26, -16],
    ["vegetable_garden", 26, 26],
    ["reeds", 27, -21],
    ["wheelbarrow", 27, 32],
    ["rain_barrel", 27, 34],
    ["fence_straight", 27, 42],
    ["fence_straight", 28, -34],
    ["bush", 28, -16],
    ["cottage_b", 28, -11],
    ["berry_bush", 28, 38],
    ["fence_straight", 29, -21],
    ["haystack", 29, 26],
    ["cottage_a", 30, -24],
    ["laundry_line", 30, -16],
    ["rain_barrel", 30, -9],
    ["haystack", 30, 32],
    ["berry_bush", 31, -32],
    ["wheelbarrow", 32, -16],
    ["berry_bush", 33, 8],
    ["reeds", 33, 25],
    ["chicken_coop", 34, 17],
    ["fence_straight", 35, -34],
    ["cottage_b", 35, -22],
    ["oak_tree", 35, -19],
    ["berry_bush", 36, 7],
    ["rocks_small", 37, 15],
    ["bench", 38, 13],
    ["rocks_small", 38, 23],
    ["bench", 38, 27],
    ["bush", 38, 30],
    ["wheelbarrow", 38, 38]
];
// [col, row, tileName] for every tile the drain changes - generated from the map spec
const DRAIN = [[41, 36, "grass"], [42, 36, "grass_water_n"], [43, 36, "grass_water_n"], [44, 36, "grass_water_n"], [45, 36, "grass_water_n"], [46, 36, "grass"], [41, 37, "grass"], [42, 37, "grass"], [43, 37, "grass"], [44, 37, "grass"], [45, 37, "grass"], [46, 37, "grass"], [41, 38, "grass"], [42, 38, "grass"], [43, 38, "grass"], [44, 38, "grass"], [45, 38, "grass"], [46, 38, "grass"], [41, 39, "grass"], [42, 39, "grass_water_s"], [43, 39, "grass_water_s"], [44, 39, "grass_water_s"], [45, 39, "grass_water_s"], [46, 39, "grass"]];
const RIVER_COLS = 4;
const PARTS = ["sluice_crank", "sluice_chain", "sluice_gear"];

function drainFord() {
    DRAIN.forEach(([c, r, tile]) => api.setTile(tile, c, r));
}

function* onLevelStart() {
    api.spawnCharacter("lara_cyber", colAt(START_U), MID);
    api.giveControl("lara_cyber");
    respawnCompanions();

    // The map file is always the flooded one, so a drain that already happened has to be redone.
    if (api.getVar("ford_drained", false))
        drainFord();

    buildTown();
    buildMaze();
    buildPocket();

    if (api.getVar("chapter20_intro_seen", false))
        return;
    api.setVar("chapter20_intro_seen", true);

    yield api.wait(0.6);
    yield api.say("Lara", "The river's come up over the ford and stayed. Not a flood, exactly - it has just decided this is where the bank is now.");
    yield* companionSays("cobb_recruited", "Cobb", "Water that doesn't drain is water that's been told not to. Somewhere, a lock has forgotten its job.");
    yield* companionSays("vex_recruited", "Vex", "There is a sluice on the far side of the village. My instruments show no pressure in it. Nobody has turned the wheel in some time.");
    yield api.say("Hint", "This level runs left to right. The town is behind you; the river is ahead, and beyond it, to the east, the Millrace Meadow.");
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
    api.spawnProp("signpost", colAt(TOWN_U - 2), MID - 3);
    if (api.getVar("ford_drained", false))
        api.spawnProp("wooden_bridge", colAt(TOWN_U + 2), MID);

    api.spawnNpc("gnome_engineer", colAt(37), MID - 4);     // Lockkeeper Odo
    api.spawnNpc("angler", colAt(14), MID - 3);             // Netter
    api.spawnNpc("baker", colAt(24), MID + 5);              // Baker
    api.spawnNpc("farmhand_young", colAt(10), MID + 6);     // Pip

    if (api.getVar("town_loot_spawned", false))
        return;
    api.setVar("town_loot_spawned", true);
    api.spawnItem("sluice_crank", colAt(6), MID - 9);        // north-west, by the fence
    api.spawnItem("sluice_chain", colAt(34), MID - 12);      // far north, on the river bank
    api.spawnItem("sluice_gear", colAt(28), MID + 11);       // south, by the last lane
    api.spawnItem("health_potion", colAt(13), MID + 14);
    api.spawnItem("bread_loaf", colAt(20), MID - 10);
}

function buildMaze() {
    const core = ["oak_tree", "pine_tree", "boulder_large", "haystack", "cottage_b", "stone_wall_corner"];
    const edge = ["reeds", "bush", "rocks_small", "wildflowers", "berry_bush", "mushroom_cluster"];
    const cells = buildBranchingMaze(MAZE_WEST, MAZE_EAST, MAZE_NORTH, MAZE_SOUTH, MAZE_CORRIDOR, MAZE_WALL,
        core, edge, 202001, { flip: DIR < 0, diagonalSeam: true, solid: true });
    const pool = cells.slice();

    spawnPacks(takeCells(pool, 0.06, 1.0, 36, 202002),
        [["slime_water", 10, 25], ["crocodile", 6, 50], ["water_spirit", 8, 30], ["boar", 6, 40], ["wolf", 6, 30]],
        "maze_hostiles_spawned");

    spawnLoot(takeCells(pool, 0.05, 0.95, 11, 202010),
        ["health_potion", "health_potion", "health_potion", "health_potion", "health_potion", "health_potion",
         "mana_potion", "waterskin", "elixir_of_clarity", "stamina_draught", "antidote_vial"], "maze_loot_spawned");
    return cells.exitRows;
}

function buildPocket() {
    const [c0, c1] = pocketCols();
    scatterOrganic(["oak_tree", "reeds", "boulder_large", "bush"], c0, c1, MAZE_NORTH + 2, MAZE_SOUTH - 2, 7, 202020,
        [{ col: colAt(POCKET_U0 + 4), row: MID }]);
    if (!api.getVar("wheel_spawned", false)) {
        api.setVar("wheel_spawned", true);
        api.spawnItem("sluice_wheel", colAt(POCKET_U0 + 4), MID);
    }
}

function partsHeld() {
    return PARTS.filter(p => api.hasItem(p)).length;
}

function* onTalkTo(name) {
    if (name === "gnome_engineer") {
        yield* talkToLockkeeper();
    } else if (name === "angler" || name === "baker" || name === "farmhand_young") {
        yield* talkToTownsfolk(name);
    }
}

function* talkToLockkeeper() {
    api.playSound("select");
    if (api.getVar("ford_drained", false)) {
        yield api.say("Odo", "Hear that? That's a river going back where it lives. Thirty years I've kept that sluice, and I have never been so glad of a wet boot. Off you go.");
        return;
    }
    const held = partsHeld();
    if (held === PARTS.length) {
        PARTS.forEach(p => api.removeItem(p, 1));
        api.setVar("ford_drained", true);
        yield api.say("Odo", "*he lays the crank, the chain and the gear on the sill, and his hands know what to do with them before he does* Crank... chain... and the gear with the missing tooth. Ha! The tooth was always the difficult bit.");
        yield api.say("Odo", "*a long wooden groan from the lock, and then the sound of a great deal of water changing its mind* Stand well back.");
        drainFord();
        api.spawnProp("wooden_bridge", colAt(TOWN_U + 2), MID);
        api.giveExperience(120);
        yield api.wait(0.5);
        yield api.say("Lara", "The water's going down. There's a crossing where the ford always was - the bank tiles even line up.");
        yield* companionSays("cobb_recruited", "Cobb", "Three little bits of brass, and a whole river reconsiders. That's a proper dwarf lesson right there.");
        return;
    }
    const n = api.getVar("odo_talks", 0);
    api.setVar("odo_talks", n + 1);
    if (n === 0) {
        yield api.say("Odo", "Odo. I keep the sluice, and the sluice keeps the ford. When the hum stopped the river came up all at once and took the wheel off its axle - crank, chain and gear, flung to the four winds. Well, three of them.");
        yield api.say("Odo", "The crank went north-west, over by the fence. The chain went north, on the bank, among the reeds. The gear went south - down by the last lane, if the geese haven't had it.");
        yield api.say("Lara", "And with all three you can open the sluice?");
        yield api.say("Odo", "With all three I can put a river back in its bed. Bring them here, to the bank. I can't leave my post - there'd be nobody to turn it.");
    } else {
        yield api.say("Odo", "You hold " + held + " of the " + PARTS.length + ". Crank north-west, chain north on the bank, gear south by the last lane. Bring them all together and I will do the rest.");
    }
}

function* talkToTownsfolk(name) {
    const lines = {
        angler: ["I fished this river for twenty years and it never once rose past my knees. Now it's up to my hat and it's clean as a whistle. I don't trust it.",
                 "Something in the water is humming. Not the old hum. A new, small one, like it's practising."],
        baker: ["Flour keeps in a wet cellar. Faith keeps in a wet heart. Both are very nearly true.",
                "The mill wheel hasn't turned since the water rose. The bread's coarser. Don't tell anyone I said so."],
        farmhand_young: ["I saw the crank go. It went past the pond like a fish, all shiny and quick, and I said 'Odo will want that.' And then I forgot to say it to Odo.",
                         "If you find the gear, give it a good clean before you hand it over. The geese have opinions about it."],
    }[name];
    const displayName = { angler: "Netter", baker: "Baker", farmhand_young: "Pip" }[name];
    const n = api.getVar("talk_" + name, 0);
    api.setVar("talk_" + name, n + 1);
    api.playSound("select");
    yield api.say(displayName, lines[n % lines.length]);
}

function* onEnemyDefeated(name) {
    if (Math.random() > 0.1)
        return;
    if (name === "crocodile") {
        yield api.wait(0.3);
        yield api.say("Lara", "A river beast a long way from any river that wants it.");
    } else if (name === "water_spirit") {
        yield api.wait(0.3);
        yield api.say("Lara", "It went back into the ground like rain, which I suppose it was.");
    }
}

function* onItemCollected(itemId) {
    if (itemId !== "sluice_wheel")
        return;
    yield api.wait(0.3);
    yield api.say("Lara", "A small brass wheel, still wet. When I turn it a quarter, I can feel a river on the other side of the world lean toward me.");
    yield api.say("???", "Fourth of nine. A river is only a promise the ground makes to the sea. You reminded it. That's most of what any of us ever do.");
    yield api.say("Lara", "You always sound like you're standing at the edge of something.");
    yield api.say("???", "Only lately. The next place is a quarter where two guilds have stopped speaking, and both of them are right.");
    api.setGlobalVar("chapter", 21);
    api.playSound("select");
    yield api.wait(0.8);
    api.loadLevel("chapter21.json");
}
