// ============================================================================
// ShadowShine - Chapter 5: "Ashfall" (v2 remodel, 2026-09-10)
// ============================================================================
//
// Map tripled in each dimension (174x96, was 58x32). Deliberately the most
// different shape of the six: NOT another big sealed maze. A modest single
// graveyard maze (Mourning Row) sits right at the entrance, then opens
// into one huge OPEN ruined district with no maze walls at all - named
// ruin clusters, wandering hostiles, riddle-keepers, and a hostage placed
// freely across open ground rather than threaded through corridor cells.
// Introduces Nettle (cyber_medic).
//
// Map layout (assets/maps/chapter5.json):
//   - The edge of Ashfall: cols 2-28
//   - Mourning Row (the one small maze): cols 30-70, full playable height
//   - The open burnt district: cols 72-172 (no maze - open ground)
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
    if (api.getGlobalVar("vex_recruited", false))
        api.spawnCharacter("cyber_engineer", 6, 44, 70);
    if (api.getGlobalVar("nettle_recruited", false))
        api.spawnCharacter("cyber_medic", 7, 44, 70);
}

function* onLevelStart() {
    api.spawnCharacter("lara_cyber", 3, 47);
    api.giveControl("lara_cyber");
    respawnCompanions();

    buildAshfallEdge();
    buildMourningRowMaze();

    if (api.getVar("chapter5_intro_seen", false))
        return;
    api.setVar("chapter5_intro_seen", true);

    yield api.wait(0.5);
    yield api.say("Vex", "This wasn't a fire that spread from a hearth. Everything's burned from the same direction.");
    yield api.say("Lara", "Careful. Whoever's left here has earned the right to be tired of visitors.");
}

// A small open entrance pocket, no maze - just Nettle and basic supplies.
// Everyone else (the riddle-keepers, the hostage, the wandering undead)
// now lives inside Mourning Row itself, below.
function buildAshfallEdge() {
    api.spawnProp("burnt_cottage_ruin", 6, 20);
    api.spawnProp("collapsed_well", 10, 60);
    scatterOrganic(["scorched_fence_remains", "gravestone_cluster"], 2, 15, 4, 92, 18, 50001, [
        { col: 6, row: 20 }, { col: 10, row: 60 }, { col: 10, row: 47 },
    ]);

    // Only while she's still an NPC, not yet recruited - see chapter2.js's
    // identical guard on dark_knight for why: onLevelStart can run
    // again for this chapter, and respawnCompanions() above already re-
    // materializes her as a companion once nettle_recruited is true.
    if (!api.getGlobalVar("nettle_recruited", false))
        api.spawnNpc("cyber_medic", 10, 47);

    if (api.getVar("chapter5_loot_spawned", false))
        return;
    api.setVar("chapter5_loot_spawned", true);
    api.spawnItem("cloth_bolt", 6, 30);
    api.spawnItem("dried_rations", 12, 30);
    api.spawnItem("health_potion", 6, 65);
}

// Mourning Row - the whole rest of the map (cols 17-172, full playable
// height) is now ONE genuine branching maze, not a small graveyard gate
// plus a separate wide-open ruined district. The district's four named
// ruin landmarks (the chapel, the market stall, the collapsed well, the
// burnt cottage) become the maze's bigger set-piece wall clusters instead
// of standalone decorations - still the same Ashfall look, just woven
// into the labyrinth itself rather than scattered past it. Small rough-
// edged graveyard debris fills the seam wherever a wall meets a corridor.
function buildMourningRowMaze() {
    const coreObstacles = ["burnt_cottage_ruin", "ruined_chapel", "destroyed_market_stall", "collapsed_well", "charred_tree", "wrecked_cart", "withered_well"];
    const edgeObstacles = ["gravestone_cluster", "broken_fence", "scorched_fence_remains", "fence_corner", "ash_covered_barrels"];
    const cells = buildBranchingMaze(17, 172, 1, 94, 2, 4, coreObstacles, edgeObstacles, 51001, { solid: true });

    // This tileset has no border ring (see GameScene::decorateMapEdges), so the map's top and
    // bottom rows would be a free corridor running around the whole maze. Seal them, the same
    // way a ring tileset's border tiles are sealed.
    api.setBarrier("mzedge_north", 0, 0, 174, 1, true);
    api.setBarrier("mzedge_south", 0, 95, 174, 1, true);

    // One shared, non-overlapping cell set for EVERYTHING placed in the
    // maze - 26 hostiles (double the old maze+district total of 13:
    // zombie_peasant x12, skeleton_swordsman x10, vampire x2, ghoul x2) +
    // the fire-spirit/reaper pair + 3 riddle-keepers + the hostage + 16
    // loot items (8 health potions - tripled from the original 2, per-
    // level healing supply pass - 2 general trinkets, and 6 originals
    // including the cinder_charm key item) = 48 cells.
    const spots = sampleCells(cells, 48, 51002);
    let i = 0;

    if (!api.getVar("mourningRow_hostiles_spawned", false)) {
        api.setVar("mourningRow_hostiles_spawned", true);
        const hostileTypes = [
            "zombie_peasant", "zombie_peasant", "zombie_peasant", "zombie_peasant", "zombie_peasant", "zombie_peasant",
            "zombie_peasant", "zombie_peasant", "zombie_peasant", "zombie_peasant", "zombie_peasant", "zombie_peasant",
            "skeleton_swordsman", "skeleton_swordsman", "skeleton_swordsman", "skeleton_swordsman", "skeleton_swordsman",
            "skeleton_swordsman", "skeleton_swordsman", "skeleton_swordsman", "skeleton_swordsman", "skeleton_swordsman",
            "vampire", "vampire", "ghoul", "ghoul",
        ];
        hostileTypes.forEach(type => { api.spawnEnemy(type, spots[i].col, spots[i].row, 30); i++; });
    } else {
        i += 26;
    }

    // Two rare friendly faces inside the maze itself - a small two-step
    // riddle. The fire-spirit poses it early; the farmer-reaper only
    // answers once found elsewhere in the maze.
    api.spawnNpc("fire_spirit", spots[i].col, spots[i].row); i++;
    api.spawnNpc("farmer_reaper", spots[i].col, spots[i].row); i++;

    // Order-of-three riddle: tribal_elder_woman (mourns) -> moon_spirit
    // (watches) -> love_spirit (forgives).
    api.spawnNpc("tribal_elder_woman", spots[i].col, spots[i].row); i++;
    api.spawnNpc("moon_spirit", spots[i].col, spots[i].row); i++;
    api.spawnNpc("love_spirit", spots[i].col, spots[i].row); i++;

    if (!api.getVar("hostage_spawned", false)) {
        api.setVar("hostage_spawned", true);
        api.spawnNpc("innkeeper", spots[i].col, spots[i].row);
    }
    i++;

    if (api.getVar("mourning_loot_spawned", false))
        return;
    api.setVar("mourning_loot_spawned", true);
    api.spawnItem("old_key", spots[i].col, spots[i].row); i++;
    api.spawnItem("sealed_scroll", spots[i].col, spots[i].row); i++;
    api.spawnItem("memory_locket", spots[i].col, spots[i].row); i++;
    api.spawnItem("stamina_draught", spots[i].col, spots[i].row); i++;
    api.spawnItem("elixir_of_clarity", spots[i].col, spots[i].row); i++;
    api.spawnItem("cinder_charm", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("antidote_vial", spots[i].col, spots[i].row); i++;
    api.spawnItem("ancient_coin", spots[i].col, spots[i].row); i++;
}

function* onTalkTo(name) {
    if (name === "cyber_medic") {
        yield* talkToNettle();
    } else if (name === "tribal_elder_woman" || name === "moon_spirit" || name === "love_spirit") {
        yield* talkToRiddleKeeper(name);
    } else if (name === "innkeeper") {
        yield* rescueHostage();
    } else if (name === "fire_spirit" || name === "farmer_reaper") {
        yield* talkToEmberKeeper(name);
    }
}

function* talkToNettle() {
    const timesTalked = api.getVar("nettle_talks", 0);
    api.setVar("nettle_talks", timesTalked + 1);
    api.playSound("select");

    if (timesTalked === 0) {
        yield api.say("Nettle", "If you're here for looting, there's nothing left. If you're here for anything else, I'm listening.");
        yield api.say("Lara", "We're following something. It led us here.");
        yield api.say("Nettle", "Of course it did. There are three people scattered through the ruins who each mourn, watch, and forgive in their own way - talk to them in that order and it seems to mean something.");
    } else if (timesTalked === 1) {
        yield api.say("Vigil", "What happened here?");
        yield api.say("Nettle", "Something came through fast and left just as fast. The dead here don't lie down easy.");
    } else {
        yield api.say("Nettle", "Then I'm coming. Somebody should be ready to patch you up when 'barely' stops being enough.");
        api.despawnNpc("cyber_medic");
        api.spawnCharacter("cyber_medic", 10, 47, 70);
        api.setGlobalVar("nettle_recruited", true);
        api.playSound("select");
        yield* tryLeaveMourningRow();
    }
}

// Order-of-three riddle: tribal_elder_woman (mourns) -> moon_spirit
// (watches) -> love_spirit (forgives).
function* talkToRiddleKeeper(name) {
    const order = ["tribal_elder_woman", "moon_spirit", "love_spirit"];
    const displayName = { tribal_elder_woman: "Mourn", moon_spirit: "Watch", love_spirit: "Forgive" }[name];
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
            yield api.say("Mourn", "I mourn first. Someone has to, before anything else is possible.");
        else if (newStep === 2)
            yield api.say("Watch", "And I watch, after, so the mourning isn't wasted on nothing. Go on - someone still has to forgive.");
        else {
            yield api.say("Forgive", "And I forgive. Last, and hardest, and the only one of the three that actually ends anything.");
            api.setVar("riddle_solved", true);
            api.giveExperience(80);
            api.playSound("select");
        }
    } else {
        api.setVar("riddle_step", 0);
        yield api.say(displayName, "Not yet. Not in that order.");
    }
}

// A second, smaller riddle inside Mourning Row itself, not the open
// district - a two-step call-and-response, deliberately not another
// order-of-three like Mourn/Watch/Forgive. The fire-spirit poses it near
// the entrance; the farmer-reaper only answers at the far end of the maze.
function* talkToEmberKeeper(name) {
    const order = ["fire_spirit", "farmer_reaper"];
    const displayName = { fire_spirit: "the Fire-Spirit", farmer_reaper: "the Reaper" }[name];
    const step = api.getVar("emberRiddle_step", 0);
    api.playSound("select");

    if (api.getVar("emberRiddle_solved", false)) {
        yield api.say(displayName, "*already answered*");
        return;
    }

    if (order[step] === name) {
        const newStep = step + 1;
        api.setVar("emberRiddle_step", newStep);
        if (newStep === 1)
            yield api.say("Fire-Spirit", "*flickers, low and steady among the graves* What burns longest with nothing left to feed it?");
        else {
            yield api.say("Reaper", "*doesn't stop working* Grief. Same answer every harvest, if you're asking me instead of a priest.");
            api.setVar("emberRiddle_solved", true);
            api.giveExperience(50);
            api.playSound("select");
        }
    } else {
        yield api.say(displayName, "Not yet. The other one goes first.");
    }
}

function* rescueHostage() {
    if (api.getVar("hostage_rescued", false)) {
        yield api.say("Innkeeper", "Still grateful, truly.");
        return;
    }
    api.setVar("hostage_rescued", true);
    api.playSound("select");
    yield api.say("Innkeeper", "You- that thing's been circling me since dawn. Thank you.");
    yield api.say("Lara", "Are you hurt?");
    yield api.say("Innkeeper", "Just tired. I kept the inn here, once. There's nothing left of it, but I keep coming back anyway.");
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

    if (name === "skeleton_swordsman" || name === "zombie_peasant") {
        yield api.wait(0.3);
        yield api.say("Nettle", "Rest, finally. That's more than I could do for most of the ones I found here.");
    } else if (name === "ghoul") {
        yield api.wait(0.3);
        yield api.say("Lara", "It didn't want to fight. It wanted us to leave. I think that's the closest thing to grief it had left.");
    } else if (name === "vampire") {
        yield api.wait(0.3);
        yield api.say("Nettle", "That one remembered being a person, right up until it didn't. That's the part that never stops being sad.");
    }
}

function* onItemCollected(itemId) {
    if (itemId !== "cinder_charm")
        return;

    yield api.wait(0.3);
    yield api.say("Lara", "Warm, like the rest. Untouched, even though everything around it burned.");
    yield api.say("Nettle", "That charm belonged to someone. I dug through this whole district and never found who.");
    yield api.say("???", "You wouldn't have. They're not gone the way you're picturing - just further along the same path you're all walking now.");
    yield api.say("Lara", "That's not comforting.");
    yield api.say("???", "It isn't meant to be. One more place, Lara - somewhere old and cold and paler than anywhere you've been yet. Bring all four of them.");

    api.setVar("cinder_charm_collected", true);
    yield* tryLeaveMourningRow();
}

// The narrator's own line above already says "bring all four of them," and
// the Warden at the chapter 6 threshold hard-requires all four recruits
// (see chapter6.js's talkToWarden) with no way back here once loadLevel
// tears this scene down - so unlike every other chapter's single-item exit
// trigger, leaving here waits on whichever of "found the charm" / "recruited
// Nettle" happens second, instead of firing unconditionally the moment the
// charm is picked up.
function* tryLeaveMourningRow() {
    if (!api.getVar("cinder_charm_collected", false))
        return;

    if (!api.getGlobalVar("nettle_recruited", false)) {
        yield api.say("Lara", "Not without Nettle. She's earned a seat before we go anywhere.");
        return;
    }

    yield api.say("Lara", "Everyone's here. Let's go.");
    api.setGlobalVar("chapter", 6);
    api.playSound("select");
    yield api.wait(0.8);
    api.loadLevel("chapter6.json");
}
