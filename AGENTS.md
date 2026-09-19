# AGENTS.md — ShadowShine / T2gu

This file orients an agent (or a new human contributor) working in this
repository: what the project is, how it's built, the architectural
decisions already made and why, and the conventions that keep the codebase
consistent across many separate editing sessions. Read this before making
structural changes; read `docs/SCRIPTING.md` before touching the
scripting/`api.*` surface specifically.

## What this is

**ShadowShine** (working title, was "Umbraloom") is a from-scratch C++/Qt6
rewrite of an old C/SDL2 isometric RPG engine (`T2gu-legacy/`, kept for
historical reference only — not built, not touched). The engine and the
100-chapter story it runs are being built together, chapter by chapter, in
the same repository. There is no design doc for the full story; continuity
lives in the actual chapter scripts (source of truth) plus the project's
own memory notes from prior sessions.

## Build & run

```sh
cmake -S . -B build          # defaults to Release (-O3, -march=native, LTO)
cmake --build build -j$(nproc)
./build/T2gu2
```

- Requires Qt6 (Widgets, Qml, Multimedia).
- `ASSET_DIR` is a compile-time absolute path baked in via
  `target_compile_definitions` (`${CMAKE_SOURCE_DIR}/assets`) — the
  installed binary is not relocatable by itself; see the save-format note
  below for how saves avoid depending on this.
- `T2GU_MAP_PATH` env var overrides which map boots first (defaults to
  `chapter1.json`) — use it to jump straight into any map/chapter or the
  sandbox without recompiling or playing through.
- Headless/CI-style sanity check (no window, no input, but a full scene
  construction + a few seconds of simulation): `QT_QPA_PLATFORM=offscreen
  ./build/T2gu2`. This is the actual verification method used throughout
  this project's history — run it per chapter after any change that
  touches level generation, combat, or scripting, and check for zero
  warnings:
  ```sh
  for ch in 1 2 3 4 5 6; do
    timeout 8 env QT_QPA_PLATFORM=offscreen T2GU_MAP_PATH="assets/maps/chapter$ch.json" ./build/T2gu2 2>&1 | grep -iE "error|warning|fatal|assert"
  done
  ```
  **Watch memory when testing.** A character's sprite sheet is
  4480×10120 RGBA — ~181 MB decoded — so `SpriteSheet::load()` decodes it
  once, keeps only each frame's non-transparent bounding box
  (`SpriteSheet::Frame`: trimmed pixmap + offset within the cell, ~14–69 MB
  per character, ~56 MB mean) and drops the sheet. Measured once settled
  (RSS flat for several seconds — a fixed-time sample catches a chapter
  mid-load and under-reports, which an earlier version of these numbers
  did): chapter 4 849 MB (was 2,453 MB); `sandbox.json`, which loads the
  *entire* 115-character roster into the party, 6.4 GB after ~68 s of
  loading (was ~20 GB). Still enough
  to hurt on a small machine, and to push a 32 GB one into swap and make
  timing measurements meaningless — so never run the sandbox unguarded:
  poll `/proc/<pid>/status` `VmRSS` and kill it past a few GB, and read
  timing numbers only from runs that stayed clear of swap.
  **Considered and declined (2026-09-19):** baking trimmed per-frame PNGs
  offline and decoding lazily would cut a chapter to ~0.15–0.35 GB and skip
  the full-sheet decode, but a session that exercises every animation
  (sandbox `K` parade, Tab through the roster) would slowly decode
  everything again and drift back to the current figures unless the frame
  cache were also capped (LRU). The owner judged the current memory well
  optimized and chose not to take on that pipeline step. Lossless PNG
  recompression was measured too and gains nothing (RAM depends on decoded
  pixels, not file size); 256-colour palettes decode 4× faster but visibly
  shift colours (e.g. the hero's goggle lens), so they need art sign-off.
  **Sprite rendering contract:** `Character::boundingRect()` is always the
  full cell (`SpriteSheet::cellSize()`), not the trimmed pixmap actually
  drawn — the feet anchor, shadow, health bar, selection marker and
  level-up text are all laid out against the cell. Anything needing a
  whole-cell image (the UI portrait) uses `SpriteSheet::paddedFrame()`,
  which composes it on demand. Verified pixel-identical to the old full-
  cell path across all 115 characters, every frame, both orientations.
  There is no unit test suite and no live-input test framework. Verifying
  actual keyboard/mouse interaction requires a real (or nested) X11
  display and synthetic input (XTest) — this has proven flaky in sandboxed
  environments (unpredictable input delivery, occasional `BadMatch` on
  `SetInputFocus`); prefer the headless method above for anything that
  doesn't specifically require live input, and don't take an X11 test's
  silence as proof of a bug — retry once before concluding.

## Source layout

```
src/            all C++ (flat, no subdirectories)
  Version.h     `kGameVersion`, the game's version string. Bump it here
                AND in README.md (the line right below the screenshot)
                together on every release; main.cpp registers it with Qt
                via `setApplicationVersion()`
assets/
  characters/   one subdirectory per roster entry (135 currently), each a
                sprite sheet PNG + JSON sidecar; stats.json and
                sounds.json are flat catalogs keyed by roster name
  props/        props.json catalog (nested under a "props" key, not flat)
                + one PNG per entry; borders.json/walls.json map a
                tileset/wallTheme name to a border prop list
  items/        items.json catalog (nested under "items")
  tilesets/     blob-autotile PNGs + JSON sidecars (10-tile row-major:
                see "Tilesets" below)
  maps/         one JSON per chapter (`chapterN.json`) + sandbox/test maps
  scripts/      one JS file per chapter (`chapterN.js`), loaded by the map
                JSON's own "script" field
  audio/        music + sfx
tools/          one-off Python asset-pipeline scripts (sprite refit/align/
                upscale) — see "Asset pipeline" below
docs/
  SCRIPTING.md  the actual `api.*` reference — keep this in sync any time
                the script-facing surface changes
```

## Architecture

Qt's own object graph *is* the ownership graph — there is no separate
scene-graph or entity-component system layered on top.

- **`MainWindow`** — the `QMainWindow`. Owns `GameState` (the only thing
  that survives a level transition), the current `GameScene`, and every
  chrome widget (dialogue box, inventory, death menu, loading overlay,
  debug HUD). Handles all keyboard input and dispatches into `GameScene`.
- **`GameScene`** (`QGraphicsScene`) — one instance per loaded map/chapter,
  destroyed and replaced wholesale on every level transition (see "Level
  transitions" below), never reused or mutated into a different map.
  Owns the `TileMap`, every `Character`/`Prop`/`WorldItem` currently in
  the scene, the `ScriptEngine` + `ScriptBridge` pair running that
  chapter's script, and all per-tick simulation (movement, combat AI,
  the fireball system, item pickups).
- **`Character`** (`QGraphicsPixmapItem`) — party member, enemy, or NPC;
  which one it *is* is purely which of `GameScene`'s own containers
  (`m_party`/`m_enemies`/`m_npcs`) holds it, not a type on the class
  itself. Owns its own animation/movement/HP/stat state.
- **`Prop`** (`QGraphicsPixmapItem`) — a static decorative/blocking object
  *or* a world item pickup; again, which one is purely which container
  (`m_props` vs `m_worldItems`) holds it, not a distinct class.
- **`ScriptEngine`** — owns one `QJSEngine` and drives exactly one
  generator-coroutine at a time (see "Scripting" below).
- **`ScriptBridge`** — the `QObject` installed as the JS-visible global
  `api`; a thin pass-through to `GameScene`, kept as its own class purely
  so the script-facing surface is visibly distinct from `GameScene`'s
  internal C++ API.
- **`AudioManager`** — thin wrapper over `QMediaPlayer`/`QAudioOutput` for
  music (looped, cross-fadeable) and one-shot sfx.

## Scripting system

Full reference: `docs/SCRIPTING.md`. Architectural points worth knowing
before touching `ScriptEngine`/`ScriptBridge`:

- A chapter script is plain JS, evaluated once at scene construction. The
  engine calls named **entry points** (`onLevelStart`, `onTalkTo`,
  `onEnemyDefeated`, `onPlayerDied`, `onItemUsed`, `onItemCollected`) by
  looking up a global function of that name — every one is optional, a
  missing one is a no-op, not an error.
- An entry point may be a plain function (runs to completion immediately)
  or a `function*` generator that `yield`s `api.wait(seconds)` or
  `api.say(speaker, text)` to pause — `ScriptEngine` drives the generator
  one `.next()` step at a time from `onTick()` (for a timed wait) or
  `advance()` (for a dialogue box being dismissed).
- **Only one coroutine runs at a time**, by design — but a second
  `callEntryPoint()` while one is active is **queued**, not dropped. This
  was a real, silent bug until 2026-09: an `onLevelStart` with `yield
  api.wait(...)` would eat every enemy kill / item pickup / conversation
  that happened during the wait. If you ever see `ScriptEngine::callEntryPoint`
  short-circuit on `m_state != Idle` without enqueuing, that's a
  regression — see `m_pendingCalls`/`runNextPendingCall()`.
- Level generation (`buildBranchingMaze`, `scatterOrganic`, `mulberry32`)
  is copy-pasted verbatim into every chapter script rather than shared via
  a module, because scripts can't `import`/`require` each other in this
  engine. When fixing a bug in one of these, grep for the same function
  name across all 6 `chapterN.js` files — they're expected to be
  identical (`awk '/^function X/,/^}/' fileA | md5sum` vs `fileB` is the
  fast way to confirm before/after a fix stayed in sync).
- Every generator/scatter function takes a `seed` and uses `mulberry32`
  (not `Math.random()`) so level layout is exactly reproducible run to
  run — a placement bug is then a "run it once, verify, trust forever"
  fix rather than a flaky one. `Math.random()` is fine (and used) for
  genuinely cosmetic, non-deterministic runtime flavor (e.g. the rare
  post-kill quip lines in `onEnemyDefeated`) — the determinism rule is
  about level *layout*, not every random number in the file.

## Level generation conventions

Every chapter follows the same macro-shape: a small entrance pocket (plain
`scatterOrganic` decoration, no maze) → one whole-map `buildBranchingMaze`
(a real branching structure — recursive-backtracker spanning tree + a 15%
braid pass for extra loops, not a single corridor) → optionally one small
distinct climax pocket for a real narrative set-piece (a boss, a gated
vault). Don't reintroduce the old segmented/multi-zone pattern without
being asked — this shape was arrived at after several rounds of explicit
user feedback rejecting straight corridors, then single curvy corridors,
then segmented mazes.

- `buildBranchingMaze`'s wall filling is split into `coreObstacles` (one
  big set-piece type per whole contiguous wall block — trees, buildings,
  boulders, whatever fits the theme) and `edgeObstacles` (small props,
  independently rolled per tile, only at the seam where a wall actually
  touches a corridor). **This split exists specifically so oversized
  decorative props are safe to use as wall material** — an earlier version
  let big props (150px+ wide against a much smaller tile) sit directly
  adjacent to the walkable corridor and visually bury the hero/nearby
  entities under overlapping sprite art. Never flatten this back into one
  `obstacles` list.
- Every entity placed inside one maze (hostiles, riddle-keeper NPCs, the
  hostage, loot) is drawn from **one shared `sampleCells(cells, totalCount,
  seed)` pool**, sliced by a running index (`let i = 0; ...; i++`) — this
  makes tile collisions between two placements structurally impossible
  (sampling without replacement), not just unlikely. Never call
  `sampleCells` twice independently against the same maze's `cells`.
- Reskinning a chapter's theme (a new biome, new tileset) is almost always
  just swapping `coreObstacles`/`edgeObstacles`/`scatterOrganic` prop
  lists into this same machinery — not a reason to touch
  `buildBranchingMaze` itself.
- Every prop name used must exist in `props.json` (or `items.json` for
  `spawnItem`) — a plausible-sounding name that doesn't exist fails
  silently at runtime (`qWarning`, no crash) rather than at edit time, so
  check the catalog before writing a `spawnProp`/`spawnItem` call, not
  after.

## Tilesets

Each tileset is a 10-tile row-major blob-autotile sheet: `0`=primary
terrain, `1..4`=primary-with-secondary-on-one-cardinal-side (N/S/E/W),
`5..8`=primary-with-secondary-on-two-*adjacent*-cardinal-sides
(NW/NE/SW/SE), `9`=pure secondary terrain. A map's `"base"` field is a
`height`×`width` grid of these indices. Before generating a new map's base
layer from scratch, validate any autotile algorithm against an *existing*
map's real data (reconstruct the secondary-terrain mask from its `9`
tiles, run the algorithm, diff against the real grid) rather than trusting
the tileset JSON's prose comment alone — this caught nothing wrong the one
time it was done, but it's the right way to gain confidence in a
reimplementation of an established-but-undocumented-in-code convention.
`TileMap::isWalkable()` only actually blocks movement on whichever index
is named `"water"` in that tileset's own JSON (`tiles.water`) — every
other tileset's index-9 terrain is purely decorative.

## Asset pipeline

- All world-pixel distances (movement speed, attack reach/radius, shadow
  offsets, UI element sizes tied to sprites) were doubled once, together,
  when every sprite/tile/prop asset was baked to 2x its original pixel
  size (`tools/upscale_2x.py`) to get a "bigger, closer" look without
  paying a runtime camera-zoom transform (Qt's software rasterizer has no
  fast path for a non-identity view transform — profiled, not assumed).
  Any *new* world-pixel constant should be sized relative to the current
  (already 2x) tile size (128px) and existing constants, not re-derived
  from pre-2x numbers.
- Character sprite sheets are bottom-anchored with real transparent margin
  above/around the character (`tools/refit_sprites.py`) — never assume a
  frame's raw bounding box is the character's actual visible silhouette;
  use `SpriteSheet::feetFraction()`/`topFraction()` (measured constants,
  re-measure if the refit margin ever changes) or, for a *prop*, the
  per-asset measured content bounds (`Prop`'s own `measureFeetFraction()`
  equivalent) — prop art has no uniform pipeline the way characters do, so
  a single hardcoded fraction across all props is wrong (this was a real
  bug: items/props with unusual padding rendered with a floating or
  entirely invisible ground shadow until fixed).
- A prop/item's *rendering* z-order is its own ground-contact world Y —
  except world item pickups, which get a large fixed z-boost on top of
  that (`kItemZBoost` in `GameScene.cpp`) so a large decorative prop
  standing at a slightly greater Y can never visually swallow an item
  sitting on a nearby (but tile-distinct) open cell — this is a real bug
  that made at least one chapter's key item invisible before the fix.

## Party movement

- A following (non-fighting) party member does **not** pathfind to the
  leader. `GameScene::updateLeaderTrail()` records the controlled
  character's feet positions (`m_leaderTrail`), and `followTrail()` walks
  each follower to the spot `(index + 1) * kPartyTrailSlotSpacing` pixels
  of trail behind it. This works because collision is one feet-point test
  shared by every character (`Character::isBlocked`), so anywhere the
  leader stood is walkable for a follower — unlike the tile-center grid in
  `findPath()`, which can disagree with real collision and wedge a
  character (the reason `m_temporarilyBlockedCells` exists).
- `findPath()`/`moveAlongPath()` (A*) still run for **combat chases** and
  as the **rejoin fallback** when no trail point is reachable (after a
  fight, a control switch, or a barrier across the trail). Don't delete
  them.
- Once the leader has stood still for `kPartyCrowdSettleSeconds`,
  followers that can see it and are inside the crowd area stop lining up
  and `shuffleInCrowd()` idles them in a loose crowd: short random steps
  that keep `kPartyCrowdSpacingX`/`Y` clear of every other member (a
  conflict needs both axes too close, so clear on either is enough).
  Followers outside the area or without a line to the leader keep
  following the trail toward `kPartyCrowdGatherArc`.
- **Never gate stopping on a single threshold.** A follower keeping pace
  with a moving leader hovers right at any one stop/go distance, and
  flipping between stopped and moving every tick or two is not just
  jittery: `Character::tick()` resets the walk cycle to frame 0 on every
  zero-velocity tick, so the animation never gets past its first frames
  (measured: ~15 stops per follower per second, with the old radius check
  too). `followTrail()` therefore (a) never stops for a *moving* leader's
  slot — it eases its speed down to `kPartyTrailMinSpeedFactor` near it
  instead — (b) holds for a *still* leader's slot with different
  enter/exit distances (`PartyPath::trailHolding`), and (c) only waits
  when standing ahead of or beside a leader that's walking toward it.
- A trail that has just started (control switch, level load, teleport) is
  shorter than the furthest follower's slot. `updateLeaderTrail()`
  extends it with a straight virtual tail behind the oldest point
  (`m_trailTailDir`/`m_trailTailLength`, stopping at the first wall), used
  only while the leader is walking, so followers line up behind it
  immediately instead of all converging on the spot it started from. A new
  leader is assumed still until it moves, and `switchTo*`/`giveControl`
  clear the old leader's run flag (only the controlled character's is
  ever refreshed).
- The trail restarts whenever the leader changes or jumps more than
  `kPartyTrailTeleportDistance` in one tick (level load, snapshot
  restore, script teleport), and `destroyEntity()` clears it if the leader
  is deleted.

## Combat

- `playerDied()` means the **currently controlled** character is dead
  when damage is resolved, not that the whole party is dead or that a
  projectile's original target was controlled at launch. Keep this rule
  in `notifyPlayerDeathIfNeeded()` for every damage path. A dead follower
  cannot receive control via Tab, C, or `api.giveControl`.
- Melee hit-testing (`Character::isWithinMeleeReach`) is a **plain
  circular distance check**, not a facing-direction-gated rectangle. It
  used to be a narrow (~104px) rectangle extending only along whichever
  single cardinal axis the attacker's last movement favored — a target
  genuinely within an AI's own "close enough, swing" radius check but at
  enough of a diagonal angle from that axis would still whiff. Never
  reintroduce facing-direction-dependence into the actual hit test; if a
  future feature wants directional melee, it needs its own explicit
  design, not a revival of the old rectangle.
- Any `kXAttackRadius`/`kXAttackReach` pair (party/enemy/player) must keep
  **reach ≥ radius, with real margin** — radius is the AI's "stop and
  swing" distance decision, reach is the actual hit-test distance; if
  reach can be smaller than the radius that approved the swing, every
  swing from that gap is a geometrically guaranteed whiff regardless of
  the circular-vs-rectangle fix above.
- The fireball magic system (`GameScene::updateFireballCasting`/
  `castFireball`, `FireballItem`) gates on total Intelligence
  (`kFireballMinIntelligence`), then scales cooldown/damage/visual size
  linearly above that threshold. The controlled character is deliberately
  **excluded** from the automatic per-tick casting loop — only followers
  and hostiles cast automatically; the controlled character casts only on
  a dedicated key (F). This isn't an oversight: including the controlled
  character in the automatic loop means it claims the shared cooldown the
  instant it's ready, every tick, before the player can ever press
  anything — the manual key then always lands on "already on cooldown"
  and reads as a broken button. Keep this split if the system grows.

## Save/load

Single quicksave slot at `~/.T2gu2/save.json` (F5 saves, F8 loads, F9
kills the controlled character on the spot for a fast respawn/quit).
F5 is ignored while a script (including queued entry points), dialogue,
level transition, or death menu is active: coroutine continuations are
not saved. Do not replace an active dialogue with a save/refusal message
or defer that save to a different scene. F8 and gameplay input are also
ignored during level transitions.
`GameState` (vars/inventory/level/experience/stat bonuses) plus a full
`GameScene::SceneSnapshot` (exact party/enemy/NPC/item positions and HP)
round-trip through JSON — a chapter's own `*_spawned` guard vars alone can
only block re-spawning a whole batch outright, never track which
*individual* members survived, hence the separate snapshot.

- Written via `QSaveFile` (atomic: writes to a temp file, replaces the
  real one only on a successful `commit()`) — never regress this back to
  a plain `QFile` that truncates the previous save immediately on open.
- Loaded with an explicit `QJsonParseError` check — a corrupt/truncated
  file must produce a clear "save is corrupt" message, not silently
  become an empty `QJsonObject` that fails confusingly later.
- Carries a `"saveVersion"` field (current: `1`). A missing version is
  treated as `1` (pre-dates the field); a version *newer* than
  `kCurrentSaveVersion` is rejected with a message rather than
  partially-loaded. Bump this when the save JSON's *shape* changes in a
  way that needs a migration decision — not for every new field, since
  every field is already read as individually optional
  (`QJsonValue::toX(default)`).
- Stores the map as **just its filename** (`"map": "chapter4.json"`),
  resolved against this install's own `ASSET_DIR` on load — not the full
  `m_currentMapPath`, which is normally built from the compile-time
  `ASSET_DIR` and would otherwise tie a save file to the exact
  source/build tree it was written on. (`"mapPath"`, a full path, is kept
  as a read-only fallback so a save written before this change still
  loads.)
- Every individual enemy/NPC/pickup deletion goes through `destroyEntity()`
  after removing it from its population container. Its shared
  `beforeEntityDestroyed()` hook clears selection (including a hidden
  marker still parented to a deselected entity), name lookups, pending
  projectile targets, and combat/AI caches. Keep this common path for
  corpse cleanup, NPC despawn, item collection, and snapshot restoration;
  do not add separate pointer-cleanup rules at the call sites. Name
  eviction must still preserve a newer same-named enemy's live lookup.

## Level transitions — no nested event loops

`MainWindow::loadLevel()` shows a loading overlay for a fixed ~1s (purely
cosmetic — scene construction itself is fast), then swaps `GameScene`
instances. **This delay must never be a nested `QEventLoop`** (a
`blockFor()`-style `loop.exec()` after a `QTimer::singleShot`). It was
originally implemented that way, and it's a real reentrancy hazard, not
just an odd style choice: `loadLevel()` is very often called *from inside*
a script callback (`api.loadLevel()` → `GameScene::onTick()` →
`ScriptEngine` → the JS call itself, all still on the C++ stack). A nested
event loop at that point keeps Qt's timer/signal delivery running,
including the *old* scene's own 16ms tick timer — which can reenter the
very `QJSEngine` call still suspended on the stack. This project has
already hit real heap corruption from two `QJSEngine`s active
concurrently during a transition (see the historical comment on
`GameScene::stopTicking()`); a nested event loop here was another route to
that same failure mode.

The current shape: `loadLevel()` synchronously disconnects and stops the
*old* scene's ticking immediately (not after any delay), then schedules
the actual scene swap via a plain `QTimer::singleShot(1000, ...)` calling
`finishLoadingLevel()` — a real deferred callback through Qt's own event
loop, never a second nested loop on top of it. `m_levelTransitionPending`
guards against a second `loadLevel()` call landing mid-transition.
Anything that needs to run *after* the new scene's own deferred
`onLevelStart()` (which `GameScene`'s constructor itself queues via
`singleShot(0)`) — currently only `loadGame()`'s snapshot restore — can no
longer just capture `m_scene` right after calling `loadLevel()`, since
that call now returns before the swap happens. Use
`m_afterNextSceneReady` (a `std::function<void()>` consumed exactly once
by `finishLoadingLevel()` right after constructing the new scene) instead
of any new ad hoc synchronous-completion assumption.

## Known limitation, not yet worth fixing

`GameScene::m_charactersByName` (`QHash<QString, Character*>`) is keyed by
roster name for party/NPC lookups (`giveControl`, `despawnNpc`), where a
name genuinely identifies one entity — but `scriptSpawnEnemy` inserts into
the *same* table, and enemies are explicitly allowed to repeat a name
(`spawnEnemy("orc")` three times is fine, unlike party/NPC spawns, which
refuse a duplicate). The table is therefore serving two different concepts
(unique entity identity vs. creature archetype) through one keyspace,
where every enemy of the same type overwrites the previous one's entry.
This works today because nothing currently does `giveControl("orc")` or
otherwise expects a name-based lookup to resolve a *specific* enemy
instance — but if a future feature needs that (a named unique boss
tracked by ID, "target the same orc I just talked to"), the fix is a
separate `entityId`/`archetype` distinction (e.g. `orc_0042` as the table
key, `"orc"` as a separate archetype field), not a workaround bolted onto
the current name-as-both-things scheme.

## Coding conventions

- **Comments explain *why*, never *what*.** A comment restating what the
  next line obviously does is not wanted; a comment explaining a
  non-obvious invariant, a past bug it prevents, or a constraint that
  isn't visible from the code itself is expected, especially on any
  `constexpr` tuning constant (see how `kEnemyAttackRadius`/
  `kFireballMinIntelligence`/etc. are documented in `GameScene.cpp` — the
  *reasoning*, not just the number).
- No dead code, no speculative abstraction, no "just in case" parameters.
  When a refactor makes something genuinely unused (a whole class, an
  enum, a field), delete it completely in the same change — don't leave
  it commented out or unreferenced "for later."
- Match existing patterns before introducing a new one. If two nearly-
  identical implementations already exist across files that can't share
  code (the 6 chapter scripts), a third one should look exactly like the
  other two, not introduce a stylistic variant.
- Prefer measuring over guessing. Several bugs in this project's history
  were root-caused by directly checking real data (pixel-sampling a
  screenshot to prove a shadow was actually absent, not "looks about the
  same"; diffing a new algorithm's output against an existing verified
  map) rather than trusting a plausible-sounding assumption. When in
  doubt about whether something is actually broken, check the pixels/data
  before writing the fix.
