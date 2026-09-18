// ============================================================================
// ShadowShine - Chapter 1: "Fernhollow" (v3 remodel, 2026-09-10)
// ============================================================================
//
// Map tripled in each dimension (150x78, was 50x26). The single Hollowbrook
// Maze is now three sequential, individually-sealed maze segments - the
// Thicket (trees), the Boulder Maze (rock/stone), and the Bramblegate
// (berry/bramble/snow-pine) - each a different but still grass_water-woodland-
// coherent prop set, connected by open, populated "chambers" rather than one
// long corridor. Hostiles and props now populate the village and the wood
// too, not just the maze/end zone. Adds this rewrite's first riddle (an
// order-of-three NPC puzzle) and first hostage rescue.
//
// Map layout (assets/maps/chapter1.json):
//   - Fernhollow village: cols 2-27
//   - Maze Segment A (the Thicket): cols 29-54, full playable height
//   - Chamber A (hostage + hostiles): cols 55-64
//   - Maze Segment B (the Boulder Maze): cols 65-90, full playable height
//   - Chamber B (more hostiles): cols 91-100
//   - Maze Segment C (the Bramblegate): cols 101-126, full playable height
//   - The wider wood + pond: cols 128-148
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
function buildBranchingMaze(west, east, northRow, southRow, corridorWidth, wallWidth, coreObstacles, edgeObstacles, seed) {
    const rand = mulberry32(seed);
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
        return isOpenAt(c - 1, r) || isOpenAt(c + 1, r) || isOpenAt(c, r - 1) || isOpenAt(c, r + 1);
    }

    // Renders one contiguous non-open rectangle as a coherent core cluster
    // (one obstacle type for the whole block's interior) with a rough,
    // independently-rolled small-prop fringe wherever it actually meets a
    // corridor tile.
    function fillBlock(c0, r0, c1, r1) {
        if (c0 > c1 || r0 > r1) return;
        const coreType = coreObstacles[Math.floor(rand() * coreObstacles.length)];
        for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
                if (isOpenAt(c, r)) continue;
                if (isSeamWall(c, r))
                    api.spawnProp(edgeObstacles[Math.floor(rand() * edgeObstacles.length)], c, r);
                else
                    api.spawnProp(coreType, c, r);
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

    const cellCenters = [];
    for (let cx = 0; cx < numCellsX; cx++)
        for (let cy = 0; cy < numCellsY; cy++)
            cellCenters.push({
                col: Math.round((cellColStart(cx) + cellColEnd(cx)) / 2),
                row: Math.round((cellRowStart(cy) + cellRowEnd(cy)) / 2),
            });
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

function* onLevelStart() {
    api.spawnCharacter("lara_cyber", 4, 38);
    api.giveControl("lara_cyber");

    buildFernhollowVillage();
    buildHollowbrookMaze();

    if (api.getVar("chapter1_intro_seen", false))
        return;
    api.setVar("chapter1_intro_seen", true);

    yield api.wait(0.6);
    yield api.say("Lara", "...Fernhollow. Same crooked fences, same well that never quite fills all the way.");
    yield api.say("Hint", "Move with WASD or the Arrow keys.");
    yield api.say("Hint", "Hold Shift while moving to run.");
    yield api.say("Hint", "Press E near someone - or something - to talk, or take a closer look.");
    yield api.say("Hint", "Press Ctrl to attack. Press I for your inventory, Tab to switch who you're playing as.");
    yield api.say("Lara", "Wren said she'd be by the well this morning. Let's see if that's actually true for once.");
}

// ============================================================================
// Fernhollow village - a small open entrance pocket, no maze. Just Wren and
// the basic supplies; everyone else (the riddle-keepers, the hostage, the
// wildlife) now lives inside the Hollowbrook Maze itself, below.
// ============================================================================
function buildFernhollowVillage() {
    api.spawnProp("cottage_a", 4, 20);
    api.spawnProp("cottage_b", 10, 12);
    api.spawnProp("well", 7, 30);
    api.spawnProp("market_stall", 11, 45);
    api.spawnProp("haystack", 5, 55);
    api.spawnProp("notice_board", 3, 33);
    api.spawnProp("vegetable_garden", 9, 50);
    api.spawnProp("bench", 8, 42);
    scatterOrganic(["bush", "wildflowers", "fence_straight", "rocks_small"], 2, 15, 4, 74, 18, 10001, [
        { col: 4, row: 20 }, { col: 10, row: 12 }, { col: 7, row: 30 }, { col: 11, row: 45 },
        { col: 5, row: 55 }, { col: 3, row: 33 }, { col: 9, row: 50 }, { col: 8, row: 42 }, { col: 10, row: 38 },
    ]);

    api.spawnNpc("herbalist", 10, 38);

    if (api.getVar("chapter1_loot_spawned", false))
        return;
    api.setVar("chapter1_loot_spawned", true);
    api.spawnItem("dried_rations", 6, 16);
    api.spawnItem("bread_loaf", 12, 48);
    api.spawnItem("waterskin", 4, 60);
    api.spawnItem("berry_pouch", 12, 30);
    api.spawnItem("health_potion", 6, 55);
}

// The Hollowbrook Maze - the whole rest of the map (cols 17-148, full
// playable height) is now ONE genuine branching maze, not three segments
// stitched together with open rest-stops. Bigger, more distinctive set-
// piece props (pine/oak/boulder/cliff/bramble - the old Thicket/Boulder-
// Maze/Bramblegate look, unified rather than zoned) fill each wall
// cluster's interior; small rough-edged undergrowth (bush/rocks/stump/
// ivy/berry) fills the seam wherever a wall actually meets a corridor -
// safe to mix big set-pieces back in now that they're never the thing
// directly bordering the walkable path (see buildBranchingMaze's own
// comment for why that placement rule matters).
function buildHollowbrookMaze() {
    const coreObstacles = ["pine_tree", "oak_tree", "boulder_large", "cliff_face", "dead_tree", "snowy_pine", "dead_twisted_tree", "fallen_log"];
    const edgeObstacles = ["bush", "rocks_small", "tree_stump", "ivy_rock", "berry_bush"];
    const cells = buildBranchingMaze(17, 148, 1, 76, 2, 4, coreObstacles, edgeObstacles, 11001);

    // One shared, non-overlapping cell set for EVERYTHING placed in the
    // maze - 62 hostiles (double the original three-segment-derived total
    // of 31: wolf/goblin/boar/bear/slime_water each doubled) + 3
    // riddle-keepers + the hostage + the fox/deer pair + 14 loot items
    // (8 health potions - tripled from the original 2, per-level healing
    // supply pass - 2 general trinkets, and 4 originals including the
    // glowing_acorn key item) = 82 cells. Sampling without replacement
    // from one call guarantees distinct spots by construction, no matter
    // how many different beats share the same maze.
    const spots = sampleCells(cells, 82, 11002);
    let i = 0;

    if (!api.getVar("hollowbrook_hostiles_spawned", false)) {
        api.setVar("hollowbrook_hostiles_spawned", true);
        // Double the original three-segment totals: wolf x10, goblin x12,
        // boar x12, bear x16, slime_water x12 = 62.
        const hostileTypes = [
            "wolf", "wolf", "wolf", "wolf", "wolf", "wolf", "wolf", "wolf", "wolf", "wolf",
            "goblin", "goblin", "goblin", "goblin", "goblin", "goblin", "goblin", "goblin", "goblin", "goblin", "goblin", "goblin",
            "boar", "boar", "boar", "boar", "boar", "boar", "boar", "boar", "boar", "boar", "boar", "boar",
            "bear", "bear", "bear", "bear", "bear", "bear", "bear", "bear", "bear", "bear", "bear", "bear", "bear", "bear", "bear", "bear",
            "slime_water", "slime_water", "slime_water", "slime_water", "slime_water", "slime_water", "slime_water", "slime_water", "slime_water", "slime_water", "slime_water", "slime_water",
        ];
        hostileTypes.forEach(type => { api.spawnEnemy(type, spots[i].col, spots[i].row, 30); i++; });
    } else {
        i += 62;
    }

    // The order-of-three riddle-keepers, spoken of by Wren - see
    // onTalkTo/talkToRiddleKeeper().
    api.spawnNpc("bird_night_owl", spots[i].col, spots[i].row); i++;
    api.spawnNpc("tribal_elder_woman", spots[i].col, spots[i].row); i++;
    api.spawnNpc("crystal_spirit", spots[i].col, spots[i].row); i++;

    // A rare friendly pair inside the maze itself - a small two-step riddle,
    // the fox posing it, the deer only answering once found elsewhere in
    // the maze.
    api.spawnNpc("fox", spots[i].col, spots[i].row); i++;
    api.spawnNpc("deer", spots[i].col, spots[i].row); i++;

    if (!api.getVar("hostage_spawned", false)) {
        api.setVar("hostage_spawned", true);
        api.spawnNpc("farmhand_young", spots[i].col, spots[i].row);
    }
    i++;

    if (api.getVar("hollowbrook_loot_spawned", false))
        return;
    api.setVar("hollowbrook_loot_spawned", true);
    api.spawnItem("gold_coin_pile", spots[i].col, spots[i].row); i++;
    api.spawnItem("rope_coil", spots[i].col, spots[i].row); i++;
    api.spawnItem("herb_bundle", spots[i].col, spots[i].row); i++;
    api.spawnItem("glowing_acorn", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("honey_jar", spots[i].col, spots[i].row); i++;
    api.spawnItem("mana_potion", spots[i].col, spots[i].row); i++;
}

function* onTalkTo(name) {
    if (name === "herbalist") {
        yield* talkToWren();
    } else if (name === "bird_night_owl" || name === "tribal_elder_woman" || name === "crystal_spirit") {
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
        yield api.say("Wren", "There you are. I was starting to think you'd sleep through the whole hum.");
        yield api.say("Lara", "The what?");
        yield api.say("Wren", "Low, steady, coming from past the old maze. Started three nights ago and hasn't stopped.");
        yield api.say("Wren", "Before you go - old Fernhollow riddle, for luck: \"I listen before I ever speak, I remember what the listening finds, and only then do I answer.\" Three folk in this village live that riddle, in that order. Find them, if you want the luck.");
    } else if (timesTalked === 1) {
        yield api.say("Lara", "And you? Do you live it too?");
        yield api.say("Wren", "I just grow things and hope they don't ask too many questions back. Mind the maze, and whatever's guarding past it.");
    } else {
        yield api.say("Wren", "Go on, then. Through the Thicket, past the stones, through the bramble, toward whatever's humming.");
        api.playSound("select");
    }
}

// Order-of-three riddle: bird_night_owl (listens) -> tribal_elder_woman
// (remembers) -> crystal_spirit (answers). Talking out of order resets the
// step with an in-fiction hint, never a hard fail - same soft-fail style
// this project already uses for order puzzles.
function* talkToRiddleKeeper(name) {
    const order = ["bird_night_owl", "tribal_elder_woman", "crystal_spirit"];
    const displayName = { bird_night_owl: "Owl", tribal_elder_woman: "Elder", crystal_spirit: "Echo" }[name];
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
            yield api.say("Owl", "*blinks slowly, listening* ...Go on, then. Someone should remember this.");
        else if (newStep === 2)
            yield api.say("Elder", "I remember. I've remembered longer than anyone still living here. Now someone only has to answer.");
        else {
            yield api.say("Echo", "*a small crystalline chime* The answer was never a word. It was the order you found us in.");
            yield api.say("Lara", "...Listen, remember, answer. That's it, isn't it.");
            api.setVar("riddle_solved", true);
            api.giveExperience(80);
            api.playSound("select");
        }
    } else {
        api.setVar("riddle_step", 0);
        yield api.say(displayName, "*waits, patiently* Not yet. Not in that order.");
    }
}

// A second, smaller riddle, this one hidden inside the maze itself rather
// than the village - a two-step call-and-response, not another order-of-
// three, so it doesn't just feel like a repeat of Wren's puzzle. Fox poses
// it deep in Segment A; Deer only answers once found at the far end of
// Segment C, a good stretch later.
function* talkToWildKeeper(name) {
    const order = ["fox", "deer"];
    const displayName = { fox: "Fox", deer: "Deer" }[name];
    const step = api.getVar("wildRiddle_step", 0);
    api.playSound("select");

    if (api.getVar("wildRiddle_solved", false)) {
        yield api.say(displayName, "*watches you pass, unbothered*");
        return;
    }

    if (order[step] === name) {
        const newStep = step + 1;
        api.setVar("wildRiddle_step", newStep);
        if (newStep === 1)
            yield api.say("Fox", "*tilts its head* What grows thicker for every bit that's cut away from it?");
        else {
            yield api.say("Deer", "*doesn't flinch as you approach* A path, worn in by feet, not by any hand pruning it. Fox already knew. Fox likes to ask anyway.");
            api.setVar("wildRiddle_solved", true);
            api.giveExperience(50);
            api.playSound("select");
        }
    } else {
        yield api.say(displayName, "*just watches, waiting for the other one first*");
    }
}

function* rescueHostage() {
    if (api.getVar("hostage_rescued", false)) {
        yield api.say("Farmhand", "Thank you again, truly.");
        return;
    }
    api.setVar("hostage_rescued", true);
    api.playSound("select");
    yield api.say("Farmhand", "You- you're not one of them. Oh, thank every root in this wood.");
    yield api.say("Lara", "Are you hurt?");
    yield api.say("Farmhand", "Scared more than hurt. I wandered too far past the fence chasing a lost goat. Please, just- get me back toward the village road.");
    yield api.say("Lara", "The road's just west of here. Go carefully.");
    api.giveExperience(100);
}

function* onEnemyDefeated(name) {
    // A flavor line for a few enemy archetypes below - deliberately rare
    // (not once per matching kill, which reads as spammy once several
    // wolves/goblins/slimes in a row have died the same way) via a flat
    // low-probability roll before even checking which archetype this is.
    // Plain Math.random() on purpose, unlike the seeded mulberry32() this
    // file's own generators use elsewhere - that determinism is for level
    // LAYOUT reproducibility (so a placement bug is catchable once and
    // trusted forever), which doesn't apply to a cosmetic post-kill quip.
    if (Math.random() > 0.1)
        return;

    if (name === "wolf") {
        yield api.wait(0.3);
        yield api.say("Lara", "Sorry, old thing. You were just in the way.");
    } else if (name === "goblin") {
        yield api.wait(0.3);
        yield api.say("Lara", "Scavenger, not a soldier. There'll be easier ground for it somewhere else.");
    } else if (name === "slime_water") {
        yield api.wait(0.3);
        yield api.say("Lara", "...That water didn't used to do that. Wren wasn't exaggerating.");
    }
}

function* onItemCollected(itemId) {
    if (itemId !== "glowing_acorn")
        return;

    yield api.wait(0.3);
    yield api.say("Lara", "...Huh.");
    yield api.say("Lara", "It's warm. And it's humming - not an echo of whatever Wren heard. The note itself, right here in my hand.");
    yield api.say("???", "Now you understand why nobody in Fernhollow will say it out loud.");
    yield api.say("Lara", "Who's there?");
    yield api.say("???", "Someone who found one of those a long time ago, and is still finding out what it means. Follow the hum, Lara. It gets louder from here, not quieter.");

    api.setGlobalVar("chapter", 2);
    api.playSound("select");
    yield api.wait(0.8);
    yield api.say("Lara", "East, then, past Fernhollow - toward wherever this thing actually came from.");
    api.loadLevel("chapter2.json");
}
