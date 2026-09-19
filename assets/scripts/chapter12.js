// ============================================================================
// ShadowShine - Chapter 12: "Cinderport"
// ============================================================================
//
// Two parts: the TOWN comes first, the MAZE after it. This level runs left to right
// (the hero spawns against the west edge). Map: 174x96, tileset stone_grass, lighting torch.
//   - town   cols 1-46
//   - maze   cols 47-162, rows 1-94, corridors 3 wide, walls 3 thick
//   - pocket cols 163-172 (where the maze lets out)
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
const W = 174, H = 96;
const DIR = 1;                        // 1: this level runs left -> right
const START_U = 3;                        // the hero spawns this many columns in from the start edge
const MID = 44;                        // row of the road that leads to the maze gate
const TOWN_U = 46;                        // the town fills u = 1..TOWN_U (u counts from the start edge)
const MAZE_WEST = 47, MAZE_EAST = 162;   // absolute columns of the maze block
const MAZE_NORTH = 1, MAZE_SOUTH = 94;        // its rows
const MAZE_CORRIDOR = 3, MAZE_WALL = 3;
const POCKET_U0 = 163, POCKET_U1 = 172;   // the exit pocket beyond the maze (u), 10 columns

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
// Chapter 12 - "Cinderport" (stone_grass, torch). Runs LEFT to RIGHT. A stone
// foundry harbour lit by forge-glow and torches, then the Slagworks - a maze
// of ruined foundry halls with WIDE (3-tile) corridors, grass pushing up
// through the stone.
//
// QUEST (boss hunt): the crucible gate at the far end of the Slagworks is
// held by the Slagwarden - a golem the foundry once used to keep the forges
// from burning down. The hum woke it to its worst instructions. Defeat it and
// the crucible gate (the maze's exit) lifts.
// ----------------------------------------------------------------------------
const TOWN = [
    ["water_trough", 3, 9],
    ["rain_barrel", 3, 48],
    ["stacked_ale_barrels", 4, 14],
    ["fence_straight", 5, -17],
    ["barrels_crates", 5, 36],
    ["cart", 6, -24],
    ["stone_fireplace", 6, -13],
    ["barrels_crates", 6, 31],
    ["cottage_a", 7, 14],
    ["rocks_small", 7, 18],
    ["water_trough", 10, -25],
    ["wooden_chest", 10, -13],
    ["barrels_crates", 11, -23],
    ["bench", 12, 43],
    ["fence_straight", 13, -41],
    ["blacksmith_forge", 13, -35],
    ["water_trough", 14, 22],
    ["fence_straight", 15, -39],
    ["stacked_ale_barrels", 15, -20],
    ["rocks_small", 16, -15],
    ["stacked_ale_barrels", 16, 21],
    ["wooden_chest", 16, 25],
    ["rain_barrel", 16, 42],
    ["cart", 17, -35],
    ["cottage_b", 18, -12],
    ["bench", 18, 38],
    ["stacked_ale_barrels", 19, 3],
    ["courtyard_well", 20, -3],
    ["notice_board", 26, -3],
    ["water_trough", 27, 3],
    ["salvage_pile", 28, -35],
    ["barrels_crates", 28, -30],
    ["water_trough", 28, -28],
    ["market_stall", 29, -16],
    ["wooden_chest", 29, 25],
    ["salvage_pile", 29, 44],
    ["rain_barrel", 30, -19],
    ["market_stall", 30, 22],
    ["cart", 31, 32],
    ["stacked_ale_barrels", 32, 41],
    ["cart", 32, 46],
    ["rocks_small", 33, 30],
    ["barrels_crates", 34, 10],
    ["wooden_chest", 35, 46],
    ["blacksmith_forge", 36, 14],
    ["cottage_a", 37, 21],
    ["rocks_small", 38, -16],
    ["standing_torch_sconce", 38, -3],
    ["cottage_a", 38, 11],
    ["salvage_pile", 38, 28],
    ["wooden_chest", 38, 37],
    ["rocks_small", 39, 46],
    ["bench", 40, -30],
    ["cart", 40, 18],
    ["bench", 41, 13],
    ["barrels_crates", 41, 47],
    ["bench", 42, -34],
    ["stacked_ale_barrels", 42, -18],
    ["fence_straight", 43, -38],
    ["tavern_bar_counter", 43, -15],
    ["rain_barrel", 44, 12],
    ["salvage_pile", 44, 25]
];

function* onLevelStart() {
    api.spawnCharacter("lara_cyber", colAt(START_U), MID);
    api.giveControl("lara_cyber");
    respawnCompanions();

    buildTown();
    const exitRows = buildMaze();
    buildPocket();
    if (!api.getVar("warden_down", false))
        setExitGate("crucible_gate", exitRows, true);

    if (api.getVar("chapter12_intro_seen", false))
        return;
    api.setVar("chapter12_intro_seen", true);

    yield api.wait(0.6);
    yield api.say("Lara", "Cinderport. You can feel the forges before you see them - the air itself is bruised orange.");
    yield* companionSays("cobb_recruited", "Cobb", "Now THAT is a foundry. Do you smell the iron? The honest, stubborn iron?");
    yield* companionSays("vigil_recruited", "Vigil", "Forge-glow makes for poor cover. Everyone will see us coming.");
    yield api.say("Hint", "This level runs left to right. The town is behind you; the Slagworks are ahead, to the east.");
}

function buildTown() {
    placeProps(TOWN);
    api.spawnProp("signpost", colAt(TOWN_U - 1), MID - 3);
    api.spawnProp("standing_torch_sconce", colAt(TOWN_U), MID - 4);
    api.spawnProp("standing_torch_sconce", colAt(TOWN_U), MID + 5);

    api.spawnNpc("blacksmith_2", colAt(14), MID - 3);     // the Forgemaster
    api.spawnNpc("dwarf_bomber", colAt(24), MID + 5);     // Blaster
    api.spawnNpc("lumberjack", colAt(10), MID + 6);       // the stoker
    api.spawnNpc("merchant", colAt(30), MID - 5);

    if (api.getVar("town_loot_spawned", false))
        return;
    api.setVar("town_loot_spawned", true);
    api.spawnItem("whetstone", colAt(6), MID - 9);
    api.spawnItem("small_ingot", colAt(28), MID + 11);
    api.spawnItem("ore_chunk", colAt(34), MID - 12);
    api.spawnItem("health_potion", colAt(13), MID + 14);
}

function buildMaze() {
    const core = ["stone_wall_corner", "stone_wall_corner_alt", "castle_wall_section", "stacked_ale_barrels", "mine_cart", "support_beam"];
    const edge = ["barrels_crates", "rain_barrel", "rocks_small", "salvage_pile", "ivy_rock"];
    const cells = buildBranchingMaze(MAZE_WEST, MAZE_EAST, MAZE_NORTH, MAZE_SOUTH, MAZE_CORRIDOR, MAZE_WALL,
        core, edge, 121201, { flip: DIR < 0, diagonalSeam: true, solid: true });
    const pool = cells.slice();

    spawnPacks(takeCells(pool, 0.06, 1.0, 38, 121202),
        [["fire_spirit", 10, 40], ["imp", 12, 30], ["lizardman", 8, 45], ["orc", 8, 45]], "maze_hostiles_spawned");

    // The Slagwarden waits in the last stretch before the exit. One golem, a great deal of it.
    const warden = takeCells(pool, 0.90, 0.98, 1, 121203)[0];
    if (!api.getVar("warden_down", false) && !api.getVar("warden_spawned", false)) {
        api.setVar("warden_spawned", true);
        api.spawnEnemy("golem", warden.col, warden.row, 260);
    }

    spawnLoot(takeCells(pool, 0.05, 0.95, 12, 121210),
        ["health_potion", "health_potion", "health_potion", "health_potion", "health_potion", "health_potion",
         "health_potion", "mana_potion", "tech_gauntlet", "reinforced_boots", "elixir_of_clarity", "stamina_draught"], "maze_loot_spawned");
    return cells.exitRows;
}

function buildPocket() {
    const [c0, c1] = pocketCols();
    scatterOrganic(["blacksmith_forge", "stacked_ale_barrels", "stone_fireplace", "standing_torch_sconce"], c0, c1, MAZE_NORTH + 2, MAZE_SOUTH - 2, 8, 121220,
        [{ col: colAt(POCKET_U0 + 5), row: MID }]);
    if (!api.getVar("compass_spawned", false)) {
        api.setVar("compass_spawned", true);
        api.spawnItem("cinder_compass", colAt(POCKET_U0 + 5), MID);
    }
}

function* onTalkTo(name) {
    if (name === "blacksmith_2") {
        yield* talkToForgemaster();
    } else if (name === "dwarf_bomber" || name === "lumberjack" || name === "merchant") {
        yield* talkToTownsfolk(name);
    }
}

function* talkToForgemaster() {
    const n = api.getVar("forgemaster_talks", 0);
    api.setVar("forgemaster_talks", n + 1);
    api.playSound("select");
    if (api.getVar("warden_down", false)) {
        yield api.say("Forgemaster", "It's down. Properly down. The crucible gate stood up and let go, like it had been waiting to be told it could. Go on through.");
    } else if (n === 0) {
        yield api.say("Forgemaster", "Cinderport's forges run on one rule: nothing burns that isn't meant to. The Slagwarden enforces it. Golem, iron-boned, older than the harbour.");
        yield api.say("Forgemaster", "Three nights ago the hum got into it. Now it enforces the rule against *everything*. It's sitting on the crucible gate at the end of the Slagworks, and it won't let anyone or anything past.");
        yield api.say("Lara", "So we take it down.");
        yield api.say("Forgemaster", "You do. It's slow, it hits like a falling wall, and it takes a good deal of hitting. Don't fight it in the open - use the corners. The Slagworks have plenty. Bring potions.");
    } else {
        yield api.say("Forgemaster", "Slagwarden. End of the Slagworks. Corners, patience, and potions - in that order.");
    }
}

function* talkToTownsfolk(name) {
    const lines = {
        dwarf_bomber: ["You want to take a golem down? Two words: shaped charges. Three, if you count 'please stand back'.",
                       "I offered to blow a hole in the Slagwarden's shift roster. Forgemaster said that's not what a shift roster is."],
        lumberjack: ["I haul coal. Was hauling coal. Now I mostly haul coal to a gate that doesn't open.",
                     "A golem like that never sleeps. But it does stop to think, sometimes. That's when you swing."],
        merchant: ["Iron's up. Everything else is down. That's the whole economy of a foundry town in one sentence.",
                   "Wrap your hands. Slag burns worse than fire, and it has less pride about it."],
    }[name];
    const displayName = { dwarf_bomber: "Blaster", lumberjack: "Stoker", merchant: "Merchant" }[name];
    const n = api.getVar("talk_" + name, 0);
    api.setVar("talk_" + name, n + 1);
    api.playSound("select");
    yield api.say(displayName, lines[n % lines.length]);
}

// The boss: its death lifts the crucible gate.
function* onEnemyDefeated(name) {
    if (name === "golem" && !api.getVar("warden_down", false)) {
        api.setVar("warden_down", true);
        api.setBarrier("crucible_gate", 0, 0, 1, 1, false);
        api.giveExperience(200);
        api.playSound("select");
        yield api.wait(0.5);
        yield api.say("Lara", "It didn't fall so much as *let go*. Like it had been waiting for someone to tell it the shift was over.");
        yield* companionSays("cobb_recruited", "Cobb", "Iron doesn't tire, lass. It just needs somebody to say it can stop.");
        yield api.say("Lara", "The crucible gate's lifting. I can hear the chain from here.");
        return;
    }
    if (Math.random() > 0.1)
        return;
    if (name === "fire_spirit") {
        yield api.wait(0.3);
        yield api.say("Lara", "Warm, then gone. Even the fires here are exhausted.");
    } else if (name === "lizardman") {
        yield api.wait(0.3);
        yield api.say("Lara", "It didn't want to be in the foundry either. Nobody here did.");
    }
}

function* onItemCollected(itemId) {
    if (itemId !== "cinder_compass")
        return;
    yield api.wait(0.3);
    yield api.say("Lara", "The needle isn't pointing north. It's pointing... at the forge. At the coals, actually. At whatever's still burning.");
    yield api.say("???", "Sixth of ten. Not everything that burns is destroyed, Lara. Some things only burn to be seen.");
    yield api.say("Lara", "You say that like you're speaking from experience.");
    yield api.say("???", "I said I hid them where a kind person would walk. I never said I stayed away myself. Onward. The next place is underground, and it's full of trains that never stopped running.");
    api.setGlobalVar("chapter", 13);
    api.playSound("select");
    yield api.wait(0.8);
    api.loadLevel("chapter13.json");
}
