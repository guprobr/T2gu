# Focused regression checks

```sh
cmake -S . -B build-regression -DCMAKE_BUILD_TYPE=Debug -DT2GU_BUILD_TESTS=ON
cmake --build build-regression -j2
ctest --test-dir build-regression --output-on-failure
```

The engine check uses small generated assets and an isolated `T2GU_SAVE_DIR`.
It covers ordinary/generator reentry, queued events and retirement, melee,
fireball and player-death callbacks that spawn enemies, initialization before
simulation, follower kills that recruit a new member, and a real `MainWindow`
quicksave/quickload with cold sprite decoding and initial script redirects.
It also checks duplicate pickup anchors, blocker-aware nudging, repeated
and fresh-scene item restoration, pickup distance at the rendered anchor,
dead followers receiving HP upgrades, and all temporary buff channels through
snapshot and actual JSON restoration, independent expiry, and old-save defaults.
Tileset checks render warmed terrain caches across swaps, track changed water
animation, and verify failed replacements preserve artwork and collision.
Movement checks cover thin footprints, intermediate grid buckets, water/object
cells, wall sliding, and negative/nonfinite coordinates. Window checks cover
inventory handing off to delayed dialogue and clearing direction/Shift state
on window and application deactivation. Path checks cover normal 60 Hz
progress, genuine stalls, waypoint changes, unreachable-target cooldowns,
and recovery when a gate opens. Music checks cover cancelled/replaced fades,
intro deadline and early-completion handoffs, script track/silence ownership,
retired scenes, and actual media load failure without completion. Intro timing
is accelerated and completion signals are injected for policy checks;
these are not an end-to-end two-minute listening test. Map checks reject invalid dimensions, allocation/file-size limits,
malformed grid shapes/types/indices, and missing dependencies while retaining
the previous map; smaller replacement sheets must cover existing indices.
Save checks reject malformed stats, counts, variables, actors, positions,
health, buffs and snapshot containers without changing the output candidate.
They retain version 2 defaults and the legacy mapPath fallback. Window checks
exercise missing maps/dependencies, syntax and initial generator/ordinary
exceptions, mismatched restored parties/maximum HP, missing item visuals,
failed initial boot/restarts/redirects, and successful retries. Failures preserve scene/actor identity, state,
modal dialogue, buff time and coroutine/queued work; successful loads rebind
the committed scene to live GameState.
It sends Qt key events directly; it does not test desktop input delivery.

Projectile checks cover moving original targets, control switches, paused
simulation versus elapsed wall time, damage at impact, complete painted
bounds, fixed impact position, target/caster removal and snapshot cleanup.
Selection checks exercise damage, healing, maximum HP, level and death
updates without rebuilding portraits or emitting unchanged values. Inventory
checks retain a consumable stack through repeated use and choose a nearby row
when the stack runs out.

Rendering checks exercise viewports that show only a prop's out-of-art shadow,
changed shadow offsets and rotated border props while preserving art anchors
and collision footprints. Actual scene renders check lighting on pickups and
fireballs and notification text above unrelated occluders at viewport edges.
Caption checks cover following the original character, anchor deletion and
normal expiration. Defeat checks hold the event behind a coroutine, move and
remove its corpse, then spawn a new enemy and pickup at the captured fractional
world point. They also cover restoration and invalid world-coordinate inputs.

The sprite tools have a separate check using their existing Python
dependencies (NumPy, Pillow and SciPy):

```sh
python3 tests/sprite_preview_regression.py
```

It creates tiny sheets in a temporary directory, loads each generated preview
through its JSON filename, checks image dimensions/content, and verifies the
preview leaves its original pair untouched. It also checks both overwrite
paths and preservation of the refit's source pair.

When Node is available, CTest also checks chapter 6 with all 16 recruitment
combinations and the campaign path that skips recruits in chapters 2–4.
Chapter 15 checks every partial-wave kill count, repeated reloads, active-wave
dialogue, unrelated kills, and rewards issued exactly once.
Chapter 25 checks each boss form at its predecessor's death position, moved
and damaged forms across reload, optional earlier choices, one-time rewards,
and the ending without attempting to load a nonexistent chapter 26.

For memory corruption checks, configure with
`-DCMAKE_CXX_FLAGS="-fsanitize=address,undefined -fno-omit-frame-pointer"`
and `-DCMAKE_EXE_LINKER_FLAGS="-fsanitize=address,undefined"`. On environments
with unrelated Qt/media lifetime allocations, set `ASAN_OPTIONS=detect_leaks=0`
for that run; this disables leak detection only, not address/undefined-behavior
instrumentation.

When Python 3 is available, CTest also runs `asset_paths` using a small Qt Core
probe in fresh processes. It checks valid/missing environment overrides,
installed discovery, moving a relative install prefix, missing installed data,
source fallback and paths containing spaces. Absolute GNUInstallDirs layouts
keep a fixed configured data path; those checks relocate only the executable.
The probe uses no sprite or audio assets.

Full chapter smoke checks use real assets in separate, sequential processes:

```sh
python3 tests/chapter_smoke.py --binary build-regression/T2guRegression
python3 tests/chapter_smoke.py --binary build-regression/T2guRegression --chapters 15
```

The Linux `/proc` guard defaults to 3 GiB RSS and a 60-second deadline per
chapter. It prints the log directory and writes raw chapter logs plus a JSON
summary. Each process uses a temporary save directory, the actual `MainWindow`
loading path and explicit scene readiness, advances intro dialogue/waits with
accelerated script time, reports population counts, and runs 2.5 seconds of
normal simulation before a completion marker and clean exit. This verifies
startup, not quest completion, combat balance or physical keyboard delivery.
The full-roster sandbox is deliberately excluded. `T2GU_ASSET_DIR` overrides
are respected; otherwise the checkout's assets are used.

Missing markers, nonzero exits, exceeded limits and diagnostic lines fail the
check. CTest's `chapter_smoke_guard` uses tiny synthetic processes to verify
clean success and rejection of missing markers, nonzero exits, diagnostics,
timeouts and excessive RSS; it does not load the roster. The exact known
optional Qt probe message about missing
`libvdpau_nvidia.so` is preserved separately in the summary and raw log; other
media or engine errors still fail. For an instrumented binary, set
`ASAN_OPTIONS=detect_leaks=0` as above when the host Qt/media leak allocations
are unrelated to this code.
