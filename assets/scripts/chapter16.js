// ============================================================================
// ShadowShine - Chapter 16: "The Long Room"
// ============================================================================
//
// Two parts: the TOWN comes first, the MAZE after it. This level runs left to right
// (the hero spawns against the west edge). Map: 180x102, tileset dirt_grass, lighting sunrise.
//   - town   cols 1-48
//   - maze   cols 49-168, rows 1-100, corridors 2 wide, walls 3 thick
//   - pocket cols 169-178 (where the maze lets out)
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
const W = 180, H = 102;
const DIR = 1;                        // 1: this level runs left -> right
const START_U = 3;                        // the hero spawns this many columns in from the start edge
const MID = 51;                        // row of the road that leads to the maze gate
const TOWN_U = 48;                        // the town fills u = 1..TOWN_U (u counts from the start edge)
const MAZE_WEST = 49, MAZE_EAST = 168;   // absolute columns of the maze block
const MAZE_NORTH = 1, MAZE_SOUTH = 100;        // its rows
const MAZE_CORRIDOR = 2, MAZE_WALL = 3;
const POCKET_U0 = 169, POCKET_U1 = 178;   // the exit pocket beyond the maze (u), 10 columns

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
// Chapter 16 - "The Long Room" (dirt_grass, sunrise). Runs LEFT to RIGHT. The
// finale of the ten-chapter run that began at the Frostmarket: a hushed
// village where nobody speaks above a whisper, then the Long Room itself - a
// maze of ruined hall, dirt floors and roofless walls under the first honest
// sunrise the story has had.
//
// QUEST (hostage + boss + note-check):
//  - The Choirmaster is held in the maze, guarded. Free him.
//  - He can "sound the chord": he listens for the relics Lara has carried out
//    of the nine earlier places. A full chord is a full reward; a partial one
//    still counts (never a hard lock - only the wording and the reward change).
//  - The Cantor (a lich_king) holds the Long Room door. It falls, and once the
//    chord has been sounded too, the door (the maze's exit gate) opens.
//  - Past the door: the hum_keystone. The chapter ends on a hook (the open door,
//    the light beyond it) and hands off to chapter 17, where the second run of
//    nine places - the Quiet Road - begins.
// ----------------------------------------------------------------------------
const TOWN = [
    ["wildflowers", 3, 45],
    ["bush", 4, 14],
    ["tree_stump", 4, 37],
    ["wheelbarrow", 5, -40],
    ["wildflowers", 5, -20],
    ["tree_stump", 5, 9],
    ["cottage_a", 5, 12],
    ["rocks_small", 6, 34],
    ["bench", 7, -42],
    ["fence_straight", 8, -47],
    ["cart", 8, -33],
    ["haystack", 11, -38],
    ["armory_rack", 11, -17],
    ["wheelbarrow", 11, 45],
    ["rocks_small", 12, 26],
    ["bush", 13, -31],
    ["cottage_b", 14, -43],
    ["market_stall", 14, -24],
    ["cart", 15, -47],
    ["cottage_b", 15, -16],
    ["wildflowers", 15, -12],
    ["stone_fireplace", 16, -39],
    ["chapel", 16, -20],
    ["bench", 17, -13],
    ["tree_stump", 17, 8],
    ["dovecote", 18, 42],
    ["haystack", 18, 47],
    ["wheelbarrow", 19, -17],
    ["oak_tree", 19, 15],
    ["oak_tree", 20, -27],
    ["bench", 20, 3],
    ["cottage_a", 20, 23],
    ["courtyard_well", 24, -4],
    ["notice_board", 28, -3],
    ["oak_tree", 28, 3],
    ["chapel", 30, -18],
    ["oak_tree", 30, 38],
    ["bench", 33, -36],
    ["tree_stump", 33, -24],
    ["cart", 33, 11],
    ["rocks_small", 34, -18],
    ["fence_straight", 34, 20],
    ["oak_tree", 34, 31],
    ["bush", 35, -4],
    ["cart", 36, 8],
    ["wheelbarrow", 36, 18],
    ["fence_straight", 36, 41],
    ["haystack", 37, 34],
    ["rocks_small", 38, -41],
    ["cottage_a", 38, 24],
    ["castle_gate_tower", 39, -21],
    ["bush", 39, 35],
    ["fence_straight", 40, -37],
    ["bush", 41, -16],
    ["blacksmith_forge", 41, -9],
    ["oak_tree", 41, 12],
    ["haystack", 41, 25],
    ["standing_torch_sconce", 42, -3],
    ["fence_straight", 42, 17],
    ["haystack", 43, -22],
    ["bench", 44, -43],
    ["rocks_small", 44, 24],
    ["wildflowers", 44, 27],
    ["wildflowers", 46, -20],
    ["tree_stump", 46, 6],
    ["wheelbarrow", 46, 12]
];
const RELICS = [
    ["frostmarket_bell", "the Frostmarket bell"], ["lantern_core", "the lantern-core"], ["tollkeeper_seal", "the tollkeeper's seal"],
    ["wake_lantern", "the wake lantern"], ["bramble_crown", "the bramble crown"], ["cinder_compass", "the cinder compass"],
    ["relay_tuning_fork", "the relay tuning fork"], ["mirror_shard", "the mirror shard"], ["vigil_lantern", "the vigil lantern"],
];

function* onLevelStart() {
    api.spawnCharacter("lara_cyber", colAt(START_U), MID);
    api.giveControl("lara_cyber");
    respawnCompanions();

    buildTown();
    const exitRows = buildMaze();
    buildPocket();
    if (!api.getVar("door_open", false))
        setExitGate("long_room_door", exitRows, true);

    if (api.getVar("chapter16_intro_seen", false))
        return;
    api.setVar("chapter16_intro_seen", true);

    yield api.wait(0.6);
    yield api.say("Lara", "Morning. A real one - the first sunrise since Fernhollow that isn't holding something back. And the whole village is whispering.");
    yield* companionSays("vex_recruited", "Vex", "The hum has a floor here. It isn't rising any more - it's resting. Something is about to change key.");
    yield* companionSays("nettle_recruited", "Nettle", "Nobody's sick. Nobody's talking either. They're just listening, all of them, the way you'd listen for a door.");
    yield* companionSays("vigil_recruited", "Vigil", "Ten places. Nine relics. I have a suspicion about the tenth, and I find I would rather I were wrong.");
    yield api.say("Hint", "This level runs left to right. The town is behind you; the Long Room is ahead, to the east.");
}

function buildTown() {
    placeProps(TOWN);
    api.spawnProp("signpost", colAt(TOWN_U - 1), MID - 3);
    api.spawnProp("standing_torch_sconce", colAt(TOWN_U), MID + 4);

    api.spawnNpc("tribal_elder_woman", colAt(14), MID - 3);    // the Matron
    api.spawnNpc("baker", colAt(24), MID + 5);                 // Baker
    api.spawnNpc("farmhand_pitchfork", colAt(10), MID + 6);    // Hollis
    api.spawnNpc("herbalist", colAt(30), MID - 5);             // the Herbalist

    if (api.getVar("town_loot_spawned", false))
        return;
    api.setVar("town_loot_spawned", true);
    api.spawnItem("health_potion", colAt(6), MID - 9);
    api.spawnItem("health_potion", colAt(28), MID + 11);
    api.spawnItem("bread_loaf", colAt(34), MID - 12);
    api.spawnItem("stamina_draught", colAt(13), MID + 14);
    api.spawnItem("mana_potion", colAt(20), MID - 10);
}

function buildMaze() {
    const core = ["castle_wall_section", "stone_wall_corner", "ruined_chapel", "stone_archway", "oak_tree", "broken_arcane_statue"];
    const edge = ["bush", "rocks_small", "wildflowers", "tree_stump", "standing_torch_sconce", "ivy_rock"];
    const cells = buildBranchingMaze(MAZE_WEST, MAZE_EAST, MAZE_NORTH, MAZE_SOUTH, MAZE_CORRIDOR, MAZE_WALL,
        core, edge, 161601, { flip: DIR < 0, diagonalSeam: true, solid: true });
    const pool = cells.slice();

    // The Choirmaster, in the middle stretch, with four guards on the cells around him.
    const choir = takeCells(pool, 0.38, 0.62, 1, 161602)[0];
    api.spawnNpc("elder_2", choir.col, choir.row);
    const dist = c => Math.hypot(c.col - choir.col, c.row - choir.row);
    const guardSpots = pool.filter(c => dist(c) >= 4 && dist(c) <= 12).sort((a, b) => dist(a) - dist(b)).slice(0, 4);
    guardSpots.forEach(g => pool.splice(pool.indexOf(g), 1));
    if (!api.getVar("guards_spawned", false)) {
        api.setVar("guards_spawned", true);
        guardSpots.forEach((g, k) => api.spawnEnemy(k % 2 ? "troll" : "orc", g.col, g.row, k % 2 ? 60 : 45));
    }

    // The Cantor keeps the last stretch before the door.
    const cantor = takeCells(pool, 0.90, 0.98, 1, 161603)[0];
    if (!api.getVar("cantor_down", false) && !api.getVar("cantor_spawned", false)) {
        api.setVar("cantor_spawned", true);
        api.spawnEnemy("lich_king", cantor.col, cantor.row, 300);
    }

    spawnPacks(takeCells(pool, 0.06, 0.96, 38, 161604),
        [["mummy", 8, 45], ["skeleton_swordsman", 8, 35], ["ghoul", 8, 35], ["wraith", 8, 45], ["vampire", 6, 60]],
        "maze_hostiles_spawned");

    spawnLoot(takeCells(pool, 0.05, 0.95, 12, 161610),
        ["health_potion", "health_potion", "health_potion", "health_potion", "health_potion", "health_potion",
         "health_potion", "mana_potion", "mana_potion", "elixir_of_clarity", "stamina_draught", "antidote_vial"], "maze_loot_spawned");
    return cells.exitRows;
}

function buildPocket() {
    const [c0, c1] = pocketCols();
    scatterOrganic(["ancient_obelisk", "runic_standing_stone", "standing_torch_sconce", "broken_arcane_statue"], c0, c1, MAZE_NORTH + 2, MAZE_SOUTH - 2, 8, 161620,
        [{ col: colAt(POCKET_U0 + 5), row: MID }]);
    if (!api.getVar("keystone_spawned", false)) {
        api.setVar("keystone_spawned", true);
        api.spawnItem("hum_keystone", colAt(POCKET_U0 + 5), MID);
    }
}

function relicCount() {
    return RELICS.filter(r => api.hasItem(r[0])).length;
}

// The door opens once the Cantor is down AND the chord has been sounded, in either order.
function* openDoorIfReady() {
    if (api.getVar("door_open", false) || !api.getVar("cantor_down", false) || !api.getVar("chord_done", false))
        return;
    api.setVar("door_open", true);
    api.setBarrier("long_room_door", 0, 0, 1, 1, false);
    yield api.wait(0.4);
    yield api.say("Lara", "The Long Room door just let go of its frame. Somewhere far down the hall, a great bar slid back.");
}

function* onTalkTo(name) {
    if (name === "tribal_elder_woman") {
        yield* talkToMatron();
    } else if (name === "elder_2") {
        yield* talkToChoirmaster();
    } else if (name === "baker" || name === "farmhand_pitchfork" || name === "herbalist") {
        yield* talkToTownsfolk(name);
    }
}

function* talkToMatron() {
    const n = api.getVar("matron_talks", 0);
    api.setVar("matron_talks", n + 1);
    api.playSound("select");
    if (api.getVar("door_open", false)) {
        yield api.say("Matron", "The door's open. I felt it in my teeth. Go through, child, and don't let anyone tell you that you should have waited.");
    } else if (n === 0) {
        yield api.say("Matron", "You've come a very long way. I can tell from your boots, and from the way you're carrying that pack - like it's full of small bells.");
        yield api.say("Matron", "The Long Room is a hall, at the end of the road, west to east. It has one door, and the door is tuned - it opens for a chord and for nothing else. Our Choirmaster went to sound it and never came back.");
        yield api.say("Matron", "The Cantor keeps the door now. It used to lead the choir. Something changed it. It doesn't sing any more - it only holds the note.");
        yield api.say("Lara", "So: free the Choirmaster, and put down the Cantor.");
        yield api.say("Matron", "Free him, and he will listen to what you carry and tell you whether it's enough. Put the Cantor down, and the door has nobody left to argue with. Do both, and it opens.");
    } else {
        yield api.say("Matron", "Free the Choirmaster. Put the Cantor down. Then the door. In that order, or the other - so long as it's all three.");
    }
}

function* talkToChoirmaster() {
    api.playSound("select");
    if (!api.getVar("choir_freed", false)) {
        api.setVar("choir_freed", true);
        api.giveExperience(100);
        yield api.say("Choirmaster", "You- you're not one of the Cantor's. Oh, bless every cracked bell in this hall.");
        yield api.say("Lara", "You're the Choirmaster? The Matron sent me.");
        yield api.say("Choirmaster", "She would. She never once let me finish a rehearsal. Listen. Do you hear that? *he tilts his head at her pack, and his face changes*");
    }
    if (!api.getVar("chord_done", false)) {
        const n = relicCount();
        api.setVar("chord_done", true);
        api.setGlobalVar("chord_notes", n);
        yield api.say("Choirmaster", "One note each, and every one of them true. Let me hear you out loud...");
        if (n >= RELICS.length) {
            api.giveExperience(200);
            yield api.say("Choirmaster", "Nine of nine. The bell, the lantern-core, the seal, the wake-lantern, the crown, the compass, the fork, the shard, the vigil light. That's a full chord, and I have not heard one in forty years.");
            yield api.say("Choirmaster", "The door will open for you without a word of complaint. I'd say it will open *gladly*, if a door could.");
            yield* companionSays("cobb_recruited", "Cobb", "A full chord. From a dwarf's point of view: that's what a proper hall sounds like.");
        } else if (n >= 5) {
            api.giveExperience(20 * n);
            yield api.say("Choirmaster", n + " of nine. A chord with a few gaps in it - but a chord all the same. The door will open. It may grumble.");
            yield api.say("Lara", "I didn't know I was supposed to be keeping count.");
            yield api.say("Choirmaster", "Nobody does, child. That's rather the point of a gift.");
        } else {
            api.giveExperience(20 * n);
            yield api.say("Choirmaster", "Only " + n + ". A few lonely notes, and a great many silences between them. The door will open for you - it takes anything true - but it will not be gentle about it.");
            yield api.say("Lara", "I'll manage.");
            yield api.say("Choirmaster", "I never doubted it. It's the door I have doubts about.");
        }
        yield api.say("Choirmaster", "Now. The Cantor holds the note at the far end of the hall. Put it down, and go through.");
        yield* openDoorIfReady();
        return;
    }
    yield api.say("Choirmaster", api.getVar("cantor_down", false)
        ? "The Cantor's quiet, and the door is yours. Go on. I'll keep the hall warm."
        : "The Cantor's at the far end of the hall. Put it down, and the door has nobody left to argue with.");
}

function* talkToTownsfolk(name) {
    const lines = {
        baker: ["I bake in the mornings, and I whisper to the dough. It rises better. I have no idea why.",
                "Everyone here talks in a low voice now. It's not fear. It's more like we're all in a church that hasn't been consecrated yet."],
        farmhand_pitchfork: ["I cut the hay in the Long Room's yard. Never once went inside. The hall's been humming since before I was born.",
                             "The Cantor used to lead the harvest hymns. I miss those. It sang a bit flat, but it *meant* it."],
        herbalist: ["Every herb I dry hangs facing east. Toward the hall. I never chose it. They just lean.",
                    "If you find the Choirmaster, tell him I said his cough syrup's ready. He'll know what I mean. It's a code, for the herbs."],
    }[name];
    const displayName = { baker: "Baker", farmhand_pitchfork: "Hollis", herbalist: "Herbalist" }[name];
    const n = api.getVar("talk_" + name, 0);
    api.setVar("talk_" + name, n + 1);
    api.playSound("select");
    yield api.say(displayName, lines[n % lines.length]);
}

function* onEnemyDefeated(name) {
    if (name === "lich_king" && !api.getVar("cantor_down", false)) {
        api.setVar("cantor_down", true);
        api.giveExperience(300);
        api.playSound("select");
        yield api.wait(0.5);
        yield api.say("Lara", "It didn't scream. It let out the note it had been holding all this time - long, steady, and finally finished.");
        yield* companionSays("vigil_recruited", "Vigil", "It kept a vigil too. Longer than mine. I think I understand it a little better than I would like.");
        if (api.getVar("chord_done", false)) {
            yield* openDoorIfReady();
        } else {
            yield api.say("Lara", "The door is still humming, though. Out of tune. Something's missing - the Choirmaster, maybe. The Matron said he would know.");
        }
        return;
    }
    if (Math.random() > 0.1)
        return;
    if (name === "mummy") {
        yield api.wait(0.3);
        yield api.say("Lara", "Wrapped and waiting since before the hall had a roof. I hope the next wait is shorter.");
    } else if (name === "vampire") {
        yield api.wait(0.3);
        yield api.say("Lara", "It didn't want to be here either. That's what keeps surprising me about every one of them.");
    }
}

function* onItemCollected(itemId) {
    if (itemId !== "hum_keystone")
        return;
    yield api.wait(0.3);
    yield api.say("Lara", "It's warm. And it's quiet. The hum stopped the instant my hand closed on it - I hadn't realised how loud it had been until it wasn't.");
    yield* companionSays("cobb_recruited", "Cobb", "Well. That's a sound I haven't heard since Fernhollow. Nothing at all.");
    yield api.say("???", "Tenth of ten. Every note kept. Thank you, Lara - not for the stones. For walking. Nobody has walked this far in a very long time.");
    yield api.say("Lara", "You keep saying that. Who else was there? Who were they walking toward?");
    yield api.say("???", "Toward me. All of them. I was never a voice in the wall. I was the one at the end of the road, waiting for somebody to bother.");
    yield api.say("Lara", "Then where are you?");
    yield api.say("???", "Look up. The sunrise behind the Long Room isn't a wall. It's a door - and it has been open since you picked up the bell. I only needed you to arrive.");
    yield api.say("Lara", "The light past the last stone has turned a colour I don't have a name for. It's waiting. It feels like it has been for a very long time.");
    yield* companionSays("nettle_recruited", "Nettle", "Lara. Whatever it is - we're right behind you.");
    api.setGlobalVar("chapter", 17);
    api.setGlobalVar("first_arc_complete", true);
    api.playSound("select");
    yield api.wait(1.2);
    api.loadLevel("chapter17.json");
}
