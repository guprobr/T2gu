// ============================================================================
// ShadowShine - Chapter 17: "Hushgate"
// ============================================================================
//
// Two parts: the TOWN comes first, the MAZE after it. This level runs right to left
// (the hero spawns against the east edge). Map: 160x84, tileset dirt_snow, lighting torch.
//   - town   cols 117-158
//   - maze   cols 11-116, rows 1-82, corridors 2 wide, walls 3 thick
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
const W = 160, H = 84;
const DIR = -1;                        // -1: this level runs right -> left
const START_U = 3;                        // the hero spawns this many columns in from the start edge
const MID = 41;                        // row of the road that leads to the maze gate
const TOWN_U = 42;                        // the town fills u = 1..TOWN_U (u counts from the start edge)
const MAZE_WEST = 11, MAZE_EAST = 116;   // absolute columns of the maze block
const MAZE_NORTH = 1, MAZE_SOUTH = 82;        // its rows
const MAZE_CORRIDOR = 2, MAZE_WALL = 3;
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
// Chapter 17 - "Hushgate" (dirt_snow, torch). Runs RIGHT to LEFT. The first
// place on the far side of the Long Room door: a snowbound customs village
// lit by torches, where everyone speaks in whispers, then the Snowlanes - a
// maze of drifted lanes and fenced fields.
//
// QUEST (lost property): the road out of Hushgate is stamped by the Claims
// Clerk, and the Clerk will not stamp it while any claim on the ledger is open.
// Three villagers each lost something in the Snowlanes. Find the three
// things, return each to its owner (in any order), and the Clerk closes the
// ledger and lifts the claims gate at the maze's exit.
// ----------------------------------------------------------------------------
const TOWN = [
    ["rocks_small", 3, 14],
    ["pine_tree", 4, -37],
    ["haystack", 4, -24],
    ["rocks_small", 6, -37],
    ["snowy_pine", 6, -20],
    ["rocks_small", 6, -13],
    ["bench", 6, 11],
    ["wheelbarrow", 6, 19],
    ["wheelbarrow", 7, -27],
    ["snowy_pine", 7, 30],
    ["cottage_a", 8, -17],
    ["cart", 9, 17],
    ["bush", 10, 25],
    ["cottage_b", 11, -35],
    ["snowy_pine", 13, -11],
    ["dovecote", 13, 23],
    ["bench", 13, 38],
    ["snowy_pine", 14, -32],
    ["pine_tree", 14, -24],
    ["market_stall", 14, 27],
    ["rain_barrel", 14, 29],
    ["pine_tree", 16, -11],
    ["bush", 17, -15],
    ["bench", 17, 3],
    ["rain_barrel", 17, 38],
    ["notice_board", 21, -4],
    ["well", 25, -3],
    ["snowy_pine", 25, 3],
    ["snowy_pine", 26, -10],
    ["bench", 26, 16],
    ["wheelbarrow", 26, 18],
    ["fence_straight", 26, 25],
    ["wheelbarrow", 26, 30],
    ["cottage_b", 27, -13],
    ["chapel", 28, -34],
    ["haystack", 28, -10],
    ["snowy_pine", 28, 38],
    ["stone_fireplace", 29, -24],
    ["bush", 29, -21],
    ["pine_tree", 29, 19],
    ["haystack", 29, 30],
    ["snowy_pine", 30, 27],
    ["snowy_pine", 31, 7],
    ["cottage_a", 31, 23],
    ["bench", 32, -19],
    ["fence_straight", 32, 16],
    ["snowy_pine", 33, -38],
    ["rain_barrel", 33, -30],
    ["pine_tree", 34, -26],
    ["bush", 34, 37],
    ["cottage_a", 35, -23],
    ["fence_straight", 35, 15],
    ["rain_barrel", 36, -4],
    ["chapel", 36, 7],
    ["laundry_line", 37, 13],
    ["fence_straight", 38, -31],
    ["rocks_small", 38, 36],
    ["snowy_pine", 39, -4],
    ["haystack", 40, -31],
    ["haystack", 40, -22],
    ["fence_straight", 40, 6],
    ["bush", 40, 30],
    ["haystack", 40, 38],
    ["standing_torch_sconce", 41, -3]
];
// owner NPC -> [the lost item, display name, where they say they lost it]
const CLAIMS = {
    farmhand_young: ["lost_music_box", "Pip", "somewhere near the start of the lanes"],
    tribal_gatherer_girl: ["lost_locket", "Nell", "in the middle stretch, among the fences"],
    lumberjack_2: ["lost_talisman", "Old Tam", "right at the far end, by the last drifts"],
};
const HEADING = DIR > 0 ? "east" : "west";

function* onLevelStart() {
    api.spawnCharacter("lara_cyber", colAt(START_U), MID);
    api.giveControl("lara_cyber");
    respawnCompanions();

    buildTown();
    const exitRows = buildMaze();
    buildPocket();
    if (!api.getVar("claims_done", false))
        setExitGate("claims_gate", exitRows, true);

    if (api.getVar("chapter17_intro_seen", false))
        return;
    api.setVar("chapter17_intro_seen", true);

    yield api.wait(0.6);
    yield api.say("Lara", "The door closed behind us without a sound. No hum. I keep waiting for it, the way you wait for a step that isn't there.");
    yield* companionSays("vex_recruited", "Vex", "My instruments read zero. Not low - zero. I have never seen a place this quiet that was also inhabited.");
    yield* companionSays("cobb_recruited", "Cobb", "Snow, torchlight, and folk who whisper. I like it already, and I do not trust that.");
    yield api.say("Hint", "This level runs right to left. The town is behind you; the Snowlanes are ahead, to the west.");
}

function buildTown() {
    placeProps(TOWN);
    api.spawnProp("signpost", colAt(TOWN_U - 1), MID - 3);
    api.spawnProp("standing_torch_sconce", colAt(TOWN_U), MID + 4);

    api.spawnNpc("gnome_wizard", colAt(14), MID - 3);              // the Claims Clerk
    api.spawnNpc("farmhand_young", colAt(24), MID + 5);            // Pip
    api.spawnNpc("tribal_gatherer_girl", colAt(10), MID + 6);      // Nell
    api.spawnNpc("lumberjack_2", colAt(30), MID - 5);              // Old Tam

    if (api.getVar("town_loot_spawned", false))
        return;
    api.setVar("town_loot_spawned", true);
    api.spawnItem("health_potion", colAt(6), MID - 9);
    api.spawnItem("dried_rations", colAt(28), MID + 11);
    api.spawnItem("waterskin", colAt(34), MID - 12);
    api.spawnItem("stamina_draught", colAt(13), MID + 14);
}

function buildMaze() {
    const core = ["snowy_pine", "pine_tree", "cottage_b", "boulder_large", "stone_wall_corner", "haystack"];
    const edge = ["rocks_small", "bush", "standing_torch_sconce", "fence_straight", "tree_stump"];
    const cells = buildBranchingMaze(MAZE_WEST, MAZE_EAST, MAZE_NORTH, MAZE_SOUTH, MAZE_CORRIDOR, MAZE_WALL,
        core, edge, 171701, { flip: DIR < 0, diagonalSeam: true, solid: true });
    const pool = cells.slice();

    // The three lost things, one per third of the lanes - in the same order the owners say.
    const bands = [[0.08, 0.30], [0.40, 0.62], [0.72, 0.94]];
    const spots = bands.map((b, k) => takeCells(pool, b[0], b[1], 1, 171702 + k)[0]);
    spawnLoot(spots, ["lost_music_box", "lost_locket", "lost_talisman"], "claims_items_spawned");

    spawnPacks(takeCells(pool, 0.06, 1.0, 36, 171706),
        [["wolf", 10, 30], ["slime_ice", 8, 25], ["skeleton_swordsman", 8, 35], ["harpy", 6, 30], ["bear", 4, 55]],
        "maze_hostiles_spawned");

    spawnLoot(takeCells(pool, 0.05, 0.95, 11, 171710),
        ["health_potion", "health_potion", "health_potion", "health_potion", "health_potion", "health_potion",
         "mana_potion", "antidote_vial", "elixir_of_clarity", "stamina_draught", "reinforced_boots"], "maze_loot_spawned");
    return cells.exitRows;
}

function buildPocket() {
    const [c0, c1] = pocketCols();
    scatterOrganic(["snowy_pine", "standing_torch_sconce", "pine_tree", "boulder_large"], c0, c1, MAZE_NORTH + 2, MAZE_SOUTH - 2, 8, 171720,
        [{ col: colAt(POCKET_U0 + 5), row: MID }]);
    if (!api.getVar("stamp_spawned", false)) {
        api.setVar("stamp_spawned", true);
        api.spawnItem("clerks_stamp", colAt(POCKET_U0 + 5), MID);
    }
}

function claimsReturned() {
    return Object.keys(CLAIMS).filter(k => api.getVar("returned_" + k, false)).length;
}

function* onTalkTo(name) {
    if (name === "gnome_wizard") {
        yield* talkToClerk();
    } else if (CLAIMS[name]) {
        yield* talkToClaimant(name);
    }
}

function* talkToClerk() {
    const n = api.getVar("clerk_talks", 0);
    api.setVar("clerk_talks", n + 1);
    api.playSound("select");
    const done = claimsReturned();
    if (api.getVar("claims_done", false)) {
        yield api.say("Clerk", "All claims closed, ledger shut, road stamped. Do you know how long it has been since I could say that? Go on through. Quietly, please - it's a habit.");
    } else if (done >= Object.keys(CLAIMS).length) {
        api.setVar("claims_done", true);
        api.setBarrier("claims_gate", 0, 0, 1, 1, false);
        api.giveExperience(100);
        yield api.say("Clerk", "*he counts the returns on his fingers, twice* Three claims. Three closed. That is - that is the whole ledger.");
        yield api.say("Clerk", "*a small wet thump as he brings the stamp down on the road-pass* There. The gate at the far end of the Snowlanes will let you out. It's the first stamp I've been able to give since the hum stopped.");
        yield* companionSays("cobb_recruited", "Cobb", "A whole town held up by one man's ledger. I've seen sillier things hold up mountains.");
    } else if (n === 0) {
        yield api.say("Clerk", "Hushgate is where the road out of the Quiet is stamped. Nobody leaves without a stamp. It is the only rule we have left, so we keep it very carefully.");
        yield api.say("Clerk", "But my ledger has three open claims - three people who lost something in the Snowlanes, west of here - and I do not stamp a road while a claim is open. It isn't cruelty. It's that a road stamped over an open claim goes crooked.");
        yield api.say("Lara", "So I find their things and bring them home.");
        yield api.say("Clerk", "Each to its owner, in whatever order you like. When all three are closed, come and see me.");
    } else {
        yield api.say("Clerk", "Claims closed: " + done + " of " + Object.keys(CLAIMS).length + ". The three owners are in the village. They will tell you where they lost things.");
    }
}

function* talkToClaimant(name) {
    const [itemId, who, where] = CLAIMS[name];
    api.playSound("select");
    if (api.getVar("returned_" + name, false)) {
        yield api.say(who, "You found it. I keep touching it to make sure. Thank you.");
        return;
    }
    if (api.hasItem(itemId)) {
        api.removeItem(itemId, 1);
        api.setVar("returned_" + name, true);
        api.giveExperience(40);
        const RETURN_LINES = {
            farmhand_young: "*he winds the key, and the little box plays half a tune, and waits* ...It always waits. It's waiting for a second half nobody remembers. But it's mine again. Thank you!",
            tribal_gatherer_girl: "*she closes her hand around the locket and doesn't open it* My grandmother's. I lost it the week the hum stopped, and I thought - I thought that was the same thing as losing her again.",
            lumberjack_2: "*he turns the woven charm over, counting knots* Every winter, one knot. Forty-one. Ha! I thought the drifts had it for good.",
        };
        yield api.say(who, RETURN_LINES[name]);
        const left = Object.keys(CLAIMS).length - claimsReturned();
        if (left === 0)
            yield api.say("Lara", "That's all three. The Clerk was waiting on exactly this.");
        return;
    }
    const n = api.getVar("claim_talks_" + name, 0);
    api.setVar("claim_talks_" + name, n + 1);
    if (n === 0) {
        const OPENING = {
            farmhand_young: "I lost my music box. It's not worth anything. It only plays half a tune. But it is the only thing my mother left me that still does anything.",
            tribal_gatherer_girl: "I lost my grandmother's locket while gathering. It's silver, and warm, and I know that's an odd thing to say about metal.",
            lumberjack_2: "My charm. Woven, a knot for every winter I've survived. Forty-one knots. A man my age doesn't get to replace those.",
        };
        yield api.say(who, OPENING[name]);
        yield api.say(who, "I lost it " + where + " of the Snowlanes - " + HEADING + " of here.");
    } else {
        yield api.say(who, "Still looking? " + where.charAt(0).toUpperCase() + where.slice(1) + ", I think. Thank you for going.");
    }
}

function* onEnemyDefeated(name) {
    if (Math.random() > 0.1)
        return;
    if (name === "harpy") {
        yield api.wait(0.3);
        yield api.say("Lara", "It didn't shriek. Even the birds out here are whispering.");
    } else if (name === "skeleton_swordsman") {
        yield api.wait(0.3);
        yield api.say("Lara", "A guard at a customs post that stopped existing. He kept the post anyway.");
    }
}

function* onItemCollected(itemId) {
    if (itemId !== "clerks_stamp")
        return;
    yield api.wait(0.3);
    yield api.say("Lara", "It's warm from the pocket, like something that's been held for a long time by someone who never quite trusted it not to vanish.");
    yield api.say("???", "First of nine. I can hear you now, Lara, without the hum in the way. It's a great deal, isn't it? Being heard.");
    yield api.say("Lara", "You sound closer than you did at the Long Room. Where are you?");
    yield api.say("???", "Further along the road. Nine places, nine keepsakes. This one taught you that a quiet place is not an empty one. The next is a keep whose doors were locked by somebody very frightened.");
    api.setGlobalVar("chapter", 18);
    api.playSound("select");
    yield api.wait(0.8);
    api.loadLevel("chapter18.json");
}
