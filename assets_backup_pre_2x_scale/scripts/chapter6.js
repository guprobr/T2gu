// ============================================================================
// ShadowShine - Chapter 6: "The Nameless Threshold" (v2 remodel, 2026-09-10)
// ============================================================================
//
// Map tripled in each dimension (180x102, was 60x34). This arc's climax
// gets its own combination again - not Chapter 1's three segments, not
// Chapter 2's fork, not Chapter 3/4's one giant maze, not Chapter 5's open
// district: TWO maze segments, each with hostiles embedded directly in
// their corridors (same technique as Chapters 3-4), connected by one
// populated chamber. The "riddle" here is reframed as a Trial - courage,
// kindness, humility - rather than the listen/remember/answer shape every
// earlier chapter shares, since this is the story's biggest turn so far.
// The existing climactic group ritual (all four companions + Lara) is
// unchanged. No new companion.
//
// Corridor coordinates below were computed from buildSnakingMaze's own
// band pattern (row = northRow + 3*k), same verification approach as
// Chapters 3-4.
//
// Map layout (assets/maps/chapter6.json):
//   - The approach: cols 2-28
//   - The Warden's First Trial (maze): cols 30-95, full playable height
//   - A chamber (hostage + hostiles): cols 97-106
//   - The Warden's Final Trial (maze): cols 108-165, full playable height
//   - The threshold itself: cols 167-178
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
        api.spawnCharacter("tribal_shaman_girl", 4, 50, 70);
    if (api.getVar("cobb_recruited", false))
        api.spawnCharacter("dwarf_miner", 5, 50, 75);
    if (api.getVar("vex_recruited", false))
        api.spawnCharacter("cyber_engineer", 6, 50, 70);
    if (api.getVar("nettle_recruited", false))
        api.spawnCharacter("cyber_medic", 7, 50, 70);
}

function* onLevelStart() {
    api.spawnCharacter("lara_cyber", 3, 50);
    api.giveControl("lara_cyber");
    respawnCompanions();

    buildApproach();
    buildTrialMaze();
    buildThreshold();
    api.spawnNpc("crystal_spirit", 168, 5);

    if (api.getVar("chapter6_intro_seen", false))
        return;
    api.setVar("chapter6_intro_seen", true);

    yield api.wait(0.5);
    yield api.say("Nettle", "It's colder here than the season accounts for.");
    yield api.say("Lara", "Everything's paler too. Like the color got asked to leave before we arrived.");
    yield api.say("Hint", "Something waits at the far end of this place. Bring everyone.");
}

function buildApproach() {
    api.spawnProp("snowy_pine", 6, 20);
    api.spawnProp("boulder_large", 20, 65);
    scatterOrganic(["ivy_rock", "rocks_small", "bush"], 3, 27, 4, 96, 45, 60001, [
        { col: 6, row: 20 }, { col: 20, row: 65 }, { col: 6, row: 35 }, { col: 20, row: 40 }, { col: 15, row: 50 },
    ]);

    // A rare friendly face at the approach - the first half of a small
    // two-step riddle that pays off far later, at the threshold itself.
    api.spawnNpc("storm_spirit", 15, 50);

    if (api.getVar("chapter6_loot_spawned", false))
        return;
    api.setVar("chapter6_loot_spawned", true);
    api.spawnItem("stamina_draught", 6, 35);
    api.spawnItem("waterskin", 20, 40);
    api.spawnItem("health_potion", 10, 65);
}

// The Warden's Trial - the whole middle of the map (cols 30-165, full
// playable height) is now ONE genuine branching maze, not two separate
// Trial mazes stitched together with an open chamber between them. Bigger
// mystic set-pieces (broken statues, moss-grown altars, buried relic
// cases) fill each wall cluster's interior; small rough-edged ruin debris
// fills the seam wherever a wall meets a corridor.
function buildTrialMaze() {
    const coreObstacles = ["broken_arcane_statue", "moss_grown_altar", "buried_relic_case", "shattered_mirror_shard"];
    const edgeObstacles = ["runic_standing_stone", "ancient_obelisk", "barred_cell_section", "gravestone_cluster"];
    const cells = buildBranchingMaze(30, 165, 1, 100, 3, 4, coreObstacles, edgeObstacles, 61001);

    // One shared, non-overlapping cell set for EVERYTHING placed in the
    // maze - 30 hostiles (same total as the old two-Trial+chamber pass:
    // wolf x8, orc x9, troll x8, minotaur x4, skeleton_swordsman x1) + the
    // three Trial-keepers + the hostage + 8 loot items (an extra health
    // potion and 2 general trinkets on top of the original 5) = 42 cells.
    const spots = sampleCells(cells, 42, 61002);
    let i = 0;

    if (!api.getVar("trial_hostiles_spawned", false)) {
        api.setVar("trial_hostiles_spawned", true);
        const hp = { wolf: 35, orc: 45, troll: 55, minotaur: 60, skeleton_swordsman: 40 };
        const hostileTypes = [
            "wolf", "wolf", "wolf", "wolf", "wolf", "wolf", "wolf", "wolf",
            "orc", "orc", "orc", "orc", "orc", "orc", "orc", "orc", "orc",
            "troll", "troll", "troll", "troll", "troll", "troll", "troll", "troll",
            "minotaur", "minotaur", "minotaur", "minotaur",
            "skeleton_swordsman",
        ];
        hostileTypes.forEach(type => { api.spawnEnemy(type, spots[i].col, spots[i].row, hp[type]); i++; });
    } else {
        i += 30;
    }

    // Trial-keepers - dark_elf_mage (Courage) -> ice_spirit (Kindness) ->
    // necromancer (Humility). See onTalkTo/faceTrial().
    api.spawnNpc("dark_elf_mage", spots[i].col, spots[i].row); i++;
    api.spawnNpc("ice_spirit", spots[i].col, spots[i].row); i++;
    api.spawnNpc("necromancer", spots[i].col, spots[i].row); i++;

    if (!api.getVar("hostage_spawned", false)) {
        api.setVar("hostage_spawned", true);
        api.spawnNpc("sun_spirit", spots[i].col, spots[i].row);
    }
    i++;

    if (api.getVar("trial_loot_spawned", false))
        return;
    api.setVar("trial_loot_spawned", true);
    api.spawnItem("sealed_vial_of_mist", spots[i].col, spots[i].row); i++;
    api.spawnItem("woven_talisman", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("elixir_of_clarity", spots[i].col, spots[i].row); i++;
    api.spawnItem("reinforced_boots", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("antidote_vial", spots[i].col, spots[i].row); i++;
    api.spawnItem("humming_crystal", spots[i].col, spots[i].row); i++;
}

// The threshold - the toughest hostiles this arc has seen, clustered near
// the bottom, well clear of the Warden near the top.
function buildThreshold() {
    api.spawnProp("shattered_mirror_shard", 170, 12);
    api.spawnProp("sunken_archway", 175, 20);
    api.spawnProp("whispering_well", 169, 80);
    api.spawnProp("moss_grown_altar", 172, 75);

    if (!api.getVar("threshold_hostiles_spawned", false)) {
        api.setVar("threshold_hostiles_spawned", true);
        api.spawnEnemy("wraith", 176, 88, 45);
        api.spawnEnemy("golem", 174, 92, 60);
        api.spawnEnemy("lich_king", 177, 84, 55);
    }
    // The second half of the storm-spirit's riddle, set up back at the
    // approach.
    api.spawnNpc("water_spirit", 170, 15);

    if (api.getVar("threshold_loot_spawned", false))
        return;
    api.setVar("threshold_loot_spawned", true);
    api.spawnItem("ancient_coin", 168, 40);
    api.spawnItem("health_potion", 172, 40);
}

function* onTalkTo(name) {
    if (name === "dark_elf_mage" || name === "ice_spirit" || name === "necromancer") {
        yield* faceTrial(name);
    } else if (name === "sun_spirit") {
        yield* rescueHostage();
    } else if (name === "crystal_spirit") {
        yield* talkToWarden();
    } else if (name === "storm_spirit" || name === "water_spirit") {
        yield* talkToElementKeeper(name);
    }
}

// The Trial: courage, kindness, humility, faced in that order - a
// different framing from the listen/remember/answer riddles earlier
// chapters share, since this is the story's biggest turn so far.
function* faceTrial(name) {
    const order = ["dark_elf_mage", "ice_spirit", "necromancer"];
    const displayName = { dark_elf_mage: "the Trial of Courage", ice_spirit: "the Trial of Kindness", necromancer: "the Trial of Humility" }[name];
    const step = api.getVar("trial_step", 0);
    api.playSound("select");

    if (api.getVar("trial_passed", false)) {
        yield api.say(displayName, "*already faced*");
        return;
    }

    if (order[step] === name) {
        const newStep = step + 1;
        api.setVar("trial_step", newStep);
        if (newStep === 1)
            yield api.say("Trial of Courage", "You didn't hesitate at the door. That's the whole test - not fearlessness, just not stopping.");
        else if (newStep === 2)
            yield api.say("Trial of Kindness", "You could have walked past me. Most do. Go on - one trial left, and it's the hardest to fake.");
        else {
            yield api.say("Trial of Humility", "And you came anyway, knowing you might not be the one who finishes this. Courage, kindness, humility - in that order, always. Go.");
            api.setVar("trial_passed", true);
            api.giveExperience(100);
            api.playSound("select");
        }
    } else {
        api.setVar("trial_step", 0);
        yield api.say(displayName, "Not yet. Not in that order.");
    }
}

function* rescueHostage() {
    if (api.getVar("hostage_rescued", false)) {
        yield api.say("Sun-Spirit", "*a warm, wordless thanks*");
        return;
    }
    api.setVar("hostage_rescued", true);
    api.playSound("select");
    yield api.say("Sun-Spirit", "*flares gently, like a held breath finally let go*");
    yield api.say("Lara", "You've been trapped here a while, haven't you.");
    yield api.say("Sun-Spirit", "*a warmth that somehow means 'longer than you'd believe'*");
    api.giveExperience(100);
}

// A second, smaller riddle spanning the whole approach to the threshold -
// a two-step call-and-response, deliberately not another three-part Trial
// like Courage/Kindness/Humility. Storm poses it at the very start; Water
// only answers at the threshold itself, just steps from the Warden.
function* talkToElementKeeper(name) {
    const order = ["storm_spirit", "water_spirit"];
    const displayName = { storm_spirit: "the Storm-Spirit", water_spirit: "the Water-Spirit" }[name];
    const step = api.getVar("elementRiddle_step", 0);
    api.playSound("select");

    if (api.getVar("elementRiddle_solved", false)) {
        yield api.say(displayName, "*already answered, still watching*");
        return;
    }

    if (order[step] === name) {
        const newStep = step + 1;
        api.setVar("elementRiddle_step", newStep);
        if (newStep === 1)
            yield api.say("Storm-Spirit", "*a low, distant rumble, almost words* What falls without ever landing?");
        else {
            yield api.say("Water-Spirit", "*ripples, unbothered by the cold* Its own echo. Storm already knows. Storm likes to ask anyway.");
            api.setVar("elementRiddle_solved", true);
            api.giveExperience(50);
            api.playSound("select");
        }
    } else {
        yield api.say(displayName, "*waits, patiently* Not yet. Not without the other one first.");
    }
}

function* talkToWarden() {
    if (api.getVar("threshold_opened", false)) {
        yield api.say("Warden", "*it is already open. There is nothing left to ask it.*");
        return;
    }

    const hasJuniper = api.getVar("juniper_recruited", false);
    const hasCobb = api.getVar("cobb_recruited", false);
    const hasVex = api.getVar("vex_recruited", false);
    const hasNettle = api.getVar("nettle_recruited", false);

    api.playSound("select");

    if (!(hasJuniper && hasCobb && hasVex && hasNettle)) {
        yield api.say("Warden", "You are not enough voices yet. Come back when you are not walking with only some of them.");
        return;
    }

    yield api.say("Warden", "Five who carry the same warmth in five different shapes. That is rarer than you understand.");
    yield api.say("Warden", "I will open. But not for silence. Each of you - a piece of the same thought. Together, or not at all.");

    yield api.wait(0.4);
    yield api.say("Lara", "The hum");
    yield api.say("Juniper", "was never");
    yield api.say("Cobb", "just one");
    yield api.say("Vex", "voice");
    yield api.say("Nettle", "- it's ours now.");

    yield api.wait(0.5);
    yield api.say("Warden", "\"The hum was never just one voice - it's ours now.\" ...I did not expect anyone to arrive at that on their own.");
    yield api.say("Lara", "We didn't, really. Four other people got me here.");
    yield api.say("Warden", "That is rather the point. Go on, then - all five of you.");

    api.setVar("threshold_opened", true);
    api.playSound("select");
    yield api.wait(0.8);

    yield api.say("Lara", "...Everyone seeing this?");
    yield api.say("Vex", "I have no instrument that explains what I'm looking at. That has never happened to me before.");
    yield api.say("Cobb", "Nor me, and I've seen the inside of a mountain.");
    yield api.say("???", "It's both, actually - stone and signal and root and story, and it was always going to look like all of them at once from here.");
    yield api.say("Lara", "You're closer now. I can hear it - you're not just a voice anymore, are you?");
    yield api.say("???", "Closer than I've been in longer than any of you have been alive. Whatever's past this point, Lara, it was never going to be small - and I am glad, for once, that it isn't just me walking into it.");

    api.setVar("chapter", 7);
}

function* onEnemyDefeated(name) {
    if (name === "wraith") {
        yield api.wait(0.3);
        yield api.say("Juniper", "It didn't scream. It just stopped holding its shape.");
    } else if (name === "golem") {
        yield api.wait(0.3);
        yield api.say("Cobb", "Whoever built that meant it to last forever. Forever ran out today.");
    } else if (name === "lich_king") {
        yield api.wait(0.4);
        yield api.say("Lara", "...That felt like it mattered more than the others. I don't know why yet.");
        yield api.say("Nettle", "Some things are guardians right up until the last second, and something else underneath that.");
    } else if (name === "minotaur") {
        yield api.wait(0.3);
        yield api.say("Vex", "That one wasn't guarding anything. It was just angry, and this was as far as the anger got it.");
    }
}
