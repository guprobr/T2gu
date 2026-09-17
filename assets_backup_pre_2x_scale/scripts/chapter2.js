// ============================================================================
// ShadowShine - Chapter 2: "The Long Root" (v2 remodel, 2026-09-10)
// ============================================================================
//
// Map tripled in each dimension (168x90, was 56x30). Deliberately a
// DIFFERENT shape from Chapter 1's sequential three-segment maze, not the
// same template reused: the Root Tangle FORKS into two independent,
// vertically-stacked maze paths that a player picks between, which then
// reconverge at one shared chamber, followed by a single smaller "Root
// Gate" maze before the wood. Introduces Juniper (tribal_shaman_girl).
//
// Map layout (assets/maps/chapter2.json):
//   - Arrival clearing: cols 2-30
//   - The Root Tangle fork: cols 32-90 - Path A is rows 1-44, Path B is
//     rows 45-88 (same columns, no gap between them - together they cover
//     the full playable height, so there's still no way around either)
//   - Reconverge chamber (hostage + hostiles): cols 92-101
//   - The Root Gate (a single final maze): cols 103-130, full height
//   - The wood beyond: cols 132-165
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
    const innerWest = west + 1, innerEast = east - 1; // reserve the perimeter columns for walls
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
    openRect(west, cellRowStart(startCy), west, cellRowEnd(startCy));
    openRect(east, cellRowStart(exitCy), east, cellRowEnd(exitCy));

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
    fillPerimeterColumn(west);
    fillPerimeterColumn(east);

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

function respawnCompanions() {
    if (api.getVar("juniper_recruited", false))
        api.spawnCharacter("tribal_shaman_girl", 4, 47, 70);
}

function* onLevelStart() {
    api.spawnCharacter("lara_cyber", 3, 45);
    api.giveControl("lara_cyber");
    respawnCompanions();

    buildArrivalClearing();
    buildRootTangleMaze();

    if (api.getVar("chapter2_intro_seen", false))
        return;
    api.setVar("chapter2_intro_seen", true);

    yield api.wait(0.5);
    yield api.say("Lara", "The hum's clearer out here. Less like a sound and more like a direction.");
    yield api.say("Hint", "The Root Tangle ahead looks like it goes on for a while.");
}

// A small open entrance pocket, no maze - just Juniper and basic supplies.
// Everyone else (the riddle-keepers, the hostage, the wildlife) now lives
// inside the Root Tangle itself, below.
function buildArrivalClearing() {
    api.spawnProp("dead_tree", 6, 20);
    api.spawnProp("fallen_log", 12, 60);
    api.spawnProp("boulder_large", 10, 15);
    scatterOrganic(["bush", "wildflowers", "rocks_small", "tree_stump"], 2, 15, 4, 86, 20, 20001, [
        { col: 6, row: 20 }, { col: 12, row: 60 }, { col: 10, row: 15 }, { col: 10, row: 45 },
    ]);

    api.spawnNpc("tribal_shaman_girl", 10, 45);

    if (api.getVar("chapter2_loot_spawned", false))
        return;
    api.setVar("chapter2_loot_spawned", true);
    api.spawnItem("dried_rations", 6, 30);
    api.spawnItem("waterskin", 12, 70);
    api.spawnItem("whetstone", 8, 55);
    api.spawnItem("health_potion", 6, 65);
}

// The Root Tangle - the whole rest of the map (cols 17-166, full playable
// height) is now ONE genuine branching maze, not a fork plus a
// reconverge chamber plus a separate final gate plus a deep wood. Bigger
// set-piece props (dead trees, boulders, the cliff face) fill each wall
// cluster's interior; small rough-edged undergrowth fills the seam
// wherever a wall actually meets a corridor.
function buildRootTangleMaze() {
    const coreObstacles = ["dead_tree", "boulder_large", "cliff_face", "dead_twisted_tree"];
    const edgeObstacles = ["rocks_small", "bush", "tree_stump", "ivy_rock"];
    const cells = buildBranchingMaze(17, 166, 1, 88, 3, 4, coreObstacles, edgeObstacles, 21001);

    // One shared, non-overlapping cell set for EVERYTHING placed in the
    // maze - 17 hostiles (same total as the old fork+chamber+gate+wood
    // pass: wolf x6, goblin x6, lizardman x5) + 3 riddle-keepers +
    // elf_archer/imp + the hostage + 7 loot items (2 health potions, 2
    // general trinkets, and 3 originals including the root_seal key
    // item) = 30 cells.
    const spots = sampleCells(cells, 30, 21002);
    let i = 0;

    if (!api.getVar("rootTangle_hostiles_spawned", false)) {
        api.setVar("rootTangle_hostiles_spawned", true);
        const hostileTypes = [
            "wolf", "wolf", "wolf", "wolf", "wolf", "wolf",
            "goblin", "goblin", "goblin", "goblin", "goblin", "goblin",
            "lizardman", "lizardman", "lizardman", "lizardman", "lizardman",
        ];
        hostileTypes.forEach(type => { api.spawnEnemy(type, spots[i].col, spots[i].row, 30); i++; });
    } else {
        i += 17;
    }

    // Order-of-three riddle: gnome_inventor (builds) -> mushroom_gnome
    // (grows) -> forest_spirit (remembers).
    api.spawnNpc("gnome_inventor", spots[i].col, spots[i].row); i++;
    api.spawnNpc("mushroom_gnome", spots[i].col, spots[i].row); i++;
    api.spawnNpc("forest_spirit", spots[i].col, spots[i].row); i++;

    // A rare friendly pair inside the maze itself - a small two-step
    // riddle, the archer posing it, the imp only answering once found
    // elsewhere in the maze.
    api.spawnNpc("elf_archer", spots[i].col, spots[i].row); i++;
    api.spawnNpc("imp", spots[i].col, spots[i].row); i++;

    if (!api.getVar("hostage_spawned", false)) {
        api.setVar("hostage_spawned", true);
        api.spawnNpc("tribal_villager_1", spots[i].col, spots[i].row);
    }
    i++;

    if (api.getVar("rootTangle_loot_spawned", false))
        return;
    api.setVar("rootTangle_loot_spawned", true);
    api.spawnItem("small_ingot", spots[i].col, spots[i].row); i++;
    api.spawnItem("silver_coin_pouch", spots[i].col, spots[i].row); i++;
    api.spawnItem("root_seal", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("nail_pouch", spots[i].col, spots[i].row); i++;
    api.spawnItem("lockpick_set", spots[i].col, spots[i].row); i++;
}

function* onTalkTo(name) {
    if (name === "tribal_shaman_girl") {
        yield* talkToJuniper();
    } else if (name === "gnome_inventor" || name === "mushroom_gnome" || name === "forest_spirit") {
        yield* talkToRiddleKeeper(name);
    } else if (name === "tribal_villager_1") {
        yield* rescueHostage();
    } else if (name === "elf_archer" || name === "imp") {
        yield* talkToRootKeeper(name);
    }
}

function* talkToJuniper() {
    const timesTalked = api.getVar("juniper_talks", 0);
    api.setVar("juniper_talks", timesTalked + 1);
    api.playSound("select");

    if (timesTalked === 0) {
        yield api.say("Juniper", "You carry a warm stone and a louder step than most people who wander this far in.");
        yield api.say("Lara", "You can feel it too? The acorn, I mean.");
        yield api.say("Juniper", "I can feel that you're carrying something that isn't asleep. Three folk in this clearing know an old riddle about that - build it, grow it, remember it, in that order, if you want their blessing.");
    } else if (timesTalked === 1) {
        yield api.say("Lara", "And you? Which are you?");
        yield api.say("Juniper", "None of the three. I just listen to what the roots repeat. Lately it's been the same shape, over and over.");
        yield api.say("Lara", "Come with me, then. Two sets of ears are better than one.");
    } else {
        yield api.say("Juniper", "All right. Someone should be there to translate when it stops being metaphorical.");
        api.despawnNpc("tribal_shaman_girl");
        api.spawnCharacter("tribal_shaman_girl", 10, 45, 70);
        api.setVar("juniper_recruited", true);
        api.playSound("select");
    }
}

// Order-of-three riddle: gnome_inventor (builds) -> mushroom_gnome
// (grows) -> forest_spirit (remembers).
function* talkToRiddleKeeper(name) {
    const order = ["gnome_inventor", "mushroom_gnome", "forest_spirit"];
    const displayName = { gnome_inventor: "Tinker", mushroom_gnome: "Cap", forest_spirit: "Root-Mind" }[name];
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
            yield api.say("Tinker", "I build. That's step one of most things worth having.");
        else if (newStep === 2)
            yield api.say("Cap", "And I grow, slow and patient, on whatever you built. Go on - someone still has to remember why.");
        else {
            yield api.say("Root-Mind", "*a slow groaning creak, almost words* And I remember. Built, grown, remembered - that is how anything lasts.");
            api.setVar("riddle_solved", true);
            api.giveExperience(80);
            api.playSound("select");
        }
    } else {
        api.setVar("riddle_step", 0);
        yield api.say(displayName, "Not yet. Not in that order.");
    }
}

// A second, smaller riddle threaded through the fork itself rather than
// the clearing - a two-step call-and-response, deliberately not another
// order-of-three so it doesn't just echo Tinker/Cap/Root-Mind. The archer
// poses it in Path A; the imp only answers once found deep in the Root
// Gate, well past the reconverge chamber.
function* talkToRootKeeper(name) {
    const order = ["elf_archer", "imp"];
    const displayName = { elf_archer: "the Archer", imp: "the Imp" }[name];
    const step = api.getVar("rootRiddle_step", 0);
    api.playSound("select");

    if (api.getVar("rootRiddle_solved", false)) {
        yield api.say(displayName, "*already answered, still smirking about it*");
        return;
    }

    if (order[step] === name) {
        const newStep = step + 1;
        api.setVar("rootRiddle_step", newStep);
        if (newStep === 1)
            yield api.say("Archer", "An old tracker's question, if you want it: what root never grows toward the light?");
        else {
            yield api.say("Imp", "*cackles* The one that's already found what it wanted underground! Nobody ever guesses that one on the first try.");
            api.setVar("rootRiddle_solved", true);
            api.giveExperience(50);
            api.playSound("select");
        }
    } else {
        yield api.say(displayName, "Not yet. The other one goes first.");
    }
}

function* rescueHostage() {
    if (api.getVar("hostage_rescued", false)) {
        yield api.say("Villager", "Still grateful, truly.");
        return;
    }
    api.setVar("hostage_rescued", true);
    api.playSound("select");
    yield api.say("Villager", "You found me. I took the wrong path through this tangle three days ago and never found my way back out.");
    yield api.say("Lara", "Three days?");
    yield api.say("Villager", "Felt like three days. Might've been one. Either way - the way back is south of here, if the wolves have moved on.");
    api.giveExperience(100);
}

function* onEnemyDefeated(name) {
    if (name === "wolf") {
        yield api.wait(0.3);
        yield api.say("Lara", "Just hungry, probably. Sorry all the same.");
    } else if (name === "goblin") {
        yield api.wait(0.3);
        yield api.say("Juniper", "Scavenger, not a soldier. It'll find easier ground than this.");
    } else if (name === "lizardman") {
        yield api.wait(0.3);
        yield api.say("Lara", "That one felt more territorial than hungry. Wrong stretch of wood to guard, maybe.");
    }
}

function* onItemCollected(itemId) {
    if (itemId !== "root_seal")
        return;

    yield api.wait(0.3);
    yield api.say("Lara", "A seal. Someone carved this on purpose - this isn't just a root that grew strange.");
    yield api.say("Juniper", "Someone who spoke the same language your acorn does. That's not a coincidence I know how to explain yet.");
    yield api.say("???", "It isn't a coincidence at all. It's a trail. You're following it correctly.");
    yield api.say("Lara", "You keep showing up right when I'm about to ask the right question.");
    yield api.say("???", "That's usually how it works. There's stone under this wood older than the trees - go find it.");

    api.setVar("chapter", 3);
    api.playSound("select");
    yield api.wait(0.8);
    api.loadLevel("chapter3.json");
}
