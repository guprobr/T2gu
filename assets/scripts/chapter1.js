// ============================================================================
// ShadowShine - Chapter 1: "Fernhollow"
// ============================================================================
//
// Two parts: the TOWN comes first, the MAZE after it. This level runs left to right
// (the hero spawns against the west edge). Map: 150x78, tileset grass_water, lighting sunrise.
//   - town   cols 1-40
//   - river  cols 41-44 (one ford)
//   - maze   cols 45-148, rows 1-76, corridors 2 wide, walls 4 thick
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
    // Below each mouth (the openings in the outer border), wall tiles get small edge props,
    // never the block's core set-piece. Props draw upward from their base, so a core prop a
    // few rows south of the opening (a cottage is ~3-4 tiles tall, cliff_face ~7-8) painted over
    // the whole 2-tile corridor: the gap was walkable but the maze read as a solid wall from
    // outside. The border's outer face never counts as a seam (isOpenAt only knows the maze's
    // own tiles), which is why the border under a mouth got the big type. The side margin
    // covers wide art (cliff_face spans ~5-6 tiles). Rolled from a separate stream so every
    // other prop in the maze comes out exactly as before. Both margins widened by one tile
    // (2026-09-27) after every prop's catalog width grew ~9% (buildings ~18%) to read as more
    // proportional to characters - re-derive these if that calibration ever changes again.
    const kMouthClearRows = 8, kMouthSideMargin = 3;
    const mouthRand = mulberry32(seed ^ 0x6d6f7574);
    function inMouthBand(c, r) {
        const band = (c0, c1, openingSouthRow) => c >= c0 && c <= c1 && r > openingSouthRow && r <= openingSouthRow + kMouthClearRows;
        return band(west, cellColEnd(0) + kMouthSideMargin, cellRowEnd(startCy))
            || band(cellColStart(numCellsX - 1) - kMouthSideMargin, east, cellRowEnd(exitCy));
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
                else if (inMouthBand(c, r))
                    api.spawnProp(edgeObstacles[Math.floor(mouthRand() * edgeObstacles.length)], X(c), r);
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
const W = 150, H = 78;
const DIR = 1;                        // 1: this level runs left -> right
const START_U = 3;                        // the hero spawns this many columns in from the start edge
const MID = 37;                        // row of the road that leads to the maze gate
const TOWN_U = 40;                        // the town fills u = 1..TOWN_U (u counts from the start edge)
const MAZE_WEST = 45, MAZE_EAST = 148;   // absolute columns of the maze block
const MAZE_NORTH = 1, MAZE_SOUTH = 76;        // its rows
const MAZE_CORRIDOR = 2, MAZE_WALL = 4;
const POCKET_U0 = 149, POCKET_U1 = 148;   // the exit pocket beyond the maze (u), 0 columns

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


// ----------------------------------------------------------------------------
// Chapter 1 - Fernhollow, reformulated (2026-09-19).
//
// Now in two parts. PART ONE is the village of Fernhollow itself - a real
// town this time, cols 1-40, with Wren by the well, a few neighbours, the
// basic supplies, and a market road that runs straight to the river. A river
// (cols 41-44) closes it off with a single ford and a footbridge, and past it
// PART TWO begins: the Hollowbrook Maze, cols 45-148, one genuine branching
// maze (same generator as every other chapter) holding everything from the
// original chapter - the order-of-three riddle, the fox-and-deer riddle, the
// hostage, the wildlife, the loot, and the glowing acorn at the far end.
// Runs left to right.
// ----------------------------------------------------------------------------

function* onLevelStart() {
    api.spawnCharacter("lara_cyber", colAt(START_U), MID);
    api.giveControl("lara_cyber");

    buildTown();
    buildMaze();

    if (api.getVar("chapter1_intro_seen", false))
        return;
    api.setVar("chapter1_intro_seen", true);

    yield api.wait(0.6);
    yield api.say("Lara", "Fernhollow. Same crooked fences, same well that's two-thirds full of ambition and one-third full of actual water.");
    yield api.say("Hint", "WASD or the Arrow keys make Lara go. Gravity handles the rest, mostly downhill.");
    yield api.say("Hint", "Hold Shift to run. Adventuring is ten percent bravery, ninety percent not being late.");
    yield api.say("Hint", "Press E near someone, or something, to talk or take a closer look. Statues rarely mind. Guards mind a great deal.");
    yield api.say("Hint", "Ctrl throws a punch. I opens the bag of stuff you're absolutely going to forget you're carrying. Tab swaps who's driving.");
    yield api.say("Lara", "Wren said she'd be by the well this morning. Let's see if 'this morning' means the same thing to her as it does to the rest of the calendar.");
}

// ============================================================================
// Part one - the town. Buildings and decoration come from the composed layout
// below (roads, the plaza and every NPC/item spot are kept clear of it).
// ============================================================================
const TOWN = [
    ["rain_barrel", 3, -14],
    ["fence_straight", 3, 16],
    ["bench", 4, -25],
    ["rocks_small", 4, 20],
    ["laundry_line", 4, 25],
    ["fence_straight", 5, -30],
    ["wildflowers", 5, -15],
    ["laundry_line", 6, 23],
    ["bush", 6, 29],
    ["cottage_a", 7, 20],
    ["wheelbarrow", 7, 25],
    ["oak_tree", 8, -30],
    ["pine_tree", 9, 28],
    ["bush", 10, -31],
    ["bush", 10, -22],
    ["wheelbarrow", 11, -17],
    ["wheelbarrow", 12, -26],
    ["haystack", 12, 23],
    ["oak_tree", 13, -28],
    ["wildflowers", 13, -19],
    ["oak_tree", 14, -25],
    ["cottage_b", 14, -15],
    ["cottage_a", 14, -7],
    ["bush", 15, -29],
    ["rocks_small", 15, -10],
    ["bench", 15, 37],
    ["bush", 16, 8],
    ["market_stall", 16, 21],
    ["rocks_small", 16, 25],
    ["pine_tree", 16, 28],
    ["well", 17, -3],
    ["bench", 17, 3],
    ["notice_board", 23, -3],
    ["bench", 23, 3],
    ["bush", 25, -24],
    ["oak_tree", 25, -7],
    ["fence_corner", 26, -16],
    ["cart", 26, 22],
    ["fence_corner", 26, 28],
    ["wildflowers", 27, -21],
    ["market_stall", 27, -14],
    ["fence_straight", 27, 16],
    ["rocks_small", 28, -11],
    ["haystack", 29, -17],
    ["vegetable_garden", 29, 35],
    ["chicken_coop", 30, -30],
    ["cottage_b", 30, 20],
    ["fence_corner", 31, -22],
    ["pine_tree", 31, 30],
    ["rain_barrel", 33, 11],
    ["fence_straight", 33, 16],
    ["fence_corner", 34, -19],
    ["laundry_line", 34, -17],
    ["rain_barrel", 34, 23],
    ["bush", 35, -33],
    ["wildflowers", 35, 13],
    ["rain_barrel", 36, -25],
    ["haystack", 37, 6],
    ["windmill", 37, 18],
    ["bench", 37, 35],
    ["bench", 38, -34]
];

function buildTown() {
    placeProps(TOWN);

    // The river: reeds along the west bank, lily pads out on the water, and a
    // footbridge over the one ford that lines up with the maze entrance.
    const [gateRow0, gateRow1] = [MID - 1, MID + 2];
    for (let r = MAZE_NORTH + 3; r < MAZE_SOUTH - 2; r += 4) {
        if (r >= gateRow0 - 2 && r <= gateRow1 + 2)
            continue;
        api.spawnProp("reeds", colAt(TOWN_U), r);
        if (r % 8 === 3)
            api.spawnProp("lily_pads", colAt(TOWN_U + 2), r + 1);
    }
    api.spawnProp("wooden_bridge", colAt(TOWN_U + 2), MID);
    api.spawnProp("signpost", colAt(TOWN_U - 2), MID - 3);

    // Wren, and the folk she mentions.
    api.spawnNpc("herbalist", colAt(14), MID - 2);
    api.spawnNpc("baker", colAt(25), MID - 3);
    api.spawnNpc("farmgirl", colAt(27), MID + 4);
    api.spawnNpc("lumberjack", colAt(8), MID + 6);
    api.spawnNpc("fisherman", colAt(38), MID - 6);

    if (api.getVar("chapter1_loot_spawned", false))
        return;
    api.setVar("chapter1_loot_spawned", true);
    api.spawnItem("dried_rations", colAt(6), MID - 9);
    api.spawnItem("bread_loaf", colAt(28), MID + 10);
    api.spawnItem("waterskin", colAt(33), MID - 12);
    api.spawnItem("berry_pouch", colAt(12), MID + 14);
    api.spawnItem("health_potion", colAt(30), MID - 6);
}

// ============================================================================
// Part two - the Hollowbrook Maze. One branching maze from the far bank of the
// river to the far edge of the map. Bigger set-piece props fill each wall
// cluster's interior; small rough undergrowth fills the seam wherever a wall
// meets a corridor (see buildBranchingMaze).
// ============================================================================
function buildMaze() {
    const coreObstacles = ["pine_tree", "oak_tree", "boulder_large", "cliff_face", "dead_tree", "snowy_pine", "dead_twisted_tree", "fallen_log"];
    const edgeObstacles = ["bush", "rocks_small", "tree_stump", "ivy_rock", "berry_bush"];
    const cells = buildBranchingMaze(MAZE_WEST, MAZE_EAST, MAZE_NORTH, MAZE_SOUTH, MAZE_CORRIDOR, MAZE_WALL,
        coreObstacles, edgeObstacles, 11001, { flip: DIR < 0, diagonalSeam: true, solid: true });

    // Every placement in the maze draws from ONE pool, so two things can never
    // share a cell. takeCells() always consumes the same cells for the same
    // seed, so a reload that skips a spawn-once guard still lines up.
    const pool = cells.slice();

    // 46 hostiles (the original 62, scaled to the smaller maze): wolf 8, goblin 9,
    // boar 9, bear 12, slime_water 8 - none in the first stretch by the ford.
    const hostileSpots = takeCells(pool, 0.06, 1.0, 46, 11002);
    if (!api.getVar("hollowbrook_hostiles_spawned", false)) {
        api.setVar("hollowbrook_hostiles_spawned", true);
        const hostileTypes = [];
        [["wolf", 8], ["goblin", 9], ["boar", 9], ["bear", 12], ["slime_water", 8]].forEach(([type, n]) => {
            for (let k = 0; k < n; k++)
                hostileTypes.push(type);
        });
        hostileTypes.forEach((type, k) => api.spawnEnemy(type, hostileSpots[k].col, hostileSpots[k].row, 30));
    }

    // The order-of-three riddle-keepers Wren talks about - found roughly in the
    // order she names them, owl first, crystal last (see talkToRiddleKeeper).
    const owl = takeCells(pool, 0.10, 0.35, 1, 11003)[0];
    const elder = takeCells(pool, 0.40, 0.65, 1, 11004)[0];
    const echo = takeCells(pool, 0.70, 0.92, 1, 11005)[0];
    api.spawnNpc("bird_night_owl", owl.col, owl.row);
    api.spawnNpc("moon_spirit", elder.col, elder.row);
    api.spawnNpc("crystal_spirit", echo.col, echo.row);

    // A rare friendly pair in the maze - fox poses the small riddle early, deer
    // answers it a good stretch later.
    const fox = takeCells(pool, 0.12, 0.45, 1, 11006)[0];
    const deer = takeCells(pool, 0.60, 0.95, 1, 11007)[0];
    api.spawnNpc("fox", fox.col, fox.row);
    api.spawnNpc("deer", deer.col, deer.row);

    const hostage = takeCells(pool, 0.35, 0.75, 1, 11008)[0];
    if (!api.getVar("hostage_spawned", false)) {
        api.setVar("hostage_spawned", true);
        api.spawnNpc("farmhand_young", hostage.col, hostage.row);
    }

    const acorn = takeCells(pool, 0.93, 1.0, 1, 11009)[0];
    const loot = takeCells(pool, 0.05, 0.95, 13, 11010);
    if (api.getVar("hollowbrook_loot_spawned", false))
        return;
    api.setVar("hollowbrook_loot_spawned", true);
    api.spawnItem("glowing_acorn", acorn.col, acorn.row);
    ["gold_coin_pile", "rope_coil", "herb_bundle", "honey_jar", "mana_potion",
     "health_potion", "health_potion", "health_potion", "health_potion",
     "health_potion", "health_potion", "health_potion", "health_potion"].forEach((id, k) => api.spawnItem(id, loot[k].col, loot[k].row));
}

// ============================================================================
// Conversations
// ============================================================================
function* onTalkTo(name) {
    if (name === "herbalist") {
        yield* talkToWren();
    } else if (name === "baker" || name === "farmgirl" || name === "lumberjack" || name === "fisherman") {
        yield* talkToVillager(name);
    } else if (name === "bird_night_owl" || name === "moon_spirit" || name === "crystal_spirit") {
        yield* talkToRiddleKeeper(name);
    } else if (name === "farmhand_young") {
        yield* rescueHostage();
    } else if (name === "fox" || name === "deer") {
        yield* talkToWildKeeper(name);
    }
}

function* talkToWren() {
    const timesTalked = api.getVar("wren_talks", 0);
    api.setVar("wren_talks", timesTalked + 1);
    api.playSound("select");

    if (timesTalked === 0) {
        yield api.say("Wren", "There you are. Another five minutes and I was going to assume you'd slept through the actual apocalypse.");
        yield api.say("Lara", "The what, exactly?");
        yield api.say("Wren", "A low, steady hum, coming from past the river, out in the old maze. Started three nights ago and hasn't so much as paused for breath.");
        yield api.say("Wren", "Before you go charging off - old Fernhollow riddle, for luck: \"I listen before I ever speak, I remember what the listening finds, and only then do I answer.\" Three folk out there live that riddle, in that exact order. Find them if you want the luck. Skip it if you enjoy learning things the hard way.");
    } else if (timesTalked === 1) {
        yield api.say("Lara", "And you? Do you live by that riddle too?");
        yield api.say("Wren", "Me? I grow turnips and hope they don't ask too many questions back. The footbridge is at the end of the market road. Mind the maze - and whatever's out there humming with its mouth full.");
    } else {
        yield api.say("Wren", "Go on, then. Over the bridge, through the Thicket, past the stones, through the bramble, and straight at whatever's humming. Try not to hum back. It might take that as an invitation.");
        api.playSound("select");
    }
}

// A line or two from each neighbour, cycling - just enough to make the village
// feel lived in.
function* talkToVillager(name) {
    const lines = {
        baker: ["Bread's still warm. Say what you like about the end of the world, it hasn't touched my dough.",
                "Take a loaf. Nobody's ever gone into that maze hungry and come out in a good mood."],
        farmgirl: ["Three nights of that low note and the hens have unionized. No eggs until the humming stops.",
                   "Wren thinks it's something buried. I think it's something bored, cooped up, and looking for company."],
        lumberjack: ["I cut the Thicket back every spring. Every spring it holds a grudge a little longer.",
                     "There's a fox in there that asks riddles. Go on, laugh. I didn't believe it either, right up until it out-riddled me."],
        fisherman: ["River's gone glassy since the humming started. Fish still bite, mind you. They just seem to apologize first.",
                    "That footbridge is older than the village itself. Nobody remembers who built it, and nobody's ever fallen off - which, frankly, is the more suspicious fact."],
    }[name];
    const displayName = { baker: "Baker", farmgirl: "Farmgirl", lumberjack: "Lumberjack", fisherman: "Fisherman" }[name];
    const n = api.getVar("talk_" + name, 0);
    api.setVar("talk_" + name, n + 1);
    api.playSound("select");
    yield api.say(displayName, lines[n % lines.length]);
}

// Order-of-three riddle: bird_night_owl (listens) -> moon_spirit
// (remembers) -> crystal_spirit (answers). Talking out of order resets the
// step with an in-fiction hint, never a hard fail - same soft-fail style
// this project already uses for order puzzles.
function* talkToRiddleKeeper(name) {
    const order = ["bird_night_owl", "moon_spirit", "crystal_spirit"];
    const displayName = { bird_night_owl: "Owl", moon_spirit: "Elder", crystal_spirit: "Echo" }[name];
    const step = api.getVar("riddle_step", 0);
    api.playSound("select");

    if (api.getVar("riddle_solved", false)) {
        yield api.say(displayName, "*nods, smug, already answered*");
        return;
    }

    if (order[step] === name) {
        const newStep = step + 1;
        api.setVar("riddle_step", newStep);
        if (newStep === 1)
            yield api.say("Owl", "*blinks slowly, listening* Go on, then. I'm listening. It's sort of my whole thing.");
        else if (newStep === 2)
            yield api.say("Elder", "I remember it all. I've been remembering things since before this village had a name it liked. Now someone just has to answer.");
        else {
            yield api.say("Echo", "*a small crystalline chime* Congratulations. The answer was never a word - it was you, wandering around in the correct order by pure luck.");
            yield api.say("Lara", "Listen, remember, answer. That's the whole trick. I feel slightly cheated and mostly relieved.");
            api.setVar("riddle_solved", true);
            api.giveExperience(80);
            api.playSound("select");
        }
    } else {
        api.setVar("riddle_step", 0);
        yield api.say(displayName, "*taps a claw, unimpressed* Wrong order. Try again, and maybe try listening first this time.");
    }
}

// A second, smaller riddle, hidden inside the maze itself rather than the
// village - a two-step call-and-response, not another order-of-three. Fox poses
// it early on; Deer only answers once found a good stretch later.
function* talkToWildKeeper(name) {
    const order = ["fox", "deer"];
    const displayName = { fox: "Fox", deer: "Deer" }[name];
    const step = api.getVar("wildRiddle_step", 0);
    api.playSound("select");

    if (api.getVar("wildRiddle_solved", false)) {
        yield api.say(displayName, "*watches you pass, deeply unbothered*");
        return;
    }

    if (order[step] === name) {
        const newStep = step + 1;
        api.setVar("wildRiddle_step", newStep);
        if (newStep === 1)
            yield api.say("Fox", "*tilts its head, insufferably pleased with itself* Riddle me this: what grows thicker every time you cut a bit away from it?");
        else {
            yield api.say("Deer", "*doesn't flinch* A path. Worn in by feet, not by anybody's pruning shears. Fox already knows this. Fox just enjoys watching people think.");
            api.setVar("wildRiddle_solved", true);
            api.giveExperience(50);
            api.playSound("select");
        }
    } else {
        yield api.say(displayName, "*just watches, clearly waiting for the other one to go first*");
    }
}

function* rescueHostage() {
    if (api.getVar("hostage_rescued", false)) {
        yield api.say("Farmhand", "Thank you. Again. Truly. I mean it every single time, I promise.");
        return;
    }
    api.setVar("hostage_rescued", true);
    api.playSound("select");
    yield api.say("Farmhand", "You- you're not one of them! Oh, thank every root, twig, and mildly suspicious mushroom in this wood.");
    yield api.say("Lara", "Are you hurt, or just extremely dramatic?");
    yield api.say("Farmhand", "Scared more than hurt. I chased a goat too far past the river, and the goat, frankly, won. Please, just get me back toward the village road.");
    yield api.say("Lara", "Footbridge's back the way you came, then the market road. Go carefully, and maybe let the goat win next time.");
    api.giveExperience(100);
}

function* onEnemyDefeated(name) {
    // A flavor line for a few enemy archetypes - deliberately rare (not once per
    // matching kill, which reads as spammy once several in a row have died the
    // same way) via a flat low-probability roll first. Plain Math.random() on
    // purpose, unlike the seeded mulberry32() the generators use: that
    // determinism is for level LAYOUT, which doesn't apply to a cosmetic quip.
    if (Math.random() > 0.1)
        return;

    if (name === "wolf") {
        yield api.wait(0.3);
        yield api.say("Lara", "Sorry, old thing. Wrong place, wrong century, wrong hero.");
    } else if (name === "goblin") {
        yield api.wait(0.3);
        yield api.say("Lara", "Scavenger, not a soldier. There's easier pickings somewhere that isn't currently full of me.");
    } else if (name === "slime_water") {
        yield api.wait(0.3);
        yield api.say("Lara", "That water did NOT used to do that. Wren undersold this. Considerably.");
    }
}

function* onItemCollected(itemId) {
    if (itemId !== "glowing_acorn")
        return;

    yield api.wait(0.3);
    yield api.say("Lara", "...Huh.");
    yield api.say("Lara", "It's warm. And it's humming - not an echo of whatever Wren heard. The actual note, right here, sitting smugly in my hand.");
    yield api.say("???", "Now you understand why nobody in Fernhollow says that word out loud. 'Just the wind' gets a lot less convincing once the wind starts talking back.");
    yield api.say("Lara", "Okay. Who, exactly, is 'there'?");
    yield api.say("???", "Someone who found one of those a long, long time ago, and is still working out what it actually means. Follow the hum, Lara. It only gets louder from here. Bring snacks.");

    api.setGlobalVar("chapter", 2);
    api.playSound("select");
    yield api.wait(0.8);
    yield api.say("Lara", "East, then. Past Fernhollow, toward wherever this thing actually came from. Wonderful. Cannot wait.");
    api.loadLevel("chapter2.json");
}
