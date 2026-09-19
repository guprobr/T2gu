// ============================================================================
// ShadowShine - Chapter 24: "The Inquest"
// ============================================================================
//
// Two parts: the TOWN comes first, the MAZE after it. This level runs left to right
// (the hero spawns against the west edge). Map: 172x96, tileset haunted_grass_cobble, lighting torch.
//   - town   cols 1-46
//   - maze   cols 47-160, rows 0-95, corridors 2 wide, walls 3 thick
//   - pocket cols 161-170 (where the maze lets out)
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
const W = 172, H = 96;
const DIR = 1;                        // 1: this level runs left -> right
const START_U = 3;                        // the hero spawns this many columns in from the start edge
const MID = 45;                        // row of the road that leads to the maze gate
const TOWN_U = 46;                        // the town fills u = 1..TOWN_U (u counts from the start edge)
const MAZE_WEST = 47, MAZE_EAST = 160;   // absolute columns of the maze block
const MAZE_NORTH = 0, MAZE_SOUTH = 95;        // its rows
const MAZE_CORRIDOR = 2, MAZE_WALL = 3;
const POCKET_U0 = 161, POCKET_U1 = 170;   // the exit pocket beyond the maze (u), 10 columns

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
// Chapter 24 - "The Inquest" (haunted_grass_cobble, torch). Runs LEFT to RIGHT. A
// cobbled court-town lit by torches at the edge of a churchyard, then the
// Assize Yard - a maze of gravestones and half-fallen court walls.
//
// QUEST (a deduction): the clapper of the chapel bell has been stolen, so the bell
// cannot ring for dawn. The Magistrate gives the hero a warrant and the rules of
// the court: exactly one of three suspects is the thief; the thief always lies
// and the innocent always tell the truth. Each suspect stands somewhere in the
// Assize Yard and makes one statement. From the three statements exactly one
// person can be the thief - Reaper Grimm (brute-forced over all three possible
// thieves when the puzzle was written: every other reading needs two liars).
// To accuse, hear the suspect out, then talk to them WITH the warrant - and talk
// to them a second time to confirm, so a stray key press never accuses anyone.
// The thief confesses and the court gate opens; an innocent takes offence and
// becomes hostile (the warrant is not spent). A wrong accusation costs a fight,
// never the run.
//
//   Maud  (baker):        "It wasn't me, and it wasn't the Woodward."
//   Hale  (lumberjack_2): "I was with Maud the whole night."
//   Grimm (farmer_reaper):"The Woodward is the thief."
// ----------------------------------------------------------------------------
const TOWN = [
    ["gravestone_cluster", 4, -28],
    ["broken_fence", 4, -23],
    ["haunted_signpost", 4, -18],
    ["rocks_small", 5, 37],
    ["bench", 5, 47],
    ["bench", 6, 9],
    ["fence_straight", 7, -32],
    ["gravestone_cluster", 7, -22],
    ["broken_fence", 7, 26],
    ["oak_tree", 9, -31],
    ["oak_tree", 9, 26],
    ["gravestone_cluster", 9, 33],
    ["dead_tree", 10, 41],
    ["bush", 11, -32],
    ["bush", 11, 35],
    ["castle_gate_tower", 13, 43],
    ["cottage_b", 14, 33],
    ["rocks_small", 14, 35],
    ["oak_tree", 15, -25],
    ["stone_fireplace", 15, -20],
    ["market_stall", 15, 22],
    ["haunted_signpost", 18, -18],
    ["haunted_cottage", 18, 37],
    ["cottage_b", 19, -21],
    ["cottage_a", 19, -8],
    ["bench", 19, 3],
    ["gravestone_cluster", 19, 18],
    ["courtyard_well", 23, -4],
    ["notice_board", 27, -3],
    ["gravestone_cluster", 27, 3],
    ["fence_straight", 28, -35],
    ["cottage_a", 28, -16],
    ["haunted_signpost", 28, 29],
    ["bush", 28, 35],
    ["haunted_signpost", 29, -31],
    ["bench", 29, -11],
    ["broken_fence", 30, -38],
    ["rocks_small", 30, -29],
    ["gravestone_cluster", 31, -23],
    ["fence_straight", 31, 30],
    ["ruined_chapel", 32, -19],
    ["gravestone_cluster", 32, 24],
    ["dead_tree", 33, -33],
    ["chapel", 33, 37],
    ["rain_barrel", 34, -31],
    ["rain_barrel", 34, -27],
    ["rain_barrel", 35, 25],
    ["fence_straight", 36, -5],
    ["bush", 36, 22],
    ["dead_tree", 38, -43],
    ["dead_tree", 38, -23],
    ["oak_tree", 38, 40],
    ["fence_straight", 39, -7],
    ["broken_fence", 39, 8],
    ["rain_barrel", 40, -24],
    ["bench", 40, 36],
    ["oak_tree", 41, -38],
    ["standing_torch_sconce", 41, -3],
    ["cottage_a", 42, 8],
    ["bush", 42, 13],
    ["rain_barrel", 43, -40],
    ["cart", 43, 15],
    ["rocks_small", 43, 32],
    ["bench", 43, 41]
];
const THIEF = "farmer_reaper";
// suspect NPC -> [display name, statement, the line that goes with it]
const SUSPECTS = {
    baker: ["Maud", "It wasn't me, and it wasn't the Woodward. That is all I can tell you, and it is all that is true.", "I was up before the bell should have rung, kneading. I'd have heard anyone."],
    lumberjack_2: ["Hale", "I was with Maud the whole night, from the last toll to the dawn. Ask her, if you like.", "I don't sleep well since the hum stopped. I sit up with people. It helps."],
    farmer_reaper: ["Grimm", "The Woodward is the thief. I saw the sack under his arm, plain as the gallows.", "Oh, I'm not saying it lightly. I've known Hale for years."],
};
let suspectSpots = {};   // suspect key -> its cell (set by buildMaze), so a wrongly accused one turns hostile where they stood

function* onLevelStart() {
    api.spawnCharacter("lara_cyber", colAt(START_U), MID);
    api.giveControl("lara_cyber");
    respawnCompanions();

    buildTown();
    const exitRows = buildMaze();
    buildPocket();
    if (!api.getVar("thief_caught", false))
        setExitGate("court_gate", exitRows, true);

    if (api.getVar("chapter24_intro_seen", false))
        return;
    api.setVar("chapter24_intro_seen", true);

    yield api.wait(0.6);
    yield api.say("Lara", "A court in the open air, under torchlight, with a bench of gravestones. Everyone in the square is talking in the quiet, careful way people do when someone among them has done something they don't want to name.");
    yield* companionSays("vigil_recruited", "Vigil", "A theft in a small place is worse than a murder in a large one. Everyone here is somebody's neighbour.");
    yield* companionSays("cobb_recruited", "Cobb", "I'd say clap the lot of them in irons. Then I'd feel bad about it. Then I'd bring them cake.");
    yield api.say("Hint", "This level runs left to right. The town is behind you; the Assize Yard is ahead, to the east.");
}

function buildTown() {
    placeProps(TOWN);
    api.spawnProp("signpost", colAt(TOWN_U - 1), MID - 3);
    api.spawnProp("standing_torch_sconce", colAt(TOWN_U), MID + 4);

    api.spawnNpc("tribal_elder_woman", colAt(14), MID - 3);     // Magistrate Oona
    api.spawnNpc("innkeeper", colAt(24), MID + 5);              // the Landlord
    api.spawnNpc("gnome_wizard", colAt(10), MID + 6);           // the Court Clerk
    api.spawnNpc("angler", colAt(30), MID - 5);                 // Netter, a witness

    if (api.getVar("town_loot_spawned", false))
        return;
    api.setVar("town_loot_spawned", true);
    api.spawnItem("health_potion", colAt(6), MID - 9);
    api.spawnItem("bread_loaf", colAt(28), MID + 11);
    api.spawnItem("antidote_vial", colAt(34), MID - 12);
    api.spawnItem("health_potion", colAt(13), MID + 14);
}

function buildMaze() {
    const core = ["haunted_cottage", "gravestone_cluster", "ruined_chapel", "charred_tree", "dead_twisted_tree", "burnt_cottage_ruin"];
    const edge = ["burnt_stump", "rocks_small", "haunted_signpost", "dead_tree", "broken_fence"];
    const cells = buildBranchingMaze(MAZE_WEST, MAZE_EAST, MAZE_NORTH, MAZE_SOUTH, MAZE_CORRIDOR, MAZE_WALL,
        core, edge, 242401, { flip: DIR < 0, diagonalSeam: true, solid: true });
    const pool = cells.slice();

    // One suspect per stretch of the Yard.
    const bands = [[0.12, 0.30], [0.42, 0.60], [0.72, 0.90]];
    suspectSpots = {};
    Object.keys(SUSPECTS).forEach((key, k) => {
        const cell = takeCells(pool, bands[k][0], bands[k][1], 1, 242402 + k)[0];
        suspectSpots[key] = cell;
        api.spawnNpc(key, cell.col, cell.row);
    });

    spawnPacks(takeCells(pool, 0.06, 1.0, 34, 242406),
        [["ghoul", 8, 35], ["skeleton_swordsman", 8, 35], ["wraith", 6, 45], ["zombie_peasant", 8, 30], ["vampire", 4, 60]],
        "maze_hostiles_spawned");

    spawnLoot(takeCells(pool, 0.05, 0.95, 11, 242410),
        ["health_potion", "health_potion", "health_potion", "health_potion", "health_potion", "health_potion",
         "mana_potion", "antidote_vial", "elixir_of_clarity", "stamina_draught", "reinforced_boots"], "maze_loot_spawned");
    return cells.exitRows;
}

function buildPocket() {
    const [c0, c1] = pocketCols();
    scatterOrganic(["gravestone_cluster", "moss_grown_altar", "dead_twisted_tree", "burnt_stump"], c0, c1, MAZE_NORTH + 2, MAZE_SOUTH - 2, 8, 242420,
        [{ col: colAt(POCKET_U0 + 5), row: MID }]);
    if (!api.getVar("clapper_spawned", false)) {
        api.setVar("clapper_spawned", true);
        api.spawnItem("chapel_clapper", colAt(POCKET_U0 + 5), MID);
    }
}

function* onTalkTo(name) {
    if (name === "tribal_elder_woman") {
        yield* talkToMagistrate();
    } else if (SUSPECTS[name]) {
        yield* talkToSuspect(name);
    } else if (name === "innkeeper" || name === "gnome_wizard" || name === "angler") {
        yield* talkToTownsfolk(name);
    }
}

function* talkToMagistrate() {
    api.playSound("select");
    if (api.getVar("thief_caught", false)) {
        yield api.say("Magistrate Oona", "The court is adjourned and the bell will ring. I did not enjoy that. I was very good at it, and I did not enjoy it.");
        return;
    }
    if (!api.getVar("warrant_given", false)) {
        api.setVar("warrant_given", true);
        api.giveItem("magistrates_warrant", 1);
        yield api.say("Magistrate Oona", "The clapper of the chapel bell was stolen three nights ago. Without it the bell will not ring at dawn, and a village that cannot ring its dawn is a village that begins to doubt it has one.");
        yield api.say("Magistrate Oona", "Three people were in the yard that night: Maud the baker, Hale the Woodward, and Grimm the reaper. They are out in the Assize Yard, east of here, each in a different stretch of it. Each will make one statement.");
        yield api.say("Magistrate Oona", "Here is the law of my court, and you will need it. Exactly ONE of the three is the thief. The thief ALWAYS lies. The innocent ALWAYS tell the truth. Hear all three, and only one answer will stand.");
        yield api.say("Magistrate Oona", "Take this warrant. Give it to the thief by speaking to them while you hold it. Give it to anyone else, and they will take offence, as innocent people should. It will not be spent - but you will have a fight on your hands.");
    } else {
        yield api.say("Magistrate Oona", "Three suspects, three statements. The thief always lies, the innocent never do, and exactly one is the thief. Hear them all before you speak the warrant.");
    }
}

function* talkToSuspect(name) {
    const [who, statement, aside] = SUSPECTS[name];
    api.playSound("select");
    const hasWarrant = api.hasItem("magistrates_warrant");
    if (hasWarrant && api.getVar("heard_" + name, false)) {
        // An accusation - only once the suspect's own statement has been heard, and only on a confirming second talk.
        if (api.getVar("accuse_pending", "") !== name) {
            api.setVar("accuse_pending", name);
            yield api.say(who, "*sees the warrant in your hand and goes still* ...You mean to name me. Speak to me again if you are sure. I have said what I said.");
            return;
        }
        api.setVar("accuse_pending", "");
        if (name === THIEF) {
            api.removeItem("magistrates_warrant", 1);
            api.setVar("thief_caught", true);
            api.setBarrier("court_gate", 0, 0, 1, 1, false);
            api.giveExperience(150);
            yield api.say(who, "*a long, ugly silence, and then the reaper's shoulders drop* ...The Woodward. Yes. I said the Woodward, and I was looking at my own hands the whole time.");
            yield api.say(who, "I couldn't stand the quiet. The bell used to ring the harvest in, and when the hum stopped I wanted it to ring for me, one more time. I took the clapper. It's in the chapel yard, beyond the far gate. I never meant to keep it.");
            yield api.say("Lara", "You lied, and that's how I knew. The only person who could name the Woodward the thief and be lying was the thief.");
            yield api.say(who, "Take me to the Magistrate, then. And the gate is open. I unlocked it myself the night I hid it. I'd have unlocked the bell, if I could.");
            yield* companionSays("vigil_recruited", "Vigil", "There is no cruelty in this. Just a man who wanted to hear something ring. I would like to remember him that way.");
        } else {
            yield* wrongAccusation(name, who);
        }
        return;
    }
    api.setVar("heard_" + name, true);
    api.setVar("accuse_pending", "");
    const n = api.getVar("suspect_talks_" + name, 0);
    api.setVar("suspect_talks_" + name, n + 1);
    if (n === 0) {
        yield api.say(who, aside);
        yield api.say(who, statement);
    } else {
        yield api.say(who, statement);
        if (hasWarrant)
            yield api.say(who, "You're holding that warrant like you have someone in mind. If it's me, be very sure. I've said what I said.");
    }
}

// An innocent accused: they despawn as an NPC and come back at you where they stood.
function* wrongAccusation(name, who) {
    const cell = suspectSpots[name];
    api.despawnNpc(name);
    yield api.say(who, "*goes very still* Me? After I told you the truth? That is a poor way to thank a person. You will take that back - and if you won't, I'll help you.");
    api.spawnEnemy(name, cell.col, cell.row, 40);
    api.setVar("wrongly_accused_" + name, true);
    api.setGlobalVar("inquest_wrong", api.getGlobalVar("inquest_wrong", 0) + 1);   // read back by chapter 25
}

function* talkToTownsfolk(name) {
    const lines = {
        innkeeper: ["I've poured for all three of them at one time or another. If you want my opinion - and nobody has asked - it is that the guilty one is the one who gets angriest when you look at them.",
                    "Whoever did it, they left a clean cut on the bell rope. Not a struggle. It's the quietest theft I ever heard of."],
        gnome_wizard: ["The Magistrate's rule is old and strange, but it works: the guilty lie, the innocent do not. You need only three statements and a little patience.",
                       "I have recorded each of the three statements as they were given. I should not say what they were. It would spoil the arithmetic."],
        angler: ["I was on the river that night and saw nothing, and I have decided that seeing nothing is a form of testimony.",
                 "Grimm has never once looked me in the eye. I put it down to shyness. I am now rethinking the last ten years."],
    }[name];
    const displayName = { innkeeper: "Landlord", gnome_wizard: "Clerk", angler: "Netter" }[name];
    const n = api.getVar("talk_" + name, 0);
    api.setVar("talk_" + name, n + 1);
    yield api.say(displayName, lines[n % lines.length]);
}

function* onEnemyDefeated(name) {
    if (SUSPECTS[name] && api.getVar("wrongly_accused_" + name, false)) {
        yield api.wait(0.3);
        yield api.say("Lara", "That was not the thief. I have made a bad mistake, and I will carry it up the hill with me. The next time I hold a warrant I will count to three first.");
        return;
    }
    if (Math.random() > 0.1)
        return;
    if (name === "wraith") {
        yield api.wait(0.3);
        yield api.say("Lara", "The Assize Yard has its own witnesses. They don't testify. They just stand.");
    } else if (name === "vampire") {
        yield api.wait(0.3);
        yield api.say("Lara", "It was in the gallery, I think, taking notes. Bad ones.");
    }
}

function* onItemCollected(itemId) {
    if (itemId !== "chapel_clapper")
        return;
    yield api.wait(0.3);
    yield api.say("Lara", "It's small and heavy and cold, and it rings at nothing, very softly, like a bell that remembers what it is for.");
    yield api.say("???", "Eighth of nine. You found the thief by listening to what they said and to what they couldn't. It's the only trick, in the end. Most people forget that lying is louder than the truth.");
    yield api.say("Lara", "The next one is the last, isn't it? The ninth.");
    yield api.say("???", "The ninth. It's a door, Lara - the second one. And I'd very much like to be standing on the other side of it when you get there.");
    api.setGlobalVar("chapter", 25);
    api.playSound("select");
    yield api.wait(0.8);
    api.loadLevel("chapter25.json");
}
