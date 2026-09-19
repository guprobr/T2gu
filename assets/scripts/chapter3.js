// ============================================================================
// ShadowShine - Chapter 3: "The Hollow Under" (v2 remodel, 2026-09-10)
// ============================================================================
//
// Map tripled in each dimension (168x96, was 56x32). A third distinct
// shape (not Chapter 1's segments, not Chapter 2's fork): ONE single huge
// cave labyrinth, with hostiles, the three riddle-keepers, and the
// hostage all placed directly inside known-open corridor cells of that
// one maze - a genuinely populated dungeon crawl, not a maze-then-rest-
// area rhythm. Introduces Cobb (dwarf_miner).
//
// Corridor coordinates below were computed from buildSnakingMaze's own
// band pattern (corridor bands start at row = northRow + 3*k for
// corridorSize=2/wallSize=1) rather than guessed - see the verification
// note in project memory for how this was confirmed, not assumed.
//
// Map layout (assets/maps/chapter3.json):
//   - Entry chamber: cols 2-28
//   - The Hollow (one huge maze): cols 30-155, full playable height
//   - End alcove: cols 157-166
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
// one unique corridor) - replaces the old buildCurvingMaze, which was a
// single winding path through an otherwise-solid zone: curvier than the
// original straight bands, but still "mostly solid, one pathway."
//
// Each cell is a corridorWidth x corridorWidth open block; cells are laid
// out on a cellSize = corridorWidth + wallWidth grid, with the gap between
// two adjacent cells either carved open (a passage) or left solid (a wall
// block).
//
// Every non-open tile is filled via `spawnProp`, split into two roles:
// `coreObstacles` (the bigger, more distinctive set-piece props) fill each
// wall block's *interior* - tiles with no open neighbor - one type per
// whole block, so the mass still reads as a deliberate, coherent cluster
// (a run of rocks here, a run of bushes there), not a tile-by-tile grab-
// bag. `edgeObstacles` (smaller, rougher-looking props) fill the *seam*
// tiles - anywhere a wall tile actually touches an open corridor tile -
// each rolled independently, so the boundary itself reads as an irregular,
// rough edge instead of one straight geometric line, while the underlying
// open/wall grid ("the lines") is completely unchanged either way.
//
// Entrance/exit are simply openings through the west/east perimeter
// columns at one cell's row range each - every other perimeter row stays
// walled, same principle as every earlier maze generator in this project.
// Returns `cellCenters` (the open midpoint of every cell, including cells
// off the spanning tree's direct route) so callers can place NPCs/enemies
// on verified-open ground via sampleCells() below, instead of hand-
// computing coordinates.
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
// name in turn - the old per-point round-robin put a different prop type
// on almost every tile, which read as a random grab-bag rather than
// coherent groups. Clump centers are sampled within the ELLIPSE inscribed
// in [colStart,colEnd]x[rowStart,rowEnd] (keeping the four corners empty,
// a rounded/organic footprint rather than a filled square); each clump
// then jitters its own props tightly around its center. `seed` keeps it
// deterministic and call-site-specific. `avoid` is an optional list of
// {col,row} points (hand-placed NPCs/enemies/items sharing the same zone)
// to steer clear of.
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

function respawnCompanions() {
    if (api.getGlobalVar("vigil_recruited", false))
        api.spawnCharacter("dark_knight", 4, 44, 70);
    if (api.getGlobalVar("cobb_recruited", false))
        api.spawnCharacter("dwarf_miner", 5, 44, 75);
}

function* onLevelStart() {
    api.spawnCharacter("lara_cyber", 3, 47);
    api.giveControl("lara_cyber");
    respawnCompanions();

    buildEntryChamber();
    buildTheHollow();
    buildEndAlcove();

    if (api.getVar("chapter3_intro_seen", false))
        return;
    api.setVar("chapter3_intro_seen", true);

    yield api.wait(0.5);
    yield api.say("Vigil", "The court's floor stopped here too, once. Whatever's under it isn't mine to guard anymore - that duty's yours now.");
    yield api.say("Lara", "Then let's find someone who can.");
}

function buildEntryChamber() {
    api.spawnProp("support_beam", 6, 20);
    api.spawnProp("mine_cart", 20, 60);
    api.spawnProp("cave_torch_sconce", 4, 47);
    api.spawnProp("cave_torch_sconce", 24, 47);
    scatterOrganic(["rocks_small", "boulder_large", "underground_fungus_growth"], 3, 27, 4, 92, 41, 30001, [
        { col: 6, row: 20 }, { col: 20, row: 60 }, { col: 4, row: 47 }, { col: 24, row: 47 },
        { col: 10, row: 47 }, { col: 6, row: 30 }, { col: 22, row: 30 }, { col: 20, row: 20 },
    ]);

    // Only while he's still an NPC, not yet recruited - see chapter2.js's
    // identical guard on dark_knight for why: onLevelStart can run
    // again for this chapter, and respawnCompanions() above already re-
    // materializes him as a companion once cobb_recruited is true.
    if (!api.getGlobalVar("cobb_recruited", false))
        api.spawnNpc("dwarf_miner", 10, 47);
    // A rare friendly face right at the entrance - the first half of a
    // small two-step riddle that pays off far away, at the End Alcove.
    api.spawnNpc("dwarf_bomber", 20, 20);

    if (api.getVar("chapter3_loot_spawned", false))
        return;
    api.setVar("chapter3_loot_spawned", true);
    api.spawnItem("dried_rations", 6, 30);
    api.spawnItem("handheld_torch", 22, 30);
    api.spawnItem("health_potion", 10, 30);
}

// The Hollow - one enormous branching cave labyrinth (cols 30-155, full
// playable height, see buildBranchingMaze). Hostiles, the three riddle-
// keepers, and the hostage all sit on the maze's own open cells -
// "populate the maze," taken literally, plus "rarely" a friendly face or a
// hostage among them. Bigger cave set-pieces (stalagmites, rubble, support
// beams, stalactite clusters) fill each wall cluster's interior; small
// rough-edged debris fills the seam wherever a wall meets a corridor.
function buildTheHollow() {
    const coreObstacles = ["stalagmite_formation", "cave_in_rubble", "boulder_large", "support_beam", "stalactite_cluster"];
    const edgeObstacles = ["rocks_small", "crate_stack_cat", "wooden_chest", "cave_torch_sconce"];
    const cells = buildBranchingMaze(30, 155, 1, 94, 2, 4, coreObstacles, edgeObstacles, 31001, { solid: true });

    // One shared, non-overlapping cell set (64 hostiles - double the
    // original 32 - + 3 riddle-keepers + the hostage + 13 loot items - 8
    // health potions (tripled from the original 2, per-level healing
    // supply pass), 2 general trinkets, and 3 originals = 81 cells) -
    // sampling without replacement from a single call guarantees distinct
    // spots, no matter how dense.
    const spots = sampleCells(cells, 81, 31002);
    if (!api.getVar("hollow_hostiles_spawned", false)) {
        api.setVar("hollow_hostiles_spawned", true);
        // Exactly the original mix (skeleton x2, skeleton_archer x1, orc x2,
        // troll x1, mummy x1, skeleton_swordsman x1), repeated 8x (double
        // the original 4x) - "for every maze creature, four times more,
        // twice over."
        const oneShare = ["skeleton", "skeleton_archer", "orc", "troll", "mummy", "skeleton_swordsman", "skeleton", "orc"];
        const hostileTypes = [].concat(oneShare, oneShare, oneShare, oneShare, oneShare, oneShare, oneShare, oneShare);
        hostileTypes.forEach((type, i) => api.spawnEnemy(type, spots[i].col, spots[i].row, 35));
    }

    // Order-of-three riddle-keepers, spaced deep along the same corridor -
    // gnome_alchemist (mixes) -> earth_spirit (settles) -> tribal_elder_woman
    // (remembers).
    api.spawnNpc("gnome_alchemist", spots[64].col, spots[64].row);
    api.spawnNpc("earth_spirit", spots[65].col, spots[65].row);
    api.spawnNpc("tribal_elder_woman", spots[66].col, spots[66].row);

    if (!api.getVar("hostage_spawned", false)) {
        api.setVar("hostage_spawned", true);
        api.spawnNpc("miner", spots[67].col, spots[67].row);
    }

    if (api.getVar("hollow_loot_spawned", false))
        return;
    api.setVar("hollow_loot_spawned", true);
    api.spawnItem("ore_chunk", spots[68].col, spots[68].row);
    api.spawnItem("iron_sword", spots[69].col, spots[69].row);
    api.spawnItem("antidote_vial", spots[70].col, spots[70].row);
    api.spawnItem("health_potion", spots[71].col, spots[71].row);
    api.spawnItem("health_potion", spots[72].col, spots[72].row);
    api.spawnItem("repair_kit", spots[73].col, spots[73].row);
    api.spawnItem("gemstone_cluster", spots[74].col, spots[74].row);
    api.spawnItem("health_potion", spots[75].col, spots[75].row);
    api.spawnItem("health_potion", spots[76].col, spots[76].row);
    api.spawnItem("health_potion", spots[77].col, spots[77].row);
    api.spawnItem("health_potion", spots[78].col, spots[78].row);
    api.spawnItem("health_potion", spots[79].col, spots[79].row);
    api.spawnItem("health_potion", spots[80].col, spots[80].row);
}

function buildEndAlcove() {
    api.spawnProp("glowing_crystal_cluster", 160, 20);
    api.spawnProp("underground_pool", 162, 60);
    scatterOrganic(["stalactite_cluster", "rocks_small"], 157, 165, 6, 90, 16, 30002, [
        { col: 160, row: 20 }, { col: 162, row: 60 }, { col: 161, row: 45 }, { col: 163, row: 70 },
    ]);

    if (!api.getVar("alcove_hostile_spawned", false)) {
        api.setVar("alcove_hostile_spawned", true);
        api.spawnEnemy("skeleton_archer", 161, 45, 30);
    }
    // The second half of the dwarf-bomber's riddle, set up back at the
    // entry chamber.
    api.spawnNpc("blacksmith_2", 163, 70);

    if (api.getVar("alcove_loot_spawned", false))
        return;
    api.setVar("alcove_loot_spawned", true);
    api.spawnItem("gemstone_cluster", 159, 40);
    api.spawnItem("round_shield", 163, 75);
    api.spawnItem("deepstone_ember", 164, 25);
}

function* onTalkTo(name) {
    if (name === "dwarf_miner") {
        yield* talkToCobb();
    } else if (name === "gnome_alchemist" || name === "earth_spirit" || name === "tribal_elder_woman") {
        yield* talkToRiddleKeeper(name);
    } else if (name === "miner") {
        yield* rescueHostage();
    } else if (name === "dwarf_bomber" || name === "blacksmith_2") {
        yield* talkToForgeKeeper(name);
    }
}

function* talkToCobb() {
    const timesTalked = api.getVar("cobb_talks", 0);
    api.setVar("cobb_talks", timesTalked + 1);
    api.playSound("select");

    if (timesTalked === 0) {
        yield api.say("Cobb", "Above ground trouble usually stays above ground. You two are the exception, then.");
        yield api.say("Lara", "We're following something. A hum.");
        yield api.say("Cobb", "Everyone down here's heard it for weeks. There's an old hollow past my claim nobody's dug in decades - three keepers of an old riddle live along the way in, if you can find them in the right order.");
    } else if (timesTalked === 1) {
        yield api.say("Vigil", "Why hasn't anyone gone in, if it's that close?");
        yield api.say("Cobb", "Because the ones who did came back saying it wasn't rock down there anymore. I'll take you as far as I know.");
    } else {
        yield api.say("Cobb", "All right. Lamp's lit, boots are laced. Let's see what stopped being rock.");
        api.despawnNpc("dwarf_miner");
        api.spawnCharacter("dwarf_miner", 10, 47, 75);
        api.setGlobalVar("cobb_recruited", true);
        api.playSound("select");
    }
}

// Order-of-three riddle: gnome_alchemist (mixes) -> earth_spirit (settles)
// -> tribal_elder_woman (remembers).
function* talkToRiddleKeeper(name) {
    const order = ["gnome_alchemist", "earth_spirit", "tribal_elder_woman"];
    const displayName = { gnome_alchemist: "Mix", earth_spirit: "Settle", tribal_elder_woman: "Remember" }[name];
    const step = api.getVar("riddle_step", 0);
    api.playSound("select");

    if (api.getVar("riddle_solved", false)) {
        yield api.say(displayName, "*nods, already answered*");
        return;
    }

    if (order[step] === name) {
        const newStep = step + 1;
        api.setVar("riddle_step", newStep);
        if (newStep === 1)
            yield api.say("Mix", "Everything down here starts as something else, mixed together until it isn't anymore.");
        else if (newStep === 2)
            yield api.say("Settle", "And then it settles. Stone doesn't rush. Go on - someone still has to remember what it used to be.");
        else {
            yield api.say("Remember", "And I remember. Mixed, settled, remembered - that's how stone becomes a story instead of just a wall.");
            api.setVar("riddle_solved", true);
            api.giveExperience(80);
            api.playSound("select");
        }
    } else {
        api.setVar("riddle_step", 0);
        yield api.say(displayName, "Not yet. Not in that order.");
    }
}

// A second, smaller riddle bookending the whole Hollow - a two-step call-
// and-response, not another order-of-three like Mix/Settle/Remember. The
// bomber poses it right at the entrance; the blacksmith only answers once
// found all the way at the End Alcove.
function* talkToForgeKeeper(name) {
    const order = ["dwarf_bomber", "blacksmith_2"];
    const displayName = { dwarf_bomber: "the Bomber", blacksmith_2: "the Blacksmith" }[name];
    const step = api.getVar("forgeRiddle_step", 0);
    api.playSound("select");

    if (api.getVar("forgeRiddle_solved", false)) {
        yield api.say(displayName, "*already answered*");
        return;
    }

    if (order[step] === name) {
        const newStep = step + 1;
        api.setVar("forgeRiddle_step", newStep);
        if (newStep === 1)
            yield api.say("Bomber", "Miner's riddle, older than his claim: what's stronger after it's broken than it ever was whole?");
        else {
            yield api.say("Blacksmith", "*doesn't look up from the forge* Anything I've welded back myself. Same answer every time you ask a smith that.");
            api.setVar("forgeRiddle_solved", true);
            api.giveExperience(50);
            api.playSound("select");
        }
    } else {
        yield api.say(displayName, "Not yet. The other one goes first.");
    }
}

function* rescueHostage() {
    if (api.getVar("hostage_rescued", false)) {
        yield api.say("Miner", "Still grateful, truly.");
        return;
    }
    api.setVar("hostage_rescued", true);
    api.playSound("select");
    yield api.say("Miner", "You cleared the guards? Bless you. I've been pinned in this stretch since yesterday.");
    yield api.say("Lara", "Are you hurt?");
    yield api.say("Miner", "Winded, mostly. There's a way out south of here, if the tunnel's still clear.");
    api.giveExperience(100);
}

function* onEnemyDefeated(name) {
    // A flavor line for a few enemy archetypes below - deliberately rare
    // (not once per matching kill, which reads as spammy once several in a
    // row have died the same way) via a flat low-probability roll before
    // even checking which archetype this is. Plain Math.random() on
    // purpose, unlike the seeded mulberry32() this file's own generators
    // use elsewhere - that determinism is for level LAYOUT reproducibility
    // (so a placement bug is catchable once and trusted forever), which
    // doesn't apply to a cosmetic post-kill quip.
    if (Math.random() > 0.1)
        return;

    if (name === "skeleton" || name === "skeleton_archer" || name === "skeleton_swordsman") {
        yield api.wait(0.3);
        yield api.say("Cobb", "Old bones. This claim's older than I ever gave it credit for.");
    } else if (name === "mummy") {
        yield api.wait(0.3);
        yield api.say("Lara", "Whatever kept that thing standing, it wasn't life. Something was just maintaining it.");
    } else if (name === "troll" || name === "orc") {
        yield api.wait(0.3);
        yield api.say("Cobb", "Not undead, that one - just mean, and lost, and a long way from wherever it came from.");
    }
}

function* onItemCollected(itemId) {
    if (itemId !== "deepstone_ember")
        return;

    yield api.wait(0.3);
    yield api.say("Lara", "It's warm, like the acorn and the seal both. Same warmth, three different shapes.");
    yield api.say("Cobb", "I've mined this whole hollow and never once found anything that glowed on its own. This isn't ore.");
    yield api.say("???", "No. It's memory, the same as the others. Stone remembers slower than wood does, but it remembers.");
    yield api.say("Vigil", "You could just answer her directly, you know.");
    yield api.say("???", "I could. Keep going - there's a line of old wire running under this stone that wants finding too.");

    api.setGlobalVar("chapter", 4);
    api.playSound("select");
    yield api.wait(0.8);
    api.loadLevel("chapter4.json");
}
