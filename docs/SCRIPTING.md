# T2gu scripting

T2gu levels/adventures are programmed in **plain JavaScript**, run through Qt's
embedded `QJSEngine`. There is no custom syntax to learn - it's real JS (variables,
`if`/`else`, loops, functions, generators) plus a small `api.*` surface of game
commands documented below.

This file is the reference for that `api.*` surface and the entry points a
script can define. **Keep it in sync with the code** - whenever
`src/ScriptBridge.h`, `src/ScriptEngine.h`, or the set of entry points
`GameScene` calls changes, update this file in the same change.

## Attaching a script to a map

Add a `"script"` field to the map's JSON, resolved relative to the map file
itself (same convention as `"tileset"`):

```json
{
    "tileset": "../tilesets/grass_water.json",
    "script": "../scripts/chapter1.js",
    ...
}
```

A map without a `"script"` field behaves exactly as before - scripting is
opt-in per map.

**Two maps ship with the engine, for two different purposes:**

- `assets/maps/chapter1.json` / `assets/scripts/chapter1.js` - the real
  adventure's actual entry point (`GameScene`'s default map). Start here for
  a template of what a real chapter looks like: spawn the hero, spawn an
  NPC, a few props, tell a small story.
- `assets/maps/sandbox.json` / `assets/scripts/sandbox.js` - the original
  engine-development proof of concept (full 135-character roster showcase
  grid, full props showcase grid, hand-authored village/nature areas, 4
  fixed enemies). Opts into all of that legacy auto-spawn behavior via a
  `"sandbox": true` field in its map JSON - **no real chapter should ever set
  this**, it exists purely so that showcase content keeps working as a
  reference/testbed without cluttering every real level. See
  `GameScene`'s constructor for exactly what `"sandbox": true` turns on.

**Map borders/walls** are also automatic, not scripted: `GameScene` rings
every non-sandbox map's outer tile perimeter with props on load
(`decorateMapEdges()`), so a chapter gets the impression of a horizon at its
edges for free. A map is exterior by default - its border is looked up by
the `"tileset"` field's own base name in `assets/props/borders.json`. To
mark a map as an *interior* instead (walls, not a horizon), add:

```json
{
    "interior": true,
    "wallTheme": "stone_archive",
    ...
}
```

`wallTheme` is a free-form key into `assets/props/walls.json` - not tied to
any particular tileset, since an interior's floor tileset and its wall
theme are independent choices. Either catalog can simply have no entry for
a given tileset/theme (a safe no-op) while more sets are still being
built out.

**Ambient lighting** is another opt-in map field, independent of
`interior`/`wallTheme` - it tints the *entire* scene (tiles, props,
characters, everything) with a translucent color wash to sell a mood, the
same way real light would:

```json
{
    "lighting": "mystical"
}
```

One of `"sunrise"`, `"sunset"`, `"torch"`, `"cavern"`, or `"mystical"` (see
`LightingOverlayItem::paint()` for exactly what each looks like - a warm
directional gradient with a slow-breathing glow for sunrise/sunset, a
flickering warm wash for torch-lit interiors, a cool dim vignette for
underground caverns, or a slowly hue-shifting glow for arcane/magical
spaces). Omitted or unrecognized means no overlay at all - nothing is even
constructed, so a map that doesn't ask for this pays nothing for it. It's a
single whole-map mood, not a positional light source - there's no way to
place one at a specific torch prop's location, and no plan to add that (a
real per-light simulation is a different, much heavier feature than "tint
the scene"). Pick a mode for the chapter's actual mood, not for variety's
sake - reusing a mode across chapters that share a mood is fine. Current
example: `chapter1` (Fernhollow, the story's literal morning start) uses
`"sunrise"`.

**`title`** is an optional, purely cosmetic map field - a display name shown
on the black "Loading" screen (see `MainWindow::loadLevel()`) during a
transition into that map, under the word "Loading" in smaller text:

```json
{
    "title": "Chapter 2: The Buried Court"
}
```

Omit it (as `sandbox.json` and the tileset test maps do) and the loading
screen just shows "Loading" on its own, no second line. Every real chapter
map (`chapter1.json` through `chapter6.json`) sets this.

## The `api` object

`api` is a **global**, not a function parameter - scripts reference it
directly, they don't receive it as an argument to their entry points.

### Immediate commands

These run synchronously and return right away. Call them any time, inside or
outside a generator - no `yield` needed.

`spawnCharacter`/`spawnEnemy`/`spawnNpc`/`spawnProp`/`spawnItem` below each also
play a short "select" cue the instant they place something - a script never
needs to call `playSound` itself just to signal a spawn. This is scoped to
these `api.*` calls specifically (in `ScriptBridge`, not the shared
`GameScene` helpers underneath), so it does *not* fire for the map's own
non-narrative bulk decoration (the border/wall ring, sandbox showcase grids,
hand-authored layouts) - only script-triggered spawns get the cue. A random
enemy-loot drop (see "Random enemy loot" further down, under Items and
inventory) plays the same cue too, even though nothing in the script caused
it directly.

| Call | Effect |
|---|---|
| `api.spawnCharacter(name, col, row, hp = 0)` | Spawns a new **party-controllable** character at tile `(col, row)`. Added to the Tab/click-to-select roster. Strength/Speed (see below) come along automatically. `hp <= 0` (the default - omit it) means "use `GameState::heroBaseMaxHp`" (200 for a new game, persists across level transitions/saves) rather than a fixed number - every chapter's own `lara_cyber` spawn call relies on this so her max HP can actually progress instead of being reset to a literal every chapter. A companion should still pass its own explicit `hp` (its fixed archetype toughness), same as every existing one does. |
| `api.spawnEnemy(name, col, row, hp = 40)` | Spawns a hostile character at tile `(col, row)` with simple chase/attack AI (see `GameScene::updateEnemyAI`). Strength/Speed (see below) come along automatically. |
| `api.spawnNpc(name, col, row)` | Spawns a non-hostile, non-controllable character just standing/idling in the world - a friend or guide to talk to (see `onTalkTo` below and the **E** key). Never gets a health bar and can't be attacked. |
| `api.despawnNpc(name)` | Removes a previously-spawned NPC - e.g. right after "recruiting" them into the party with `spawnCharacter`, so the same person doesn't stand around twice. No-op if no NPC with that name exists. |
| `api.spawnProp(name, col, row)` | Places a prop (from `assets/props/props.json`) at tile `(col, row)`. Width and whether it blocks movement come from the props catalog, same as every other prop. Pressing **E** near it (and no NPC closer - see `onTalkTo` below) shows its catalog `name`/`description` as an examine message - purely data-driven, engine-handled via `showInfoMessage()`, no script entry point involved. Every prop in the catalog has both fields; a hand-added prop missing them just won't show anything on examine. |
| `api.spawnItem(itemId, col, row)` | Places a world pickup (from `assets/items/items.json`) at tile `(col, row)`. Auto-collected - added to the inventory, removed from the world, `onItemCollected(itemId)` fired - the instant the player walks within pickup range. No key needed. |
| `api.setTileset(relativePath)` | Re-skins the *entire current map* with a different tileset (path relative to the map's own directory), keeping the base/obj grid layout as-is. Only safe because every generated tileset shares the same index convention (grass = index 0, a `"water"`-named tile always exists, etc). |
| `api.setTile(tileName, col, row)` | Overwrites a single base-layer cell with the named tile from the *current* tileset. |
| `api.setBarrier(id, col, row, width, height, blocked)` | An invisible rectangular movement barrier, `width`x`height` tiles starting at `(col, row)` - for physically gating a path behind a story beat (not just under-decorating it - see below). Call again with the same `id` and `blocked=false` to lift exactly that barrier later; a second `true` call with an id already up is a no-op, not a duplicate. |
| `api.giveControl(name)` | Switches player control to the named party character (must have been spawned as a character, not an enemy/NPC). No-op if the name isn't found or isn't controllable. |
| `api.setVar(name, value)` | Sets a named story/quest variable - a number, string, or bool. This is the general-purpose state store for chapter progress, "has met X," riddle attempts, etc. **Survives a level transition** (see `loadLevel` below). |
| `api.getVar(name, defaultValue = false)` | Reads a variable back; returns `defaultValue` if never set. |
| `api.giveItem(itemId, count = 1)` | Adds to the persistent inventory directly (for a scripted reward, not a world pickup - `spawnItem` is what puts something in the world for the player to walk up to). |
| `api.removeItem(itemId, count = 1)` | Removes from the inventory (e.g. spending a key item on a puzzle). Clamped at 0, never goes negative. |
| `api.getItemCount(itemId)` | Returns how many of an item are held (`0` if none). |
| `api.hasItem(itemId)` | Shorthand for `getItemCount(itemId) > 0`. |
| `api.playSound(name)` | Plays a one-shot SFX from `assets/audio/sfx/<name>.wav` (e.g. `"attack"`, `"hit"`, `"death"`, `"select"`). Fine to call several times in quick succession - each plays independently. |
| `api.playMusic(name, loop = true)` | Starts background music from `assets/audio/music/<name>.ogg`, replacing whatever was playing. Loops by default. |
| `api.stopMusic()` | Stops the current background music. |
| `api.loadLevel(relativePath)` | **Tears down the current scene and loads a new map** (path relative to the current map's own directory, same convention as `setTileset`). See "Level transitions" below - this is how a chapter moves the story to a genuinely different location. |

**`setBarrier` vs. just gating content in `onTalkTo`:** if a path leads
somewhere that should only exist once a story beat happens, spawning that
area's props/enemies unconditionally in `onLevelStart` (rather than inside
the `onTalkTo` branch that triggers the beat) fixes the area being
under-decorated - but a player who walks there *before* triggering the beat
at all will still get there. If the path itself must be impassable until
then, add a `setBarrier` across it in `onLevelStart` (guarded by whatever
var the beat sets, so it isn't re-raised on a later reload) and lift it at
the exact point the beat concludes. (Chapter 1 currently doesn't use this -
it's deliberately open/explorable from the start, no story gate blocking
any of it - but the mechanism is still there for a chapter that wants one.)

`name` for characters/enemies/NPCs is the roster key - the folder name under
`assets/characters/` (e.g. `"golem"`, `"lara_cyber"`, `"herbalist"`). `name`
for props is the key in `assets/props/props.json` (e.g. `"signpost"`),
`itemId` is the key in `assets/items/items.json` (e.g. `"glowing_acorn"`).
NPC/character/
enemy names should be unique within a chapter - they share one lookup table
(used by `giveControl`, `onTalkTo`, `onEnemyDefeated`), so spawning two
characters under the same roster key will shadow the earlier one for that
lookup (nothing stops you from doing it, but `giveControl("goblin")` etc.
will only ever reach whichever was spawned last).

## Character stats

Every roster character (`assets/characters/<name>/`) has three stats defined
in `assets/characters/stats.json` - a flat catalog keyed by roster name,
`{"str": N, "int": N, "spd": N}`, covering all 135 characters (unlike
`sounds.json`, this one is not sparse - every character has an entry).
There's no `api.*` call for these; they're applied automatically the moment
a character is spawned (`spawnCharacter`/`spawnEnemy`/`spawnNpc`), by
looking up the roster key in that catalog - nothing for a script to do.

- **Strength** scales attack damage: `5 + strength`, for whoever lands the
  hit - so a party character with high Strength hits enemies harder, and a
  strong enemy hits the player harder back. Applies identically to both
  directions of combat (`GameScene::triggerPlayerAttack()` /
  `updateEnemyAI()`).
- **Speed** scales movement in pixels/second: `speed * 16`. For the
  player-controlled character this is the walk speed keys move it at
  (`MainWindow::refreshMoveIntent()`); for an enemy it's how fast it closes
  the distance while chasing (`updateEnemyAI()`).
- **Intelligence** drives the automatic fireball system - see "Magic:
  fireballs" below. Below a threshold it does nothing at all, which is most
  of the roster; above it, more Intelligence means faster, stronger,
  brighter fireballs.

A character with no `stats.json` entry at all reads 0 for all three from
`Character::strength()`/`intelligence()`/`speed()`, which both formulas
above treat as "fall back to the flat pre-stats constant" rather than
literally hitting for `5` or standing still - so a hand-added character
that nobody's updated the catalog for yet still behaves reasonably, just
without any personality on top.

### Magic: fireballs

Once a character's total Intelligence (base `stats.json` value plus level
and item bonuses - see below) reaches **12**, they can throw fireballs.
`stats.json`'s roster spans Intelligence 2-22 (median 8); 12 keeps every
common hostile "grunt" shut out (checked the whole hostile roster - wolf,
bear, boar, goblin, every skeleton variant, orc, troll, zombie_peasant,
the mech-* line, etc. all sit at 2-10) while letting the real mage/spirit/
undead archetypes through (`necromancer` 21, `dark_elf_mage`/
`gnome_wizard` 20, the elemental spirits at 17-19, `cyber_medic`/
`tribal_girl_staff` 16, etc.). It's also deliberately low enough that
`lara_cyber`'s own base 12 already clears it, so the player's starting
character can use the system (if only at its weakest) from the very first
chapter.

Who casts *automatically* versus *on demand* mirrors the exact same split
melee combat already has:

- **Non-controlled party members and hostile enemies** cast automatically
  - `GameScene::updateFireballCasting()`, the same passive-AI convention a
  following companion's melee swing already uses; no `api.*` call for it.
  A hostile caster always aims at the controlled character specifically,
  same as the melee AI.
- **The controlled character casts only on the F key**
  (`MainWindow`, mirroring Ctrl's melee attack) - `GameScene::
  triggerPlayerFireball()`, which picks a target the exact same way the
  automatic check would (nearest living enemy within range). This is
  deliberately excluded from the automatic loop above: if it weren't, the
  automatic check would claim the shared cooldown itself the instant it's
  ready, every tick, before the player ever got a chance to press
  anything - the key would then almost always land on "still on cooldown"
  from a cast the player didn't ask for, reading as a broken button even
  though it's wired up correctly. Out of range or still on cooldown, F is
  a silent no-op, the same as pressing E near nothing; below the
  Intelligence threshold it shows a brief message instead (the one no-op
  case that could otherwise look like the key just doesn't work at all).

Everything about the cast scales with Intelligence past that threshold:

- **Cooldown**: 3.0s at exactly 12, dropping 0.2s per point above that,
  floored at 1.0s.
- **Damage**: 12 at exactly 12, rising 1.4 per point above that.
- **Brightness/size**: the fireball's glow radius and alpha both scale up
  with Intelligence too, so a stronger caster's bolt reads as visibly
  bigger and brighter, not just numerically stronger.

A caster already mid-melee-swing (or already casting, or dead) never also
casts that same tick - melee gets first refusal, so a character in melee
range just fights normally; fireballs are for whenever a valid target is
in range (out to the same distance the melee AI would even notice them at)
but not close enough to swing at yet. A hostile caster only ever targets
the controlled character, the same restriction the melee AI already has.

### Leveling up

The party shares one level/XP counter (`GameState::level`/`experience`,
survives level transitions like `vars`/inventory does). Two things award
XP automatically, with no script involvement:

- **Defeating an enemy**: `max(10, enemy's own max HP / 2)` - a tougher
  enemy is worth more, using the HP it was already spawned with rather
  than needing a second "difficulty" number per enemy.
- **Picking up a `keyItem: true` item**: a flat `150` XP, for completing
  that chapter's main task. Automatic for every existing chapter's key
  item with no script changes needed, since it just checks the flag
  already on the item in `items.json`.

For anything else worth rewarding narratively - rescuing someone, a
kindness with no item attached to it, etc - a script can award XP
directly:

| Call | Effect |
|---|---|
| `api.giveExperience(amount)` | Adds `amount` XP to the party's shared total, running the same level-up logic as an automatic award. |

XP needed to go from level N to N+1 is `N * 100` (100, 200, 300, ...) -
flat, not exponential, so leveling stays steady across the whole
adventure rather than fast-then-stalling. Every level past 1 raises
**every current party member's** Strength/Intelligence/Speed (not just
whoever's currently controlled) - Intelligence fastest (+3/level),
Strength slower (+2/level), and Speed slowest of all (+1 every *two*
levels) **and hard-capped at +6 total regardless of level** - deliberately,
since an uncapped movement bonus would eventually outrun what feels
controllable (or, at the extreme, the tile-based collision checks
movement is built on). A companion recruited after the party has already
leveled up starts with the party's current bonuses already applied, not
at base stats waiting for the next level-up.

Leveling up shows a "Level Up!" caption in yellow rising up from the top
of the currently-controlled character and fading out over about a second
and a half (`LevelUpTextItem`) - shown once per XP award even if that one
award happened to cross several level thresholds at once, never once per
level gained.

## Items and inventory

Items live in `assets/items/items.json` - a catalog of `{name, description,
image, width}` entries, where `image` names a dedicated
`assets/items/<image>.png` icon. A handful of older quest-relic items
instead carry `prop` (reusing an existing `assets/props/<prop>.png` as a
placeholder visual, predating real item art) - `image` is preferred when
present, `prop` is the fallback. The inventory itself is just an id -> count map with no
weight, slots, or equipping - `giveItem`/`removeItem`/`getItemCount`/
`hasItem` are the whole interface. See `assets/scripts/chapter1.js`'s Echo
Seed for the full pattern: `spawnItem` to place it in the world,
`onItemCollected` to react once the player picks it up.

**Random enemy loot:** every time a scripted enemy dies in melee, `GameScene`
(not a script) rolls a chance to drop one random item from the catalog at
its feet - no `api.*` call needed, this happens automatically. A catalog
entry marked `"keyItem": true` (the 5 existing quest relics - Echo Seed,
Root Fragment, Choir Bell, Ember Coil, Chorus Shard) is excluded from that
random pool entirely; it can still be placed with `spawnItem`/`giveItem`,
just never handed out by chance. **Any new plot-critical item must set
`keyItem: true` explicitly** - the default for an item with no flag is
"lootable," not the other way around.

**Inventory menu and using an item:** the player presses **I** to open a
graphical inventory (browse held items with icon/name/count, see each
one's description, Up/Down to select, Enter to activate, **I**/Esc to
close) - entirely engine-driven UI (`InventoryWidget`/`MainWindow`), no
script involvement needed just to display it. Movement and attack are
frozen while it's open, same mechanism as the dialogue-lock (both are
covered by `isDialogueActive()`... except the inventory has its own
separate `m_inventoryOpen` flag in `MainWindow`, since browsing the menu
isn't itself a dialogue).

Activating an item (Enter on the selected row) is `GameScene::useItem()`,
which reads that item's `items.json` entry for a `"onUse"` field:

- **Omitted, or `{"type": "script"}`**: fires `onItemUsed(itemId)` (see the
  entry-points table above) in whichever chapter is currently active - the
  right choice for anything narrative/quest-specific (a key that does
  something only near a particular object, etc). The script decides
  entirely for itself whether/when to consume the item via the existing
  `api.removeItem` - using it doesn't automatically consume it.
- **`{"type": "heal", "amount": N}`**: built-in, no script needed - heals
  the controlled character by `N`, clamped at their max HP.
- **`{"type": "compass"}`**: built-in, no script needed - shows the
  player's current tile coordinates via the same dialogue box a script's
  `say()` uses (`GameScene::showInfoMessage()` - `isDialogueActive()` and
  Enter-to-dismiss both work on it automatically, it just isn't a script
  coroutine underneath).
- **`{"type": "buff", "stat": "speed"|"intelligence"|"attack", "amount": N, "durationSeconds": N}`**:
  built-in - grants the **whole party** (every current member, not just
  whoever's controlled) a temporary boost to that stat, which expires and
  clears itself on its own after `durationSeconds`. Using a second buff
  item of the same stat before the first expires *replaces* the remaining
  time/amount rather than stacking with it. See `stamina_draught`/
  `sealed_vial_of_mist` (speed), `mana_potion`/`elixir_of_clarity`
  (intelligence), and `whetstone`/`woven_talisman` (attack) in
  `items.json`.
- **`{"type": "permanentBoost", "stat": "attack"|"maxHp"|"intelligence", "amount": N}`**:
  built-in - permanently raises that stat for the whole party, including a
  companion who joins later (see `GameScene::scriptSpawnCharacter()`). The
  running total is persisted on `GameState` (`itemBonusStrength`/
  `itemBonusIntelligence`/`itemBonusMaxHp`), so it survives level
  transitions and saves the same way level-up bonuses do - unlike those,
  though, it's an accumulated total rather than a function of level, since
  it comes from however many of these items have been used. See
  `small_ingot`/`ore_chunk` (attack), `round_shield`/`gemstone_cluster`
  (maxHp), and `humming_crystal`/`sealed_scroll` (intelligence) in
  `items.json`.

For any of the four built-in types, a separate top-level `"consumeOnUse": true/false`
on the item controls whether `useItem()` also decrements the inventory
after running the effect (default `false` - a compass or similar tool
stays in the inventory after use; a potion sets this `true`). This field is
**ignored** for script-dispatched items, since a script already controls
consumption itself via `removeItem`. See `health_potion` (heal, consumed)
and `broken_compass` (compass, not consumed) in `items.json` for two
working built-in examples; a script-dispatched item (no `onUse`, or
`{"type":"script"}`) just needs its own `onItemUsed(itemId)` handler in
whichever chapter script spawns it, calling `api.removeItem` itself if/when
it should be consumed.

## Level transitions

`api.loadLevel(relativePath)` destroys the current scene (map, party,
enemies, NPCs, world items - everything) and constructs a fresh one for the
target map, running that map's own script from scratch (`onLevelStart`
fires again, for the new map). **`api.setVar`/`getVar` and the inventory
survive** - everything else does not. This means the new map's
`onLevelStart` is responsible for re-spawning the hero (and any companions
recruited so far, if the story wants them to keep following) via
`spawnCharacter`/`giveControl`, exactly like a fresh map's `onLevelStart`
normally does.

Use this only when the story is moving somewhere **genuinely disjoint** -
Chapters 1-2 share one hub map that just got wider instead of using this,
because they're geographically continuous (see
`project_umbraloom_adventure.md` memory for the reasoning). Chapter 3 is the
first real use of `loadLevel` - a stone-tileset location with no walking
path connecting it to Chapter 1-2's forest, reached the instant the Echo
Seed is collected.

### Pausing commands - only meaningful with `yield`

These don't do anything by themselves - calling them without `yield` is a
no-op (you just get an object back and discard it). **They only work inside a
`function*` (generator), `yield`-ed:**

| Call | Effect when `yield`-ed |
|---|---|
| `yield api.wait(seconds)` | Pauses the script for `seconds` real seconds, then continues. |
| `yield api.say(speaker, text)` | Shows the dialogue box with `speaker`'s name and `text`, and pauses until the player presses **Enter** to advance it. |

```js
function* onLevelStart() {
    api.spawnEnemy("orc", 10, 5);            // immediate - runs right away
    yield api.wait(2.0);                      // pauses 2 real seconds
    yield api.say("lara_cyber", "Hello!");    // pauses until the player advances
    api.setTileset("grass_dirt");             // runs once resumed
}
```

A plain (non-generator) `function` also works - it just can't pause. Use one
whenever a script doesn't need `wait`/`say`:

```js
function onLevelStart() {
    api.spawnProp("well", 12, 6);
}
```

**Only one script coroutine runs at a time.** If a second entry point fires
while one is already paused (mid-`wait`/`say`), the new call is silently
dropped rather than queued. This is a known v1 limitation - fine for the
current two trigger points (`onEnemyDefeated`, `onPlayerDied`) which can't
realistically overlap with `onLevelStart` in practice, but something to keep
in mind if more triggers are added later.

## Audio

SFX live in `assets/audio/sfx/<name>.wav` - **must** be `.wav`, confirmed by
testing that `QSoundEffect` fails to decode `.ogg` at all on this setup
(convert with `ffmpeg -i in.ogg -c:a pcm_s16le out.wav` if a new sfx arrives
as anything else); music lives in `assets/audio/music/<name>.ogg` instead
(a separate player, `QMediaPlayer`, handles compressed formats fine).
`name` in `playSound`/`playMusic` is just that filename without the
extension either way. Background music
starts automatically on every level load - `GameScene` picks one arbitrarily
from a 34-track pool (`theme` plus `music01`-`music38` minus a handful of
retired numbers - `music04`/`07`/`09`/`10`/`11`/`12` were removed by
explicit request, 2026-09-10, and their numbers were retired rather than
reused - all of the user's own tracks, see `kLevelMusicTracks` in
`GameScene.cpp` for the exact current list; never repeating whichever one
was just playing) rather than always defaulting to `theme` - scripts only
need to call `playMusic`/`stopMusic` themselves to *override* that pick
(e.g. a boss fight cueing specific music instead of the arbitrary level
track). SFX are short one-shots (`QSoundEffect`, low latency, fine to
overlap); music is a separate streamed player (`QMediaPlayer`) - don't try
to loop a long track through `playSound`.

**Creature whistle/roar sounds** are purely data/engine-driven - nothing
script-facing to call. `assets/characters/sounds.json` is a sparse, flat
`{roster key: {whistle, roar}}` catalog (same convention as
`props.json`/`items.json`); most of the 135-character roster has no entry
at all. `whistle` is a rare (~20-45s, randomized per character) idle
ambient sound `GameScene` plays automatically for any spawned character
that has one - no entry means that character simply never whistles, there
is no fallback. `roar` plays instead of the shared `attack.wav` whenever
that character swings (player or enemy, `triggerPlayerAttack()`/
`updateEnemyAI()`) - no entry means it keeps using `attack.wav`. See the
file's own comment for the exact schema.

**On player death**: alongside the existing `onPlayerDied()` script entry
point (below), the engine unconditionally plays `funeral_bell_4s` at ~2x
volume and shows a respawn/quit menu (`GameScene::playerDied` signal,
`MainWindow::showDeathMenu()`) - "respawn" is a genuine full restart
(fresh `GameState`, back to `chapter1.json`), not a scene reload. Both the
script hook and this engine behavior fire; a chapter's `onPlayerDied()`
doesn't need to (and can't) suppress the menu.

## Entry points

All optional - a script only needs to define the ones it actually uses. Each
can be a plain `function` or a `function*`.

| Name | Called when | Arguments |
|---|---|---|
| `onLevelStart()` | Once, after the map/characters/props finish loading (deferred to the next event-loop turn so signal listeners like the dialogue box are already connected). | none |
| `onTalkTo(name)` | When the player presses **E** while standing near a spawned NPC (see `api.spawnNpc`). | `name` - the roster key of the NPC talked to |
| `onItemCollected(itemId)` | The instant the player walks near enough to a world item (see `api.spawnItem`) to auto-collect it. | `itemId` - the collected item's catalog key |
| `onItemUsed(itemId)` | When the player activates a held item from the inventory menu (**I**, Enter) whose `items.json` entry has no `onUse.type`, or an unrecognized one - see "Items and inventory" below. | `itemId` - the used item's catalog key |
| `onEnemyDefeated(name)` | Once per enemy, the moment a player attack kills it. | `name` - the roster key of the enemy that died |
| `onPlayerDied()` | Once, the moment the controlled character's HP reaches 0 from an enemy attack. | none |

`onTalkTo` fires for whichever NPC is within range (~60px) of the player when
E is pressed - it's normal for a script to switch on `name` if a chapter has
more than one NPC, and to track how many times a given NPC's been talked to
via `api.getVar`/`setVar` for multi-stage conversations (see
`assets/scripts/chapter1.js`'s Wren conversation for the pattern).

**E is one shared interact key, NPC talk first, prop examine second.**
`GameScene::interactWithNearby()` (called on **E**, see `MainWindow::keyPressEvent`)
checks for a nearby NPC first (`onTalkTo`, above) and only falls back to the
nearest nearby *prop* if no NPC was in range - so a script never needs to
worry about a prop's examine text stealing focus from an NPC conversation.
The prop path is engine-only (no entry point fires) - it reads `name`/
`description` straight from that prop's `props.json` entry and shows them
through `showInfoMessage()`, same mechanism as the built-in compass item.
Both paths also no-op while `isDialogueActive()` is true, so E can't pop a
second message box over one that's already up.

## Debugging

`console.log(...)` works in scripts (backed by `QJSEngine::ConsoleExtension`)
and prints to the game's stdout/stderr - useful when iterating on a script.

## Implementation reference

For anyone changing the engine side rather than writing scripts:

- `src/ScriptBridge.h/.cpp` - the `QObject` installed as `api`; every method
  here is a row in the tables above. Add a new `Q_INVOKABLE` here (and a
  matching `GameScene` method) to add a new command.
- `src/ScriptEngine.h/.cpp` - owns the `QJSEngine`, evaluates script files,
  and drives the generator/coroutine stepping (`callEntryPoint`, `onTick`,
  `advance`). This is where the `wait`/`say` descriptor handling lives
  (`handleYield`).
- `src/GameScene.cpp` - constructs `ScriptBridge`/`ScriptEngine`, loads the
  map's `"script"` field, and calls `onEnemyDefeated`/`onPlayerDied`/
  `onItemCollected` at the relevant call sites; `updateItemPickups()` is the
  per-tick world-item proximity check.
- `src/AudioManager.h/.cpp` - owns the actual `QSoundEffect`/`QMediaPlayer`
  instances behind `playSound`/`playMusic`/`stopMusic`; `GameScene` owns one
  instance and forwards both its own combat/UI sound triggers and the
  script bridge's calls through it.
- `src/GameState.h` - the small struct (`vars`, `inventory`) that survives a
  `loadLevel()` transition; owned by `MainWindow`, injected into each
  `GameScene` it constructs.
- `src/MainWindow.cpp` (`loadLevel()`) - actually performs a level
  transition: constructs the new `GameScene`, swaps it into the
  `QGraphicsView`, and tears down the old one. **Stops the old scene's tick
  timer before deferring its deletion** - skipping that reliably corrupted
  the heap (crashed at process exit, only once a *second* `QJSEngine` had
  ever existed in the process) during development; the exact Qt/V4-internal
  mechanism was never fully confirmed, but a scene that's been navigated
  away from has no business still ticking regardless, so the fix is correct
  either way. If you ever touch this method, keep that ordering.
- `assets/scripts/chapter1.js` - the real adventure's actual entry point
  and its living reference for most of the API (dialogue, combat, items,
  NPCs, and a fully-enclosed prop-built maze, `buildHollowbrookMaze()`, as
  a reference for building pathways/labyrinths out of props instead of
  just scattering them).
- `assets/scripts/sandbox.js` - the older engine-development smoke test,
  exercising every command at once; keep it working as the API evolves, but
  it is not part of the adventure's continuity.
