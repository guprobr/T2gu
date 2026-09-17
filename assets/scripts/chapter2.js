// ============================================================================
// ShadowShine - Chapter 2: "Ada Town" (reformulated, 2026-09-15)
// ============================================================================
//
// Replaces "The Buried Court" stone-ruin theme entirely - Ada Town is a
// dirt-and-grass village (see assets/maps/chapter2.json's dirt_grass
// tileset, blob-autotiled with scattered grass patches over a dirt-
// dominant base), not a half-collapsed ruin. The entrance is a little
// forest (Ada Woods); the branching maze itself IS the town - its walls
// are houses, fences, market stalls, and wells instead of broken pillars,
// and its corridors are the town's own streets and alleys, abandoned to
// whatever's left roaming them now. Same underlying quest and companion as
// before (three fragments, found in any order, raise a real
// api.setBarrier gate; Vigil, the `dark_knight` bound to guard what's past
// it) and the same hostile roster (skeleton/skeleton_archer/ghoul/mummy -
// an abandoned town overrun by the dead reads exactly as coherently as an
// abandoned ruin did) - this is a re-theming of the setting, not a
// redesign of the chapter's mechanics.
//
// Map layout (assets/maps/chapter2.json):
//   - Ada Woods (the entrance): cols 2-26
//   - Ada Town (one maze, its walls are the town itself): cols 28-150, full playable height
//   - The Vault Gate + Vault: cols 152-165
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
    // connectivity.
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

function respawnCompanions() {
    if (api.getVar("vigil_recruited", false))
        api.spawnCharacter("dark_knight", 4, 45, 90);
}

function* onLevelStart() {
    api.spawnCharacter("lara_cyber", 3, 45);
    api.giveControl("lara_cyber");
    respawnCompanions();

    buildAdaWoods();
    buildAdaTown();
    raiseVaultGate();
    buildVault();

    if (api.getVar("chapter2_intro_seen", false))
        return;
    api.setVar("chapter2_intro_seen", true);

    yield api.wait(0.5);
    yield api.say("Lara", "Ada Town. Or what's left wearing the name - I can smell the dirt roads under all that quiet.");
    yield api.say("Hint", "Three fragments are hidden somewhere in the streets ahead - find all three to open whatever the town's been keeping shut.");
}

// Ada Woods - a little forest at the entrance, no maze here, just the last
// stretch of trees before the town's own streets take over. Basic
// supplies and a first breath of quiet before things get louder.
function buildAdaWoods() {
    api.spawnProp("notice_board", 8, 45);
    api.spawnProp("fallen_log", 14, 20);
    api.spawnProp("tree_stump", 12, 68);
    scatterOrganic(["pine_tree", "oak_tree", "bush", "wildflowers", "rocks_small"], 2, 24, 4, 86, 26, 22001, [
        { col: 8, row: 45 }, { col: 14, row: 20 }, { col: 12, row: 68 },
    ]);

    if (api.getVar("chapter2_loot_spawned", false))
        return;
    api.setVar("chapter2_loot_spawned", true);
    api.spawnItem("dried_rations", 6, 30);
    api.spawnItem("waterskin", 18, 70);
    api.spawnItem("whetstone", 10, 60);
    api.spawnItem("health_potion", 20, 30);
}

// Ada Town itself - one genuine branching maze (cols 28-150, full playable
// height) where the maze's own walls ARE the town: houses, a leaning
// tenement, a chapel, a smithy, and a chicken coop fill each wall block's
// interior; fences, a wrecked cart, and a rotted haystack fill the seam
// wherever a building actually meets the street. Populated directly in
// its own streets: undead hostiles (an abandoned town overrun by the dead
// reads exactly as coherently as an abandoned ruin did), three Keeper
// NPCs (each holding one of the three fragments, findable in any order -
// see onTalkTo/talkToKeeper), a hostage, and loot.
function buildAdaTown() {
    const coreObstacles = ["cottage_a", "cottage_b", "haunted_cottage", "leaning_tenement", "chapel", "chicken_coop", "blacksmith_forge"];
    const edgeObstacles = ["fence_straight", "fence_corner", "broken_fence", "wrecked_cart", "rotted_haystack"];
    const cells = buildBranchingMaze(28, 150, 1, 88, 2, 4, coreObstacles, edgeObstacles, 22101);

    // One shared, non-overlapping cell set for everything placed in the
    // maze - 34 hostiles + 3 Keepers + the hostage + 13 loot items (8
    // health potions - tripled from the original 2, per-level healing
    // supply pass - 2 general trinkets, and 3 originals) = 53 cells.
    const spots = sampleCells(cells, 53, 22102);
    let i = 0;

    if (!api.getVar("colonnade_hostiles_spawned", false)) {
        api.setVar("colonnade_hostiles_spawned", true);
        const hostileTypes = [
            "skeleton", "skeleton", "skeleton", "skeleton", "skeleton", "skeleton", "skeleton", "skeleton", "skeleton", "skeleton",
            "skeleton_archer", "skeleton_archer", "skeleton_archer", "skeleton_archer", "skeleton_archer", "skeleton_archer", "skeleton_archer", "skeleton_archer",
            "ghoul", "ghoul", "ghoul", "ghoul", "ghoul", "ghoul", "ghoul", "ghoul",
            "mummy", "mummy", "mummy", "mummy", "mummy", "mummy", "mummy", "mummy",
        ];
        hostileTypes.forEach(type => { api.spawnEnemy(type, spots[i].col, spots[i].row, 32); i++; });
    } else {
        i += 34;
    }

    // Three Keepers, each holding one fragment of the vault-seal - talk to
    // all three, in ANY order (unlike Chapter 4's terminal sequence), to
    // raise the gate. See onTalkTo/talkToKeeper().
    api.spawnNpc("gnome_wizard", spots[i].col, spots[i].row); i++;
    api.spawnNpc("harpy", spots[i].col, spots[i].row); i++;
    api.spawnNpc("tribal_elder_woman", spots[i].col, spots[i].row); i++;

    if (!api.getVar("hostage_spawned", false)) {
        api.setVar("hostage_spawned", true);
        api.spawnNpc("herbalist", spots[i].col, spots[i].row);
    }
    i++;

    if (api.getVar("colonnade_loot_spawned", false))
        return;
    api.setVar("colonnade_loot_spawned", true);
    api.spawnItem("small_ingot", spots[i].col, spots[i].row); i++;
    api.spawnItem("silver_coin_pouch", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("health_potion", spots[i].col, spots[i].row); i++;
    api.spawnItem("nail_pouch", spots[i].col, spots[i].row); i++;
    api.spawnItem("lockpick_set", spots[i].col, spots[i].row); i++;
    api.spawnItem("stamina_draught", spots[i].col, spots[i].row); i++;
}

// A real, mandatory barrier - down (blocking) until all three fragments
// are found, guarded here rather than left to a script race, so a reload
// before solving it re-raises the same gate.
function raiseVaultGate() {
    if (!api.getVar("vault_gate_open", false))
        api.setBarrier("vault_gate", 152, 0, 1, 90, true);
}

// The old counting-house vault, past the town proper - Vigil and the
// actual vault_sigil pickup both live here, placed unconditionally (the
// barrier itself, not a script check, is what keeps them out of reach
// until all three fragments are found).
function buildVault() {
    api.spawnProp("sunken_archway", 158, 45);
    api.spawnProp("moss_grown_altar", 162, 45);
    scatterOrganic(["rubble_pile", "runic_standing_stone"], 154, 165, 10, 80, 10, 22201, [
        { col: 158, row: 45 }, { col: 162, row: 45 }, { col: 160, row: 45 },
    ]);

    if (!api.getVar("vigil_recruited", false))
        api.spawnNpc("dark_knight", 160, 45);

    if (api.getVar("vault_loot_spawned", false))
        return;
    api.setVar("vault_loot_spawned", true);
    api.spawnItem("vault_sigil", 163, 45);
    api.spawnItem("health_potion", 156, 30);
}

function* onTalkTo(name) {
    if (name === "dark_knight") {
        yield* talkToVigil();
    } else if (name === "gnome_wizard" || name === "harpy" || name === "tribal_elder_woman") {
        yield* talkToKeeper(name);
    } else if (name === "herbalist") {
        yield* rescueHostage();
    }
}

function* talkToVigil() {
    const timesTalked = api.getVar("vigil_talks", 0);
    api.setVar("vigil_talks", timesTalked + 1);
    api.playSound("select");

    if (timesTalked === 0) {
        yield api.say("Vigil", "Guardian. Awakened. State your need.");
        yield api.say("Lara", "...You've been standing here the whole time we were solving the town's own front door.");
        yield api.say("Vigil", "Longer than I've kept count of. The three answered for you. That is enough to open it - it was never enough to let me leave on my own.");
    } else {
        yield api.say("Vigil", "The town is answered. My garrison is not coming back for me, and this vault was never really what I was guarding. I'll carry what's left of it, if you'll have the weight.");
        api.despawnNpc("dark_knight");
        api.spawnCharacter("dark_knight", 158, 45, 90);
        api.setVar("vigil_recruited", true);
        api.playSound("select");
    }
}

// Order-independent: talk to all three Keepers, in any order, to raise
// the vault gate. Unlike Chapter 4's terminal sequence, getting the ORDER
// right doesn't matter here - only finding all three does.
function* talkToKeeper(name) {
    const displayName = { gnome_wizard: "the Wizard", harpy: "the Harpy", tribal_elder_woman: "the Scholar" }[name];
    const already = api.getVar(`fragment_${name}`, false);
    api.playSound("select");

    if (api.getVar("vault_gate_open", false)) {
        yield api.say(displayName, "*the fragment is already given*");
        return;
    }

    if (already) {
        yield api.say(displayName, "You already carry what I had to give.");
        return;
    }

    api.setVar(`fragment_${name}`, true);
    if (name === "gnome_wizard")
        yield api.say("the Wizard", "I warded this piece so well I forgot the warding was mine to lift. Here - it never liked me much anyway.");
    else if (name === "harpy")
        yield api.say("the Harpy", "*tilts her head* I only ever nested in what was already empty. Here. I never wanted it, just kept it safe.");
    else
        yield api.say("the Scholar", "I came to study this town's old records and stayed to guard a grief instead. Take the last piece - someone should finally use it.");

    const count = ["gnome_wizard", "harpy", "tribal_elder_woman"].filter(n => api.getVar(`fragment_${n}`, false)).length;
    if (count === 3) {
        yield api.wait(0.3);
        yield api.say("Lara", "Three pieces, three keepers. That's the whole answer, isn't it.");
        api.setBarrier("vault_gate", 152, 0, 1, 90, false);
        api.setVar("vault_gate_open", true);
        api.giveExperience(80);
        api.playSound("select");
    }
}

function* rescueHostage() {
    if (api.getVar("hostage_rescued", false)) {
        yield api.say("Herbalist", "Still grateful, truly.");
        return;
    }
    api.setVar("hostage_rescued", true);
    api.playSound("select");
    yield api.say("Herbalist", "You found me. I came for the herbs still growing wild in the old garden plots - they hold medicine nothing else does - and lost the way out three days ago.");
    yield api.say("Lara", "Three days?");
    yield api.say("Herbalist", "Felt like three days. Might've been one. Either way - the way back is west of here, if the dead have moved on.");
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

    if (name === "skeleton" || name === "skeleton_archer") {
        yield api.wait(0.3);
        yield api.say("Lara", "Whatever kept it standing this long, it isn't malice. Just habit, maybe - the same street, over and over.");
    } else if (name === "ghoul") {
        yield api.wait(0.3);
        yield api.say("Lara", "Hungry, and past caring why. This town hasn't fed anything living in a long time.");
    } else if (name === "mummy") {
        yield api.wait(0.3);
        yield api.say("Lara", "Someone wrapped that with real care, once. Doesn't make it safe to leave walking the streets.");
    }
}

function* onItemCollected(itemId) {
    if (itemId !== "vault_sigil")
        return;

    yield api.wait(0.3);
    yield api.say("Lara", "This was never a lock. It's a promise someone sealed shut instead of keeping.");
    yield api.say("Vigil", "A promise I was left to hold, whether or not anyone ever came back for it. You came back for it.");
    yield api.say("???", "The seal was never yours to break, and yet - here we are. You're closer than the last one who tried this door.");
    yield api.say("Lara", "There's always a last one who tried, with you. Who were they?");
    yield api.say("???", "Someone who stopped at the door. This town's floor isn't the end of it - go find what it's standing on.");

    api.setVar("chapter", 3);
    api.playSound("select");
    yield api.wait(0.8);
    api.loadLevel("chapter3.json");
}
