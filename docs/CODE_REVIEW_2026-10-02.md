# ShadowShine / T2gu code review

Reviewed **2026-10-02**, against commit **`e69072c`**, game version **0.7.3**.

The engine builds cleanly, and every shipped chapter completes its initial population under AddressSanitizer and UndefinedBehaviorSanitizer. Nevertheless, the review found three high-priority problems: **a reproducible combat use-after-free, a campaign progression softlock, and initialization callbacks that can run before population finishes**. Passing startup checks does not exercise those paths.

This report contains **22 findings**: 3 high, 13 medium, and 6 low priority, followed by design and maintenance attention flags. Severity reflects player impact and likely repair order, not a security exploit rating. Runtime reproductions, source-established behavior, and unverified risks are distinguished below. No engine, script, or asset fixes were made as part of this review.

## Fix progress

Eight repair batches followed the review on 2026-10-02–03. The findings
below preserve the original reviewed behavior; their source line numbers
refer to commit `e69072c` and can move as fixes are applied.

| Finding | Repair | Verification |
| --- | --- | --- |
| H01 — combat use-after-free | Defeat/death/pickup notifications are posted for dispatch after gameplay iteration; retired scenes cancel pending script work | Sanitizer checks exercise melee, fireball, follower and player-death handlers that grow entity containers |
| H02 — chapter 6 softlock | Warden accepts incomplete parties and adapts absent-companion dialogue without changing recruitment flags | All 16 recruitment combinations and the chapters 2–6 skip-recruitment path |
| H03 — premature readiness | Explicit `sceneReady` boundary; input/overlay remain gated through restore, simulation starts afterward; nested ticks are blocked | Cold population, synchronous readiness consumers, real window quicksave/quickload, and initial script redirects |
| M01 — ordinary script reentry | Execution guards cover ordinary calls, generator steps, evaluation and synchronous dialogue signals; pending calls drain iteratively | Nested event pumping, waiting/dialogue queues, 10,000 missing handlers, and retirement |
| M02 — pickup anchors and restoration | Stored/rendered/pickup anchors agree; snapshot placement is exact; removed props release counted reservations; duplicate-item nudges skip blocked terrain | Duplicate spawns, a barrier across nudge candidates, three repeated restores, a fresh scene restore, reservation reuse, and pickup at the drawn anchor |
| M03 — chapter 15 wave reload | Population preserves active-wave flags and survivor counts to match restored enemies | All 21 partial-wave states, two reloads per state, active-wave dialogue, unrelated kills, and one-time completion rewards |
| M04 — dead member HP upgrade | Maximum-HP changes preserve zero HP for dead members while retaining the living-member refill | Real permanent-boost item, refused control of a dead follower, and restoration into a fresh scene |
| M05 — temporary buffs lost on load | Snapshots/JSON preserve all three bonuses and remaining simulation durations; absent fields mean no buff | Actual F5/F8, consumed potion, independent expiry, and older snapshot defaults; normal chapter transitions still cancel buffs and the item-use message now states that limit |
| M06 — stale tileset rendering | Successful swaps advance a revision observed by the renderer; failed sheet loads retain artwork/metadata; art cell size remains independent of map spacing | Actual API swaps with warmed 0/9 variants, changed/removed water animation, four invalid replacement cases, and shipped-size 256 px art on a 128 px grid |
| M07 — movement tunneling | Continuous axis sweeps through blocking-grid rectangles and every crossed map tile; existing wall sliding and feet-point collision retained | Original 1,024 px/s reproduction, reverse/vertical sweeps, subpixel footprints, intermediate buckets, water/object tiles, and unobstructed motion |
| M08 — malformed saves and failed scene loads | Bounded semantic save parser, isolated candidate state, reversible old-scene suspension, checked restoration and commit only after readiness; any failure resumes the original scene | Version 2 defaults/legacy filename, malformed fields, invalid maps/dependencies, initial ordinary/generator exceptions, saved-party/max-HP disagreements, missing restore visuals, retained dialogue/buffs/coroutine/queue, restart/redirect failures and successful retries |
| M10 — false stuck detection and repeated failed searches | Measure accumulated progress, reset at waypoint changes, and respect retry cooldown even with no path | Actual steering at 320 px/s and 60 Hz, stationary recovery, reached-waypoint reset, unreachable gate and recovery after opening it |
| M09 — inconsistent fireball model and clocks | Preserve targeted spells, follow the original target until impact, and advance flight/damage/fade on scene simulation time | Moving target, pause/event pumping, one-time impact, control switch, caster/target removal and snapshot cleanup |
| M13 — stale automatic music and fades | Owned intro timer, cancelled automatic policy on script commands/retirement, and cancelled fades on stop/replacement; natural intro completion cancels its deadline | Real fade cancellation/replacement, backend natural completion and media failure without completion, accelerated intro deadline, injected early completion/stale callbacks, explicit track/silence, and retirement |
| M11 — dialogue/inventory conflict | Incoming dialogue closes inventory and refreshes movement intent immediately | Inventory opened during a timed script wait; delayed dialogue takes Enter and completes normally |
| M12 — stale held keys | Window/application deactivation clears held keys, running, and movement immediately | Synthetic Qt window and application notifications, followed by fresh input with no retained direction/Shift; physical desktop focus delivery remains unverified |
| L01 — negative coordinates | Reject negative, nonfinite, and outside world points before converting to tile coordinates | Negative fractions/integers, infinity, NaN, map edge, and the valid origin |
| L02 — painted bounds and layer ordering | Independent shadow-child bounds retain full-art placement; explicit top-level layers tint pickups/projectiles and lift scene-owned captions above lighting | Shadow-only and rotated viewport renders, unchanged anchors/footprints, actual lighting renders, caption edge visibility/following, anchor deletion and expiration |
| L03 — stale selection information | Refresh changed selected-character HP/maximum HP/level after simulation; retain the original portrait | Damage, healing, progression, death, unchanged ticks, and deselection |
| L04 — inventory selection reset | Retain the selected item ID, otherwise choose the nearest remaining row | Repeated real consumable use, exhausted stack and empty inventory |
| L05 — chapter 25 form placement | Defeat events capture world-pixel feet coordinates; new world-spawn APIs place each next form there | Event delayed past moved/deleted corpse, exact fractional spawn/restoration, reserved boss keys, all forms/choices/reloads/rewards in Node, real-asset three-form melee sequence with mid-fight F5/F8 |
| L06 — mismatched sprite preview pair | Preview sidecars name the generated PNG | Tiny temporary preview/overwrite runs of both tools, pair dimensions/content, unchanged originals and refit source |

Focused checks are opt-in via `-DT2GU_BUILD_TESTS=ON`; see
[tests/README.md](/home/guzpido/T2gu/tests/README.md). They use generated tiny
assets and `T2GU_SAVE_DIR` to isolate saves. All three CTest checks passed
under ASan/UBSan with no unexpected script or sanitizer diagnostics. The normal
Release executable in `build/T2gu2` was rebuilt successfully. The first three
batches passed all **25 real-asset chapters** under the 3 GiB memory guard.
The third batch peaked at 818–1,278 MiB, emitted no engine warnings/errors,
and retained the same party/enemy/NPC/item population counts as the second.
The fourth batch passed all **25 real-asset chapters**, with unchanged
population counts, no engine diagnostics, and peak RSS of 829–1,281 MiB.
All **33 shipped maps** also passed actual `TileMap` loading, including the
sandbox without constructing its character roster. These checks preceded the
final audio-error handler; the focused sanitizer suite then passed all three
checks again in 8.08 seconds, covering actual media failure without a
completion event.
**All 22 defect findings are fixed.** The eighth batch also addresses A02–A04;
cache residency, entity identity and remaining maintenance checks remain
attention flags. This is not a claim that every
possible code or campaign defect has been found. The fireball-bound portion
of L02 is checked against every painted pixel of an expanded impact flash.
M08 now includes both map validation
and save/scene-load recovery.
`TileMap::load` now validates integer dimensions, a 4,096 limit per dimension,
a 1,048,576-cell allocation limit, a 32 MiB JSON limit, exact provided grid
shapes, and tile index/type bounds before committing the complete candidate.
Failed loads preserve the prior map; failed initial loads remain safely empty.
An omitted object layer remains an empty layer, and omitted spacing keeps the
128 px default. Replacement tilesets must represent every existing grid index.
Thirty-eight malformed map fixtures, a non-object root, an oversized sparse
file, missing dependencies, defaults, invalid runtime edits, and a smaller
replacement sheet are covered. The fifth batch adds an 8 MiB save limit and
validates version, filename/dependencies, normalized level/experience, bounded
permanent stats/counts, scalar story variables, known actors/items, exact raw
positions checked at the sprite feet, health, controlled identity, name
conflicts, and optional buff channels. Missing additive fields retain their
version 2 defaults; `mapPath` remains a read-only fallback.

`MainWindow` retains its old scene/view/UI while the candidate owns a separate
state. Initial map/script failures, first-step script exceptions, and failed
restoration discard that candidate and resume the original tick/coroutine/
queue without advancing buff time over loading. Restoration checks party
composition and maximum HP against chapter population and reports missing
restored assets instead of silently skipping them. Full restarts also use a
candidate, preserving the death menu if the new entry map cannot load.
Successful loads show a status line. Fifth-batch Release and instrumented
Debug builds passed without compiler warnings. All three final CTest checks
passed in **25.19 seconds**, including the missing-character initialization
failure caught and repaired by the expanded tests.

All **25 chapters** passed real-asset window startup, intro completion,
quicksave parsing and quickload, with matching party/enemy/NPC/item counts.
Runs stayed below the 3 GiB guard, peaking at **831–1,299 MiB**, with no
engine/script/sanitizer diagnostics. Qt's FFmpeg backend printed its optional
missing `libvdpau_nvidia.so` discovery message in each process; those platform
messages are retained in the logs and distinguished from engine diagnostics.
The real-chapter checks preceded the final missing-sidecar guard; the final
focused suite exercised that repaired failure path and the existing healthy
load paths afterward. The run used default recruitment state and saved after
settling the intro, so it does not establish every quest checkpoint or a
physical desktop input sequence.

The sixth batch preserves guaranteed targeted fireballs and makes that model
explicit. Bolts follow their original target until impact; scene simulation
advances their flight, damage and fading flash together. A paused scene cannot
finish a bolt on wall time, removing a target cancels its bolts, caster removal
does not cancel a launched spell, and snapshot restoration removes all flight
visuals. The impact bounds cover the full 2.8-times-glow expansion. The selected
entity panel updates changed HP/maximum HP/level values, including death,
without replacing its portrait or emitting unchanged values. Inventory refresh
retains the selected stack and chooses a nearby row when it disappears. Both
sprite tools now write preview sidecars that name their generated PNG.

Sixth-batch instrumented Debug and Release builds passed. All three CTest
checks passed in **25.87 seconds**; the new projectile/UI checks are included
in the engine suite. A separate Python check exercised preview and overwrite
paths for both sprite tools using tiny temporary sheets, verified geometry
and content through the sidecar's image reference, and checked preservation
of original preview inputs and the refit's source pair. No shipped artwork
was regenerated.

All **25 real-asset chapters** then passed initial window population, intro
completion and 2.5 seconds of normal simulation under the 3 GiB guard. Their
party/enemy/NPC/item counts matched the fifth-batch runs. Peak RSS was
**833–1,298 MiB**, with no engine/script/sanitizer diagnostics. The same Qt
optional `libvdpau_nvidia.so` discovery message remains separately recorded
as an environment diagnostic. These checks cover startup and simulation;
they do not establish every combat encounter or quest checkpoint.

The seventh batch finishes L02 and L05. Prop shadows now have child-item
bounds, preserving the full-art rectangle used for anchors, collision and
border transforms. `SceneLayers.h` places ground-Y scenery below pickups,
then projectiles, lighting and notifications; the billion-unit bands exceed
the maximum validated map height. Level-up captions are scene-owned top-level
items that follow their original character and are cancelled before anchor
deletion, so unrelated scenery cannot cover them.

Enemy-defeat events copy `(name, worldX, worldY)` when rewards are awarded.
Queued arguments remain valid after corpse movement/removal, and name-only
handlers remain compatible. `spawnEnemyAtWorld` places exact world-pixel feet
without historical reservation nudging; `spawnItemAtWorld` uses the normal
pickup nudge rules. Both reject nonfinite and out-of-map positions. Chapter 25
uses these APIs for following forms and their potions, retaining its existing
phase/reward logic and ending. The shared maze helpers and map layout are
unchanged.

Seventh-batch Debug/sanitizer and Release builds passed. All **four CTest
checks** passed in **27.06 seconds**, including viewport-edge shadow/caption
renders, actual lighting, caption lifecycle, delayed defeat coordinates after
corpse cleanup, fractional world spawns/restoration and invalid coordinates.
The Node chapter 25 check covers all forms, optional earlier choices, moved
and damaged forms after reload, reserved archetypes, one-time rewards, and
the ending without a chapter 26 load. A guarded real-asset chapter 25 run also
passed all three melee defeats with each following form at the captured death
point and an actual mid-fight quicksave/quickload preserving position and HP.
It peaked at **1,229 MiB** and emitted no engine/script/sanitizer diagnostics;
the known optional Qt video-driver discovery message is recorded separately.
That harness teleports actors, reduces boss HP and accelerates dialogue; it
verifies the phase/engine/save path, not combat balance or desktop input.

All **25 real-asset chapters** also passed window population, intro completion
and 2.5 seconds of normal simulation after the seventh batch. Population counts
matched the sixth-batch runs. Peak RSS was **839–1,331 MiB**, below the 3 GiB
guard, with no engine/script/sanitizer diagnostics. The optional Qt video-driver
discovery message remains separately recorded in the raw/verified logs.

The eighth batch addresses A02–A04. Chapter 15 now tells the player to hunt
each pack along the Lanternway and return to the Light between waves; its
commentary no longer promises automatic waves or an exit barrier. Spawn,
reward and combat behavior is unchanged. Repository/API docs now describe
25 chapter maps, 99 current characters, wrapped stats/sound catalogs,
Intelligence's actual magic effects, separate chapter transitions, simulation
waits, the 120 px talk radius, optional quests and the remaining chapter
12/16/25 exit gates. Old 115-character memory/rendering measurements are
explicitly historical. Chapter 18's Doorwards are optional; chapter 20 drains
the ford at every start. Loading comments reflect the readiness-bound overlay.

CMake now requires Qt 6.9, the version that introduced the used
`QImage::flipped()` API. [Qt's 6.9 API additions](https://doc.qt.io/qt-6/newclasses69.html)
document that baseline. Actual compilation and runtime validation here use
Qt **6.10.2**; a separate Qt 6.9 installation was not available for testing.
`T2GU_NATIVE_CPU=OFF` disables native CPU tuning while retaining supported
Release LTO. Asset discovery follows the configured GNUInstallDirs layout;
relative binary/data directories survive moving the whole prefix, while
explicitly absolute directories keep a fixed configured data path. The
environment override and source fallback retain their order. Desktop launcher
paths still use the configure-time binary directory.

New opt-in asset probes run in fresh processes without sprites or audio.
They check overrides, missing overrides/data, installed discovery, relocation,
source fallback and paths with spaces. Default and custom relative
(`runtime/bin`, `data/story`) configurations pass; an absolute configuration
passes with and without installed data. Exported Release compiler commands
confirm native tuning on for the default and off for the portable build,
with LTO retained. The generated desktop file passes `desktop-file-validate`.

`tests/chapter_smoke.py` now retains the real-window smoke check rather than
relying on a short timeout/grep. Its Linux guard runs chapters sequentially,
requires explicit population/completion markers and normal exit, and checks
diagnostics, a 60-second deadline and 3 GiB RSS limit. Raw logs and JSON
summaries retain the exact known optional NVIDIA backend-probe message
separately. Synthetic process tests prove success and rejection of missing
markers, nonzero exits, warnings, timeouts and excessive RSS. The smoke mode
accelerates introductory dialogue/waits before 2.5 seconds of normal simulation;
it does not claim quest completion or physical input verification.

Eighth-batch instrumented Debug and Release builds pass. All **six CTest
checks** passed in **32.61 seconds** after the final test changes. This run
uses the documented host/offscreen sanitizer configuration with leak detection
disabled; address/undefined-behavior instrumentation remains active. A sandbox
rerun without that setting had stopped in LeakSanitizer's ptrace restriction,
not an asset-path assertion. The retained smoke
checker passed **25/25 real-asset chapters**, with the same population counts
as batch seven, peak RSS of **840–1,321 MiB**, clean exits and no
engine/script/sanitizer diagnostics. Each raw log retains the known optional
Qt NVIDIA-backend discovery message. Results are in
`/tmp/t2gu-fix8-chapter-logs/summary.json`; this path is scratch output, while
the checker and its instructions are now retained in the repository.

Music policy tests accelerate the timer and inject completion signals; they do not establish the complete
two-minute audible experience on a physical desktop.

### Follow-up: shadow rendering regression (2026-10-05)

The owner reported constant jitter/glitches, particularly when walking or
running. Batch seven's unconditional `QGraphicsPixmapItem` shadow child was
a regression: chapter 1 gained 4,551 additional graphics items (4,737 before
the review versus 9,320 after), increasing traversal/paint work in the
deliberately unindexed scene. Of those shadows, 2,531 fit wholly inside their
prop's existing full-art rectangle and did not require separate culling.
The pixmap shadow also returned a nonempty opaque area despite its maximum
alpha being only 90/255. An actual old shadow returned a 20-element opaque
path, which is inappropriate for translucent decoration.
[Qt's pixmap-item documentation](https://doc.qt.io/qt-6/qgraphicspixmapitem.html#ShapeMode-enum)
describes the default mask-based shape/opaque-area behavior.

Contained shadows now share the original prop paint call. Only overflow
shadows have child items, implemented as lightweight `QGraphicsItem`s with
an empty opaque area and independent culling bounds. The full-art prop
rectangle, ground anchor, footprint, transforms, cached gradient and stacking
order remain unchanged. Offset changes switch between inline and overflow
drawing, invalidating the old/new areas through Qt's item ownership and updates.
Chapter 1 now has **6,789 items**, 2,531 fewer than the reviewed implementation;
chapter 6 drops from **16,545 to 14,278**, removing 2,267 unnecessary items.

Release and instrumented Debug builds pass. All **six CTest checks** pass
in **42.59 seconds**, including new 2,000-prop item-count coverage, translucent
pixels/opaque areas, offset changes and exact pixel restoration while retaining
viewport-edge and rotated-shadow checks. Guarded real-asset chapters **1 and 6**
also pass readiness, intro completion and normal simulation without engine or
sanitizer diagnostics, peaking at **1,136 and 1,317 MiB** respectively. The
known optional Qt NVIDIA-backend message remains separately recorded.

Real-asset camera-pan profiling used a 2,544×1,424 software viewport and four
positions in each of those chapters, with simulation frozen for paint isolation.
An isolated 7,000-prop contained-shadow test reports median paint-thread CPU
times of **1.12 ms before review, 2.53 ms after review, and 1.14 ms repaired**
in its first comparison. A second interleaved comparison still favors the
repair, but timings vary. The broad real-asset wall-clock and CPU profiles
include large spikes; they do not support a precise end-to-end FPS claim. Raw profiles
are retained under `/tmp/t2gu-jitter-profile`, and functional chapter logs under
`/tmp/t2gu-jitter-smoke`.

The owner subsequently identified a maximized **1,920×1,200** window. A
guarded chapter 1 check at that size drives Shift+D/A through the actual
`MainWindow` input handlers for approximately eight seconds, recording real
simulation ticks and viewport paint intervals. The repaired build's repeated
run records **16.00 ms median / 16.74 ms p95 / 17.21 ms maximum** paint intervals,
with no intervals over 33.3 ms. An earlier repaired run has a 35.58 ms maximum;
the pre-review and reconstructed reviewed-shadow runs both stay near 16 ms
on this route. Thus this route does not reproduce the owner's constant jitter
and does not establish a desktop-wide smoothness guarantee. All processes
exit normally below 0.8 GiB RSS; profiling runs are serialized and kept
separate from compilation and sanitizer checks.

Startup checks alone did not detect the earlier frame
regression. This follow-up retains structural regression tests rather than
enforcing a flaky wall-clock timing threshold, and does not claim verification
of physical desktop input or every remaining source of stutter.

### Optional OpenGL renderer trial (2026-10-05)

`GameView` selects its viewport at launch. Following the initial optional
trial, the owner requested OpenGL as the default with automatic software
fallback. Unset/empty `T2GU_RENDERER` values select OpenGL;
`T2GU_RENDERER=software` forces software. OpenGL uses complete
viewport updates, no multisampling and a requested swap interval of 1.
Qt OpenGLWidgets is an optional build dependency, with
`-DT2GU_OPENGL_RENDERER=OFF` supported. Missing modules, unsupported headless
platforms, failed context creation and failed shown-viewport initialization
fall back to software. The active GL vendor, device and version are logged.
The existing scene, gameplay, sprite bounds and chrome widgets are retained.
[Qt's Graphics View documentation](https://doc.qt.io/qt-6.10/qgraphicsview.html#ViewportUpdateMode-enum)
supports the viewport replacement and recommends full updates for OpenGL.

Release and instrumented Debug builds pass. All **seven CTest checks** pass
under ASan/UBSan in **48.19 seconds**, followed by the corrected renderer
capture test passing again. A separate software-only build also passes
renderer selection, fallback and viewport pixel checks. The desktop GL check
passes actual opaque/translucent scene pixels on **Intel Iris Xe (TGL GT2),
Mesa 26.0.8, OpenGL 4.6**, using Wayland. Pixel readback preserves and reads
the painted FBO directly: `QOpenGLWidget::grabFramebuffer()` rerenders its
own `paintGL`, clearing a Graphics View scene painted by the view's event.

After changing the default, Release and instrumented Debug rebuilds pass;
all seven CTest checks pass again under ASan/UBSan in **33.36 seconds**.
Desktop checks verify that unset and empty renderer settings select the
Intel GPU, preserve opaque/translucent pixels, and allow an explicit
software override. Explicit OpenGL, headless fallback and the software-only
build also pass. Headless chapter smoke runs select software explicitly.

Scratch-only Release profiling drives synthetic Shift+D/A along a clear
segment in each chapter's dense maze. Enemy and pickup artwork remain in
the scene, but combat/pickup processing and audio playback are disabled for
the comparison. Each measured phase lasts approximately eight seconds.
Runs are sequential, use a 3 GiB/60-second guard, and report window exposure
and actual viewport dimensions. Accepted paired runs use **1,920×1,018**
viewports (not a measurement of the owner's entire 1,920×1,200 screen).

| Chapter / renderer | Median paint interval | p95 | Maximum | Intervals >33.3 ms | Process CPU time / wall second |
| --- | --- | --- | --- | --- | --- |
| 1 / software | 16.01 ms | 17.88 ms | 91.51 ms | 3 | 1,161 ms |
| 1 / OpenGL | 16.68 ms | 17.65 ms | 21.64 ms | 0 | 580 ms |
| 6 / software | 16.00 ms | 16.82 ms | 18.28 ms | 0 | 1,061 ms |
| 6 / OpenGL | 16.66 ms | 17.67 ms | 21.33 ms | 0 | 716 ms |

The chapter 1 pair is `desktop-*-ch1-exposure.log`; the chapter 6 pair is
`desktop-*-ch6-fixed.log`, under `/tmp/t2gu-jitter-profile`. CPU figures
include all process threads, so one fully busy core is 1,000 ms per wall
second. These short samples show reduced CPU use (about 50% and 33%) and
fewer chapter 1 spikes, while chapter 6 is smooth with either backend.
OpenGL presentation intervals are recorded separately via `frameSwapped`
and stay near 16.67 ms in the accepted runs. This supports a user trial,
not a claim of universal speedup or verification of every chapter's combat/UI.

Earlier desktop runs include one guarded timeout, a roughly 36-second
gap before regular presentation, a run with no delivered frames, and
mismatched monitor dimensions. Those are retained and excluded from the
paired performance comparison. A bounded debugger snapshot found the main
thread in the event loop; it does not establish the stall's cause. The later
exposed runs complete normally below 1 GiB RSS. Foreground/background
behavior and ordinary play remain to be verified beyond these short trials;
the software override remains available for comparison.

### First OpenGL focus-loss mitigation (2026-10-05, superseded)

The owner identified losing window focus as the stall trigger. A guarded
desktop run also stopped delivering GUI heartbeats and required external
termination. Other runs completed normally, including one under a debugger;
the exact blocked compositor/driver operation has not been captured.
Before this correction, the real chapter 1 focus-transfer test continued
submitting roughly 60 GL frames per second while a covering window had focus.

The first mitigation suspended updates on the entire top-level window when the
window/application is inactive, hidden or minimized. Pausing only the
viewport is insufficient because changing HUD widgets also drive the window's
GL composition, as described in
[Qt's QOpenGLWidget documentation](https://doc.qt.io/qt-6.10/qopenglwidget.html).
Returning to the foreground restores updates and requests a full redraw.
Simulation and audio continue; the existing input-release behavior remains.
Window and application activation are separate conditions, and externally
disabled updates are preserved.

Initial presentation is allowed before waiting for activation: Wayland
needs a committed buffer to map a new or restored window. GL validity is
checked after an actual paint attempt, so minimized/background startup does
not incorrectly trigger software fallback before GL initialization.
OpenGL remains the default and software selection/fallback remains available.

The desktop `--focus` regression passes on Intel Iris Xe under ASan/UBSan:
**910 timer callbacks and 75 presented frames**, with zero further frames in
each checked inactive interval, while scene positions and HUD text keep
changing. It covers both activation orders, actual focus transfers to a
covering window, four minimize/restore cycles, minimized startup and preserving
externally disabled updates. An external timeout protects this test because a
GUI timer cannot detect a blocked GUI thread. Default/empty OpenGL selection,
opaque/translucent pixels, software override and headless/software-only fallback
also pass. All seven CTest checks pass under ASan/UBSan in **34.55 seconds**;
the renderer check passes again after the final restore-frame adjustment.

The full Release chapter 1 focus-transfer run also exits normally after
**53.5 seconds**, with **780.7 MiB peak RSS**. Four covering-window intervals
stop advancing the render count while one-second GUI heartbeats continue;
presentation resumes on each return. The 45-second measured phase records
2,724 simulation intervals and 1,717 presentations. The approximately four-second
presentation gaps are intentional background suspension, not frame-time stalls.
Raw logs: `/tmp/t2gu-jitter-profile/focus-baseline.log` and `focus-fixed.log`.

### Automatic minimization follow-up (2026-10-05, superseded)

The owner reported that focus loss still locked the game after the repaint
suspension above, and confirmed launching `./build/T2gu2`. The earlier passing
checks therefore did not establish that the owner's stall was resolved.

At the owner's request, this follow-up made `GameView` automatically minimize
its native top-level window on OpenGL window/application focus loss, replacing
the first repaint-only mitigation. The queued request checks the window's lifetime and current
activation state so a rapid focus return cancels it. Restore the game through
the taskbar or window switcher; simulation and audio continue in the background.
OpenGL remains the default, with software selection and fallback available.

The normal `build/T2gu2` target rebuilt successfully. No tests or game launches
were performed for this follow-up, at the owner's explicit request. Existing
focus-check assertions were updated to expect minimization but remain unrun.
The owner subsequently confirmed that ordinary focus loss worked, but a
taskbar preview of the minimized game caused the same lock.

### Minimized taskbar-preview follow-up (2026-10-05, reverted)

Minimization alone does not prevent Qt from processing compositor exposure
events. Qt's [widget-window exposure handler](https://github.com/qt/qtbase/blob/v6.10.2/src/widgets/kernel/qwidgetwindow.cpp#L991)
can show children and synchronize the backing store while minimized. Its
[repaint manager](https://github.com/qt/qtbase/blob/v6.10.2/src/widgets/kernel/qwidgetrepaintmanager.cpp#L552)
can flush the GL texture even without a new scene paint. This is a plausible
path for the reported preview lock; no blocked-thread capture confirms it.

This mitigation disabled updates on the whole top-level window before automatic
minimization and whenever its window state becomes minimized. This blocks
exposure-triggered GL flushes as well as scene and HUD paints. Activation and
preview Show events leave the suspension in place while the window remains
minimized. Clearing the minimized state restores updates that `GameView`
disabled and schedules a full redraw, allowing the restored window to map
before activation. Externally disabled updates are preserved. A minimized
view also skips direct scene paint requests. Simulation and audio continue.

The normal `build/T2gu2` target rebuilt successfully. No tests or game launches
were performed, as requested by the owner. Existing focus-check assertions
were adjusted to expect suspended updates but were not run. Taskbar-preview
and restore behavior await the owner's manual verification.

### GPU hang investigation and workaround removal (2026-10-05)

The owner confirmed the focus/minimize guards worked, but reported the same
lock during ordinary visible play. The whole desktop became uncontrollable
until the game was killed. At the owner's request, automatic minimization,
activation filtering, whole-window update suspension and the minimized-paint
guard have all been removed. OpenGL remains the default with its existing
startup software fallback; normal Qt window behavior is restored.

Read-only inspection of the kernel journal established a **GPU render-engine
hang**, including these entries in America/Sao_Paulo time:

```text
2026-10-05T05:28:30-03:00 i915: Resetting rcs0 for preemption time out
2026-10-05T05:28:30-03:00 i915: GT0: rcs0 reset request timed out
2026-10-05T05:28:30-03:00 i915: GPU HANG: ecode 12:1:84dffffb, in T2gu2 [708222]
2026-10-05T05:28:42-03:00 Fence expiration time out ... T2gu2[708222]
2026-10-05T05:28:42-03:00 Fence expiration time out ... kwin_wayland[44903]
2026-10-05T05:29:11-03:00 i915: GT0: Resetting chip for stopped heartbeat on rcs0
2026-10-05T05:29:11-03:00 i915: GT0: rcs0 reset request timed out
```

Prefixes and register details are abbreviated here; raw entries are preserved
in `/tmp/t2gu-gpu-hang-2026-10-05/kernel.log`. Earlier occurrences name T2gu2
at 04:28:16, 05:11:13 and 05:22:46, plus earlier rendering probes. KWin logs
show failed render-device access, EGL context errors and failed atomic commits;
relevant entries are in `desktop.log` in the same directory. These are observed
graphics-stack failures, not evidence inferred solely from window behavior.
GPU fence timeouts in KWin explain the desktop-wide loss of responsiveness.

Recorded environment: Intel Tiger Lake-LP GT2 / Iris Xe (8086:9a49), i915,
kernel `7.0.0-38-generic`, Mesa `26.0.8-1ubuntu0.3`, Qt `6.10.2+dfsg-7`, KDE
Wayland. Killing the process does not identify the offending GPU command or
prove a game-side, Mesa, kernel or hardware defect individually. The older
debugger snapshot showed an idle event loop and was not a capture of this
confirmed kernel GPU hang. Likewise, the passing short renderer trials did
not rule out a GPU hang during later play.

The detailed i915 error state is protected at `/sys/class/drm/card1/error`.
Reading it directly was denied; an escalated `sudo -n cat` could not proceed
because interactive authentication is required. The owner then saved the
existing dump with:

```sh
sudo cat /sys/class/drm/card1/error > /tmp/t2gu-gpu-hang-2026-10-05/i915-error.txt
```

Offline decoding with the installed `intel_error_decode` (intel-gpu-tools
2.3-1) succeeded; `i915-decoded.txt` is preserved beside the 55,210-byte raw
dump. This is the **first** captured hang, at 03:46:28, naming the earlier
`t2gu-dense-rend` probe. It is not a new capture of the latest player session.
The dump records `rcs0` as hung, `Reset count: 0`, `Suspend count: 0`,
`PM suspended: no`, `GT awake: yes`, and `i915.enable_guc=0` (legacy submission).
The last recorded instruction is `IPEHR: 0x7b000005`, a draw command, with
`BBADDR: 0x0000fffe_ffd64049` immediately after the nearby draw packet at
`0x0000fffe_ffd6402c`. This supports GPU command execution as the failing
layer; it does not map the failure to a particular character or Qt draw call.

The decoder reports unsupported commands and incorrect length expectations
for several Gen12 packets. Those messages are limitations of this decode,
not proof that the application submitted malformed GPU commands. In particular,
do not treat its labels of zero vertices or zero instances as reliable: its
field offsets for these seven-dword draw packets are inconsistent with the
captured packet layout. The saved register and command data should be decoded
with a matching Gen12-aware Mesa tool before assigning a specific driver bug.
No system configuration, driver or GL swap setting was changed. The exact
Mesa/kernel/Qt interaction or hardware defect remains unidentified, and the
reverted build is not presented as a GPU-hang fix.

The normal `build/T2gu2` target rebuilt successfully after removal of the
workarounds. No tests or game launches were performed at the owner's request.
Existing opt-in focus-check assertions were aligned with normal Qt behavior
but remain unrun. The software override in README avoids the game's OpenGL
path while the exact graphics-stack trigger remains under investigation.

### Post-revert manual observation and retained-change audit (2026-10-05)

The owner subsequently tried to reproduce the hang but could not, and
confirmed that the successful run logged Intel OpenGL with no software
fallback. Read-only inspection of the kernel journal found no GPU-hang/reset
entries after the latest `build/T2gu2` rebuild at 05:35:40 America/Sao_Paulo
time, through this audit. This records improved observed behavior, without
establishing that the underlying GPU hang is fixed.

The rollback removed the focus/minimize guards; it did not restore the entire
original OpenGL implementation. One rendering change remains: GL validity is
checked after a scene paint attempt, with fallback queued only if the viewport
is still invalid and the window is visible and not minimized. The earlier
implementation checked validity from a queued Show-event callback. Inspection
of the older `/tmp/t2gu-stall-profile` executable confirms that distinction.
It corrects premature initialization checks and changes callback timing during
window exposure. A valid OpenGL viewport does not take the fallback branch,
so it provides no demonstrated explanation for eliminating a steady-play
GPU command hang.

Comparison with the preserved pre-guard implementation and the current source
found the same context preflight, zero MSAA samples, swap interval 1 and full
viewport updates. Binary inspection also confirmed zero samples and interval
1 in both `/tmp/t2gu-stall-profile` and `build/T2gu2`; no swap/vsync change was
left behind. The prop-shadow optimization dates to 02:31, before the recorded
hangs, and remains unchanged. The music toggle also predates failing launches.
Neither is a newly introduced fix from the latest rollback.

Removing activation/update/minimization callbacks changes submission timing
and window transitions, which could reduce exposure to an intermittent
graphics-stack failure. This is a hypothesis, not an identified causal fix;
the earlier unguarded renderer also produced GPU hangs. The current build was
left unchanged. No tests, game launches, driver changes or commits were made
for this audit.

### Foreground recurrence and Gen12 packet interpretation (2026-10-05)

The owner subsequently reported another failure during ordinary play, without
a focus change. Kernel entries at **09:22:20 America/Sao_Paulo** identify
`GPU HANG: ecode 12:1:84dffffb, in T2gu2 [792039]`, an `rcs0` preemption
timeout and a failed engine reset. At 09:22:32 the game and KWin both have
expired GPU fences; at 09:22:49 the stopped-heartbeat reset and chip reset
also time out. Relevant entries are preserved in
`/tmp/t2gu-gpu-hang-2026-10-05/kernel-0922.log` and `desktop-0922.log`.
This confirms recurrence after the rollback; the preceding quiet Intel
OpenGL run did not establish a fix. No running game process remained when
this occurrence was inspected.

Offline interpretation of selected packets in the **retained first dump**
used Mesa's Gen12 XML definitions and their imports from
[Mesa commit be89a173d5000483ba08ef42f8a544b0789bc011](https://chromium.googlesource.com/external/gitlab.freedesktop.org/mesa/mesa/+/be89a173d5000483ba08ef42f8a544b0789bc011/src/intel/genxml/gen120.xml).
These describe the GPU packet layout; they are not a claim to match the
installed Mesa library revision. The resulting field interpretation is saved
as `gen12-packets.txt` beside the dump:

- `0x7b000005` is a valid-length, seven-dword `3DPRIMITIVE`: four vertices,
  one instance, sequential access, no indirect parameters, and zero start
  vertex, start instance and base vertex.
- The most recent `3DSTATE_VF_TOPOLOGY` before the recorded draw selects a
  triangle fan. The two per-vertex buffers have pitch 8 and size 32, consistent
  with four pairs of floats. Their high address words are part of 64-bit
  GPU addresses, not the "max index" described by the older decoder.
- The following `0x786d1100` is `3DSTATE_CONSTANT_ALL`, updating vertex and
  pixel shader constant state. It is not an unknown instruction or a loop.

These selected fields are consistent with ordinary Qt painting. They neither
validate the complete GPU state nor identify the failing shader, texture,
synchronization operation or software layer. `IPEHR` and the nearby batch
pointer cannot by themselves assign a causal draw call. The retained error
state is still the earlier 03:46:28 rendering-probe hang, not this player's
09:22 occurrence; it was not cleared or replaced.

The next diagnostic is an API trace of a manual run. The
[apitrace instructions](https://github.com/apitrace/apitrace/blob/13.0/docs/USAGE.markdown)
describe EGL capture via `egltrace.so`; this covers the game's Qt scene and
window-composition contexts. Ubuntu's `apitrace` and `apitrace-tracers`
13.0 packages were downloaded, their SHA256 values compared with local apt
metadata, and their contents extracted under the existing `/tmp` diagnostic
directory. No packages were installed system-wide.

The manual launcher is:

```sh
bash /tmp/t2gu-gpu-hang-2026-10-05/capture-opengl.sh
```

It explicitly selects Qt Wayland and OpenGL, writes a unique capture directory,
records the binary hash and game output, and saves relevant journal entries
after the game exits or is killed. `FLUSH_EVERY_MS=1000`, verified in
[apitrace 13.0's trace writer](https://github.com/apitrace/apitrace/blob/13.0/lib/trace/trace_writer_local.cpp),
periodically flushes the trace file without forcing GPU completion. A hard
kill can still lose the last buffered calls; a trace may also change timing,
so a quiet captured run remains inconclusive. Long captures can grow large.
Offline inspection should precede any replay of the recorded GPU workload.

No renderer or game binary changes, tests, game launches, trace replays,
driver changes or commits were made during this investigation. The precise
cause remains unresolved, and the focus/minimize guards remain removed.

### Captured recovery and repeated tile uploads (2026-10-05)

The owner ran the capture launcher and reported that the game locked,
eventually resumed normal gameplay, then was closed. The capture is
`/tmp/t2gu-gpu-hang-2026-10-05/capture-7sasHv/`. Its metadata records a start
at 09:40:04 America/Sao_Paulo, the same pre-change game binary hash
`436f4c1057d9f936fd7ba7d4dc82ba2ef6dd3b8585909e355a1667b06b5b1144`,
and normal exit status 0. Intel OpenGL is logged with no software fallback.

At 09:40:49.606 the kernel records the same `12:1:84dffffb` GPU hang in
`T2gu2 [801125]`, after a preemption timeout and failed engine reset. Game
and desktop GPU fences expire at 09:41:01. At 09:41:17 another engine/chip
reset attempt times out, followed by `T2gu2[801125] context reset due to
GPU hang`. The owner confirmed that gameplay itself resumed, not just the
desktop. Recovery is an observed outcome; these timeout entries do not
establish that every requested reset succeeded or that tracing fixed the bug.

Offline `apitrace dump` interpretation completed without decoder diagnostics;
no trace replay or GPU workload was launched. The trace contains 1,429
`eglSwapBuffers` calls, all returning `EGL_TRUE`, and 4,277 recorded
`glGetGraphicsResetStatusARB` results, all `GL_ZERO`. The scene and composition
contexts remain in use until normal shutdown. These API return values do not
negate the kernel hang or validate all application/driver behavior. The
capture lacks per-call wall-clock timing, so the kernel stall cannot yet be
assigned to a particular API call from call numbers alone.

The trace also exposes substantial work: 3,710,993 draw calls, 7,419,737
`glBufferData` calls and 27,987 non-null 256-by-256 texture uploads. The
median interval between recorded swaps contains 3,835 draws. Qt's window
composition also uploads a 1920-by-1008 image in 1,023 calls. This is captured
workload, not an untraced performance measurement. `trace-summary.json` and
`context-calls.txt` preserve the offline results. The original trace is
8,283,114,348 bytes (about 7.7 GiB), stored on the machine's `/tmp` tmpfs;
its recording overhead and memory use can change timing.

Extracted upload bytes were compared with the shipped `grass_water.png`
tileset. Calls 3359, 3422, 3446 and 6835 match grass tile 0 and its mirrored
variants exactly; call 2146261 matches unchanged border tile 3 exactly.
The blob hashes and identifications are preserved in
`tile-blob-identification.txt`. This identifies map tiles in the captured
uploads; dimensions alone were not used to assign every texture's origin.

Source inspection found a concrete cause of avoidable tile churn:
`TileSheet::tile()` returned a fresh `m_sheet.copy(...)` on every request.
Pure-terrain variants already retain their pixmaps in `TileMapItem`, but
border and object tiles used fresh copies while painting. `TileSheet` now
retains each extracted pixmap by tile index so unchanged tiles retain their
Qt cache keys and can reuse their GL textures. The cache clears only after a
successful sheet load; failed loads preserve the current sheet/cache, and
out-of-range lookups still return empty pixmaps. Extraction coordinates,
rendered content, water animation and window behavior are unchanged. The
shipped ten-tile, 256-by-256 sets add at most 2.5 MiB of decoded tile data
per populated cache, beyond the retained full sheet.

`build/T2gu2` rebuilt successfully with this cache change. No tests, game
launches, trace replays, driver changes or commits were performed. The
owner's next manual run should use `./build/T2gu2`; reducing unnecessary
texture churn is a concrete improvement, but whether it affects the GPU hang
remains unverified. The underlying graphics-stack defect is still unresolved.

### Recurrence after caching and next driver comparison (2026-10-05)

The owner reported another hang after the tile-cache rebuild. The executable
was rebuilt at 09:48:45 America/Sao_Paulo; kernel entries at 09:53:30 again
identify `GPU HANG: ecode 12:1:84dffffb, in T2gu2 [807003]` with a failed
`rcs0` preemption reset. Further GPU fences expire, and at 09:53:59 the
heartbeat/chip resets time out and the game context is reset. At 09:54:06
the kernel also names VS Code's GPU process in a hang (`12:1:85dffffb`);
VS Code then reports context loss and restarts that process. This may be
fallout from the shared GPU failure, not an independent initiating bug in
VS Code. No game process remained at inspection. Raw entries are preserved
as `kernel-0953.log` and `desktop-0953.log`.

The tile cache has therefore not prevented the reported hang. It addresses
unnecessary tile extraction/texture churn and is retained as that improvement,
not represented as a driver-hang fix. No additional rendering/window guards
or driver settings were added to the game.

The next owner-run comparison isolates driver synchronization using Mesa's
documented `INTEL_DEBUG=stall` option, which waits between GPU draws/dispatches.
See [Mesa's Intel debug options](https://docs.mesa3d.org/envvars.html#intel-debug)
and its [GPU-hang debugging guidance](https://docs.mesa3d.org/graphics-debugging/debugging-misrenderings-crashes.html#is-the-issue-consistently-reproducible-can-you-make-it-100-reproducible).
The flag keeps OpenGL hardware rendering but can slow it. A change in failure
rate would be a lead concerning synchronization/cache handling or timing;
it would not establish a permanent fix or assign fault to a particular layer.

Because resets failed and other applications subsequently lost GPU contexts,
a fresh boot is recommended before that comparison to reduce the chance of
carrying disturbed GPU state into the next run. The saved first i915 dump,
relevant logs and complete 8,283,114,348-byte API trace have been copied into
the ignored, persistent `output/gpu-hang-2026-10-05/` directory so the evidence
survives clearing `/tmp`. No reboot was initiated by the agent.

The prepared owner-run launcher records game output, binary identity and
journal entries without another large API capture:

```sh
bash output/gpu-hang-2026-10-05/driver-stall.sh
```

The launcher is a local diagnostic artifact, not an installed package or
game default. It has not been run. No tests, game launches, trace replays,
system configuration changes or commits were made for this investigation.

### Owner-run per-draw stall result and batch-sync comparison (2026-10-05)

The owner reported that `driver-stall.sh` did not hang. Saved logs in
`output/gpu-hang-2026-10-05/driver-stall-9dV7JS/` confirm
`INTEL_DEBUG=stall`, Intel Iris Xe OpenGL with no software fallback,
the tile-cache binary hash
`71c25bdf0eaafb3312e334227adb3d02673b12372eab7f3ed83779b9aabbcaf8`,
and normal exit status 0. The launch began at 10:01:16 America/Sao_Paulo;
the post-exit journal capture completed at 10:08:00, roughly 6 minutes
44 seconds later. Both captured journals report no entries. No
unsupported-driver-flag warning appears in the game output.

Read-only inspection showed that the current boot still includes the earlier
09:53 game and 09:54 VS Code GPU hangs; the boot began October 2. The proposed
reboot was therefore not a change between these observed runs. This rules out
a reboot as the explanation for this particular successful comparison.
It does not exclude other timing/workload variation or establish a root cause
from one run. No frame timings were captured, so the performance cost of
`stall` has not been measured. The owner subsequently reported that performance
did not degrade much. This is a subjective observation supporting its
practicality as a provisional launch option, not a measured frame-time result
or a confirmed permanent fix.

The result strengthens the GPU synchronization/cache-handling or timing lead.
The next comparison replaces `stall` with Mesa's documented `sync` option,
which waits on the CPU for each submitted GPU batch rather than inserting
per-draw GPU stalls. See [Mesa's Intel debug options](https://docs.mesa3d.org/envvars.html#intel-debug).
These options change different aspects of scheduling and synchronization:
if `sync` also suppresses the hang in comparable play, that supports exploring
completion at batch/frame boundaries; if it still hangs while `stall` remains
reliable, barriers or dependencies between commands within a batch become a
stronger lead. Neither outcome alone identifies a specific broken barrier,
software component or hardware defect.

The owner-run launcher is prepared:

```sh
bash output/gpu-hang-2026-10-05/driver-sync.sh
```

It records the selected option, binary identity, game output and journals
without an API capture. The agent has not run it. The game binary and defaults
remain unchanged; no per-draw stall, global environment setting or new window
guard was made permanent. No tests, game launches, trace replays or commits
were performed during this follow-up.

### Batch-sync hard lock and matching Iris source inspection (2026-10-05)

The owner reported a lock requiring a reboot. The saved environment and
game log in `output/gpu-hang-2026-10-05/driver-sync-oNlMED/` confirm the
`INTEL_DEBUG=sync` comparison, Intel OpenGL without software fallback, and
the same binary hash as the preceding `stall` run. The launch began at
10:12:09 America/Sao_Paulo. The game printed 9,940 `waiting for idle`
messages; there is no recorded normal exit status.

After the reboot, read-only `journalctl -b -1` inspection recovered the
relevant messages to `kernel-previous-boot.log` and
`desktop-previous-boot.log` in that result directory. At 10:13:45 the kernel
recorded a render-engine preemption timeout, failed engine reset, and
`GPU HANG: ecode 12:1:84dffffb, in T2gu2 [815934]`. Fence timeouts followed
for T2gu2, KWin and other GPU clients. At 10:14:14 another hang report was
followed by engine and chip reset attempts that also timed out. The next
boot began at 10:15:34. This confirms GPU failure and failed recovery;
it does not isolate the command or component that caused the hang.

The upstream Mesa 26.0.8 archive was downloaded from
[Mesa's release archive](https://archive.mesa3d.org/mesa-26.0.8.tar.xz).
Its SHA256 matched
`caf1c0061a68e88dfa74967a7e780c0e85d65b6c4e334cd69095a5dc54ad78bc`,
published in [the release notes](https://docs.mesa3d.org/relnotes/26.0.8.html).
Only Iris C/header sources were extracted under the ignored evidence
directory. No downloaded scripts were executed, drivers installed or
source built. Ubuntu downstream patches have not been inspected, so this
is the matching upstream release, not a complete audit of the packaged binary.

The source clarifies the diagnostic comparison:

- `iris_screen.c:736` enables `always_flush_cache` when `DEBUG_STALL` is set.
- `iris_draw.c:340` and `:347` invoke the cache helper before and after draws.
  `iris_blorp.c` also brackets relevant blit/resolve operations with it.
- `iris_pipe_control.c:349` requests pipeline stalling and extensive cache
  flushing/invalidation. Its helper splits combined flush/invalidate
  requests into end-of-pipe synchronization followed by invalidation.
- `iris_batch.c:978` implements `DEBUG_SYNC` as a CPU rendering-completion
  wait after batch submission, producing the observed idle messages.

These are materially different command sequences. The successful `stall`
run therefore supports examining cache coherency and dependencies between
operations inside a batch, as well as timing. The failed `sync` run provides
no evidence for fixing this with an end-of-frame `glFinish` or another
CPU wait. Neither result proves a specific missing barrier or permanent fix;
the single successful run may still reflect workload/timing variation.

The failed `driver-sync.sh` launcher now exits with an explanation before
launching anything. Its original source is preserved as
`driver-sync.sh.disabled` for the investigation record. A local driver bug
report draft is saved as `output/gpu-hang-2026-10-05/DRIVER_BUG_REPORT.md`;
it has not been sent externally. Game code, renderer defaults and binary
were unchanged in this follow-up. No tests, game launches, trace replays,
system configuration changes or commits were performed by the agent.

### Applying the Iris stall cache path to accelerated rendering (2026-10-05)

The owner requested continuing accelerated rendering and applying the
behavior of the successful first `INTEL_DEBUG=stall` run. Further inspection
of the checksum-verified upstream Mesa 26.0.8 sources found a direct
equivalent: `always_flush_cache=true`. `iris_screen.c` enables the same
boolean from either DEBUG_STALL or this driconf option. A scan of that
release's C/header sources found no other DEBUG_STALL behavior in the Iris
OpenGL path. Vulkan's separate implementation is not used by this renderer.
The installed Gallium library also contains the option name and description.

`src/util/xmlconfig.c:423` reads options from environment variables named
after each option; its boolean parser accepts `true` and `false`. Environment
values take precedence over XML configuration. This provides a way to select
the exact Iris cache path without modifying Mesa, intercepting Qt draw calls,
or setting INTEL_DEBUG. Public release history also records
[support for the cache option](https://docs.mesa3d.org/relnotes/19.3.0.html)
and [its connection to DEBUG_STALL](https://docs.mesa3d.org/relnotes/23.3.0.html).

`GameView::configureRendererEnvironment()` is now called at the start of
`main`, before QApplication. Mesa reads screen options during initialization;
setting them inside QOpenGLWidget::initializeGL would be too late. The helper
requests `always_flush_cache=true` only in Linux builds with OpenGL support,
when the requested renderer is default/OpenGL and a DRM render node exposes
the affected Intel PCI vendor/device pair 8086:9a49. Read-only inspection
confirmed that this machine's renderD128 has those IDs. Explicit option
values are preserved. Software selection and the offscreen/minimal platforms
selected through QT_QPA_PLATFORM skip the automatic request. On a hybrid
machine the PCI check detects presence, not which GPU a context will use;
drivers without this option ignore it. The behavior of other Intel devices
has not been verified, so the automatic request is limited to the observed ID.

The cache helper adds GPU synchronization and cache flushing/invalidation
around draws and applicable blit/resolve operations. OpenGL remains the
default with existing startup software fallback. INTEL_DEBUG is untouched,
and no frame-end wait, focus filter, forced minimization or driver installation
was introduced. The new setting is confined to the game process. If a driver
version ignores the option, startup context checks cannot detect that or
guarantee hang prevention.

`cmake --build build --target T2gu2 -j2` passed. The game was not launched and
no tests were run, per the owner's instruction. This is a source-supported
implementation of the earlier successful mode, not yet a verified hang fix;
owner verification and sustained play are pending. No commits were made.

### Initial owner result with the integrated cache option (2026-10-05)

After receiving the rebuilt binary, the owner reported that it apparently
did not hang. A read-only kernel journal query since the binary's rebuild
time, 10:47:40 America/Sao_Paulo, returned no entries matching GPU hangs,
reset request timeouts, GPU-hang context resets or fence expiration timeouts.
The journal snapshot is saved as
`output/gpu-hang-2026-10-05/integrated-cache-first-observation.txt`.

This is an encouraging first owner observation of the integrated option,
following the earlier successful stall run. No exact run duration, frame
timings, startup renderer output or driver-option acknowledgement were
captured for this run, so acceleration and option activation have not been
independently verified from its output. The result remains provisional and
does not identify the specific missing dependency or prove lasting stability.
The accelerated configuration and binary were left unchanged. No tests,
game launches or commits were performed by the agent for this follow-up.

### Remaining stutter after hang mitigation: paint-cost follow-up (2026-10-05)

The owner subsequently reported no hangs but continued jitter that affects
gameplay, including while moving/running. This separates the hang mitigation
from the remaining rendering/frame-pacing problem. No new runtime measurements
were collected by the agent; the following changes use source inspection and
the previously saved API capture as evidence, pending manual verification.

Concrete repeated work found and changed:

- **Water:** each 256 px water tile used 32 horizontal stripes, with up to
  another 32 wrap draws, a clip change and painter state saves per repaint.
  Its 120 ms invalidation interval did not limit the phase or these draws
  when movement caused frequent full-frame repaints. Water is now composed
  in a small QImage once per row/orientation/phase and painted as one pixmap.
  Equal row/orientation copies share it. The ripple cache has a 16 MiB nominal
  pixel budget and clears on phase or tileset changes. Phase advances at the
  existing 120 ms cadence. No water timer invalidation is requested when
  the current tileset has no water index. New textures still need uploads
  at phase changes; whether those produce visible spikes needs measurement.
- **Terrain beyond the viewport:** the four-cell repair margin for partial
  redraws was also used with FullViewportUpdate. Complete-frame rendering
  now uses only the art overlap needed from earlier columns/rows. Shipped
  256 px art on a 128 px grid needs one preceding column and row. The old
  software repair margin is retained for partial-update viewports. Tile
  pixels, overlap and base-before-object drawing order remain unchanged.
- **Character shadows:** an antialiased radial-gradient ellipse was rebuilt
  for every character paint, switching from gradient to sprite rendering.
  Shadows now use shared pixmaps per radius, following the existing prop
  shadow approach. The same softness, squash, opacity, cap and feet offset
  are retained. Raster caching can change edge sampling slightly; no new
  pixel comparison was run. Sprite cell bounds and movement are unchanged.
- **Unchanged character frames:** every simulation tick called setPixmap,
  even on idle/dead characters and ticks between animation frames. Qt 6.10.2's
  [setter implementation](https://github.com/qt/qtbase/blob/v6.10.2/src/widgets/graphicsview/qgraphicsitem.cpp#L8697)
  unconditionally requests geometry bookkeeping, discards the cached mask
  shape and schedules an update. Characters now compare pixmap cache keys
  and assign only when the frame changes. Offset and Y-based stacking still
  update independently, so identical art does not suppress movement/facing
  offsets or depth changes.
- **Lighting:** painting used live elapsed time rather than the overlay's
  240 ms animation cadence; movement therefore changed decorative gradients
  more often. Phase is now latched to its own cadence. An extended style
  option restricts fill geometry to the exposed portion, while gradients
  remain anchored to the whole map. This preserves their spatial layout.
- **Widget HUD:** coordinate text, resizing and repositioning were performed
  at movement-tick frequency. The earlier capture included 1,023 window-sized
  1920×1008 backing-texture uploads; it did not prove all were caused by the
  HUD. The HUD is a plausible contributor because it is a changing QWidget
  over the GL viewport. Debug coordinates now refresh at most every 100 ms,
  and unchanged strings skip text/layout updates. Camera/input processing
  remains at simulation cadence; level readiness forces a fresh readout.

Props already share decoded/scaled/trimmed art and cached shadow pixmaps.
Contained shadows share their parent's paint callback; only overflow shadows
have lightweight child items. Their translucent bounds and ground-Y stacking
cannot simply be flattened into a background image without changing occlusion
against characters/items. No additional prop children, whole-map raster cache
or uncapped sprite cache were introduced. Dense alpha-blended props, shadow
draw counts and art larger than grid cells remain possible GPU/overdraw costs.
Frame-end synchronization was not added, and the Iris cache-flushing setting
remains in place. The earlier capture's large draw counts make reducing draws
particularly relevant to that mode, but do not measure the new workload.

An optional `T2GU_PROFILE_RENDER=1` diagnostic now reports every three seconds:
paint-start interval and CPU scene-paint duration (p50/p95/maximum), average
cost and paint-callback counts for tiles, props, overflow shadows, characters
and lighting, and water frame builds. Measurements use CPU clocks and add no
GPU synchronization. They exclude Qt's later widget composition, swap and
presentation; asynchronous GPU cost may appear in intervals rather than in
the item callback that submitted it. They are not displayed FPS or a GPU
profiler. Timing/logging overhead applies only to the opt-in diagnostic;
ordinary play does not time each item. Samples are bounded and discarded
after each report.

Manual launch with a saved log:

```sh
mkdir -p output
T2GU_PROFILE_RENDER=1 ./build/T2gu2 2>&1 | tee output/render-profile.log
```

Wait for chapter assets to finish loading, then compare standing, walking,
running, water and dense scenery at the same window size. The log makes the
next remaining bottleneck reviewable without another multi-gigabyte API trace.
`cmake --build build --target T2gu2 -j2` passed. No tests, game launches,
benchmarks or commits were performed by the agent. Smoothness improvements
and continued hang-free behavior require the owner's manual check; no new
frame-time improvement or complete stutter fix is claimed.

### Owner confirmation: accelerated rendering without hangs or stutter (2026-10-05)

Following the rendering optimizations, the owner confirmed empirically that
both symptoms were gone: no hangs and no stuttering in manual play. The
accelerated configuration is retained, including the Iris cache-flushing
option and the paint-cost reductions. The verified build's SHA256 is
`16658430307ec398f83b5af6caaee65c82fdfdb4f5cdcf3cc3020de2e1ee49ad`.

This is the owner's qualitative runtime confirmation on the observed setup.
No new frame-time measurements, exact session duration or profile log were
provided, and the specific underlying driver defect remains unidentified.
The result does not attribute the smoothness improvement to one individual
optimization. Only documentation was updated after this confirmation;
the working code and binary were left unchanged. No tests, game launches
or commits were performed by the agent in this follow-up.

## Scope and verification

Reviewed the current implementation in all **47 C++ source/header files**, all **26 JavaScript files** (chapters 1–25 and sandbox), all **6 Python tools**, CMake/install configuration, launcher template, the scripting reference, sprite workflow, README, and repository instructions. Asset validation covered **153 JSON files**, **99 character directories**, **135 prop entries**, and **93 item entries**. The historical `T2gu-legacy/` tree was excluded, as repository instructions explicitly designate it as unbuilt historical material.

Verification performed:

| Check | Result | What it establishes |
| --- | --- | --- |
| Debug build with `-Wall -Wextra -Wpedantic`, ASan, UBSan | Passed; no compiler warnings | Current code compiles on GCC 15.2 / Qt 6.10.2 |
| Real `GameScene` startup for every chapter, sequentially | 25/25 populated and exited normally | No script/resource-load failures or sanitizer errors in these startup runs |
| Memory guard on chapter runs | No run reached the 3 GiB guard | Observed peak RSS 815–1,283 MiB in this instrumented Debug configuration |
| JSON parsing, sheet geometry, item imagery, chapter grid dimensions and resource paths | Passed | Checked asset structures agree with their metadata |
| Mock `api` population of all chapters | Passed | Referenced spawn assets and coordinates were valid; generated-layout constants matched |
| Approximate collision raster and BFS, at 16 px resolution | All checked entities accessible with quest gates lifted and chapter 20 drained | Useful structural reachability evidence; not an exact collision or quest-completion proof |
| Shared generator/helper comparisons | Passed | `mulberry32`, `buildBranchingMaze`, `sampleCells`, and `scatterOrganic` matched across all 25 chapters |
| Regenerated maps to a temporary output directory | 20/20 byte-identical | The map generator reproduces the maps it owns: chapter 1 and chapters 7–25 |
| Python source compilation | All six passed | Syntax validity, not verification of every destructive asset transformation |
| `desktop-file-validate` | Passed | Generated launcher syntax is valid |
| Small fixtures linked against the actual instrumented C++ objects | Several failures reproduced | Evidence for individual findings below |
| Targeted JavaScript quest sequence | Chapter 6 softlock reproduced | Skipping earlier recruits is legal but breaks later progression |
| Synthetic Qt key events in an offscreen `MainWindow` | Modal conflict reproduced | Inventory can intercept Enter while delayed dialogue is visible |

The chapter harness waited for the script's population marker and then ran another 2.5 seconds. Each chapter ran in a fresh process, with a 45-second deadline and RSS monitoring. These are cold-start population checks, not complete playthroughs. The raster check approximated transformed prop footprints and border collision; it did not model live enemy AI or exhaustively exercise every quest permutation. The ordinary chapter runs emitted a host VDPAU backend diagnostic, not a game asset failure. Some tiny reproduction fixtures intentionally omitted audio files.

LeakSanitizer was disabled for these Qt process runs. No claim of complete leak freedom, sustained campaign memory stability, visual correctness for every sprite, or reliable physical keyboard/mouse delivery is made.

Build command used:

```sh
cmake -S . -B /tmp/t2gu-code-review-build \
  -DCMAKE_BUILD_TYPE=Debug \
  '-DCMAKE_CXX_FLAGS=-Wall -Wextra -Wpedantic -fsanitize=address,undefined -fno-omit-frame-pointer' \
  '-DCMAKE_EXE_LINKER_FLAGS=-fsanitize=address,undefined' \
  -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
cmake --build /tmp/t2gu-code-review-build -j2
```

Temporary harnesses and logs were kept under `/tmp/t2gu-review-*`; they are review scratch artifacts, not a newly installed test framework. The important reproduction outputs are included in this report so the findings remain understandable after temporary files disappear.

## High-priority findings

### H01 — A kill callback can invalidate the melee loop and access freed memory

**Status: reproduced with AddressSanitizer.**

Sources: [GameScene.cpp:1163](/home/guzpido/T2gu/src/GameScene.cpp:1163), [GameScene.cpp:1222](/home/guzpido/T2gu/src/GameScene.cpp:1222), [GameScene.cpp:2285](/home/guzpido/T2gu/src/GameScene.cpp:2285), [chapter25.js:650](/home/guzpido/T2gu/assets/scripts/chapter25.js:650).

`triggerPlayerAttack()` iterates `m_enemies` by reference. On a lethal hit, `awardEnemyDefeatRewards()` synchronously invokes JavaScript `onEnemyDefeated`. That script can call `api.spawnEnemy`, appending to the same container. If it reallocates, the active range-for iteration points into freed storage.

This is relevant to shipped content: chapter 25 calls `nextForm()` before its first yield, and `nextForm()` immediately spawns the next boss form. A particular run's failure depends on container capacity; the mutation hazard exists regardless.

The reproduction spawned two nearby enemies, killed one with melee, and had its plain defeat handler spawn 100 additional enemies using an already-loaded sprite. ASan reported:

```text
ERROR: AddressSanitizer: heap-use-after-free
read: GameScene::triggerPlayerAttack() — GameScene.cpp:1164
free: QList<GameScene::Enemy>::append
      GameScene::scriptSpawnEnemy() — GameScene.cpp:2285
      ScriptEngine::startEntryPoint()
      GameScene::awardEnemyDefeatRewards() — GameScene.cpp:1231
      GameScene::triggerPlayerAttack() — GameScene.cpp:1175
```

**Impact:** a crash or memory corruption during combat, including a boss phase transition.

**Recommended repair:** finish the damage/container iteration before delivering script events. Copy the event payload rather than retaining `Enemy&` across a script call, and audit every callback made from an entity collection loop. Merely reserving more container capacity hides the failure without making the iteration safe. Add a small sanitizer regression that kills an enemy whose handler spawns more enemies.

### H02 — Optional recruits in chapters 2–4 become mandatory after the player cannot return

**Status: reproduced in the JavaScript quest harness; progression dependency is established by source.**

Sources: [chapter2.js:607](/home/guzpido/T2gu/assets/scripts/chapter2.js:607), [chapter3.js:644](/home/guzpido/T2gu/assets/scripts/chapter3.js:644), [chapter4.js:651](/home/guzpido/T2gu/assets/scripts/chapter4.js:651), [chapter5.js:667](/home/guzpido/T2gu/assets/scripts/chapter5.js:667), [chapter6.js:618](/home/guzpido/T2gu/assets/scripts/chapter6.js:618).

Collecting the exit item in chapters 2, 3, and 4 immediately advances the campaign without requiring Vigil, Cobb, or Vex. Chapter 5 does require Nettle before leaving, but chapter 6's Warden requires **all four recruitment flags**. The earlier recruits are not offered in chapter 6, and its script provides no route back to the earlier maps.

Reproduction sequence:

1. Pick up `vault_sigil` in chapter 2 without recruiting Vigil.
2. Pick up `deepstone_ember` in chapter 3 without recruiting Cobb.
3. Pick up `signal_core` in chapter 4 without recruiting Vex.
4. Recruit Nettle in chapter 5 and collect `cinder_charm`.
5. Talk to the chapter 6 Warden.

The harness confirmed each earlier transition, then:

```text
CHAPTER5_EXIT loaded="chapter6.json"
CHAPTER6_WARDEN loaded=null opened=false
globals={chapter:6, nettle_recruited:true}
```

**Impact:** a legitimate player can permanently strand the current run in chapter 6. A startup test or a playthrough that always recruits everyone will miss it.

**Recommended repair:** decide whether those recruits are optional throughout the story or guaranteed before chapter 6. To preserve the deliberate removal of hard gates, let the Warden accommodate missing companions or provide recruitment/recovery within the current chapter. Do not blindly restore all the gates removed in commit `c4777d8`. Verify the campaign dependency graph, including runs that skip every optional quest.

### H03 — Scene readiness is inferred from queue order, but nested event processing breaks that assumption

**Status: premature callback execution and simulation during population reproduced; resulting save corruption is a risk, not a separately reproduced end-to-end save failure.**

Sources: [SpriteSheet.cpp:72](/home/guzpido/T2gu/src/SpriteSheet.cpp:72), [GameScene.cpp:808](/home/guzpido/T2gu/src/GameScene.cpp:808), [MainWindow.cpp:295](/home/guzpido/T2gu/src/MainWindow.cpp:295), [MainWindow.cpp:302](/home/guzpido/T2gu/src/MainWindow.cpp:302), [MainWindow.cpp:318](/home/guzpido/T2gu/src/MainWindow.cpp:318).

`GameScene` queues `onLevelStart()` and then starts its simulation timer at the end of its constructor. The script runs later, so the timer is already active while the script spawns characters. A cold sprite load calls `processEvents(ExcludeUserInputEvents)` inside that script execution.

`MainWindow` queues snapshot restoration and loading-overlay dismissal after `onLevelStart`, relying on queued callback order to mean population has finished. The nested event pump can run those later callbacks while the first callback is still executing. Queue ordering establishes which callback starts first; it does not make that callback atomic when it explicitly processes events.

The focused fixture queued a readiness callback immediately after constructing the scene. Its population function paused briefly and loaded another uncached sprite:

```text
READY_CALLBACK populated=0
TICK_DURING_START busy=1
```

The comment in `SpriteSheet::load()` that no scene timer is running is therefore false. Excluding user input does not exclude simulation timers, queued restore callbacks, or overlay changes.

**Impact:** restoration can occur against an incompletely populated party; an overlay can disappear early; simulation and script events can mutate the scene during initialization. Cold loads are more exposed than warm-cache loads.

**Recommended repair:** use an explicit initialization/readiness boundary. Keep simulation, interaction, restore, and loading-overlay completion gated until population is complete. If the interface must remain responsive during decoding, use staged loading or event handling that cannot reenter mutable gameplay state. Define readiness independently of whether an introductory coroutine is still waiting for dialogue dismissal.

## Medium-priority findings

### M01 — A synchronous script handler is not considered busy while it executes

**Status: reproduced.** Sources: [ScriptEngine.cpp:49](/home/guzpido/T2gu/src/ScriptEngine.cpp:49), [ScriptEngine.h:69](/home/guzpido/T2gu/src/ScriptEngine.h:69).

`startEntryPoint()` calls a plain JavaScript function while the engine still reports `Idle` and has no active iterator. If that function triggers nested Qt event processing through a sprite load, another gameplay event can call another handler immediately instead of queuing it. This violates the documented one-at-a-time execution contract even though waiting generators are correctly protected.

A plain `onLevelStart` fixture recorded `TICK_DURING_START busy=0` and `nested_pickup=1`: `onItemCollected` ran while the original population handler was still executing. The otherwise similar generator fixture reported busy and did not execute the pickup handler inside its population body.

**Repair:** track active execution with a guard around both ordinary function calls and generator steps. Queue entry points whenever execution is active, and drain them only after the current call has unwound. H03 and M01 need complementary fixes.

### M02 — Item rendering, pickup coordinates, and saved coordinates can disagree

**Status: reproduced.** Sources: [GameScene.cpp:905](/home/guzpido/T2gu/src/GameScene.cpp:905), [GameScene.cpp:2585](/home/guzpido/T2gu/src/GameScene.cpp:2585), [GameScene.cpp:2394](/home/guzpido/T2gu/src/GameScene.cpp:2394), [GameScene.cpp:2470](/home/guzpido/T2gu/src/GameScene.cpp:2470), [GameScene.cpp:2662](/home/guzpido/T2gu/src/GameScene.cpp:2662).

`placeProp()` nudges duplicate ground anchors by `(48,48)`. `spawnItemInWorld()` then stores the **original** coordinates in `WorldItem`, and pickup distance, treasure location, and snapshot capture use those originals. The rendered prop can therefore sit somewhere other than its interaction position.

```text
ITEMS_INITIAL stored=(832,832),(832,832)
              drawn=(832,832),(880,880)
ITEMS_RESTORED stored=(832,832),(832,832)
               drawn=(928,928),(976,976)
```

The restore result above exercised restoration into the same scene, where deleted item reservations remain occupied. Normal quickload constructs a new scene; its exact offsets depend on rebuilt scenery, so this experiment is not proof that every quickload accumulates the same drift. The original coordinate mismatch is independent of that distinction.

**Repair:** store the actual ground anchor after placement, restore saved positions exactly, and release or rebuild occupancy reservations when entities are removed. Check final nudged positions for terrain/blocker validity as well as duplicate anchors.

### M03 — Chapter 15 resets wave bookkeeping while quickload restores wave enemies

**Status: source-established integration defect; reset reproduced in the script harness.** Sources: [chapter15.js:545](/home/guzpido/T2gu/assets/scripts/chapter15.js:545), [chapter15.js:670](/home/guzpido/T2gu/assets/scripts/chapter15.js:670), [chapter15.js:699](/home/guzpido/T2gu/assets/scripts/chapter15.js:699), [GameScene.cpp:2383](/home/guzpido/T2gu/src/GameScene.cpp:2383), [GameScene.cpp:2447](/home/guzpido/T2gu/src/GameScene.cpp:2447).

`onLevelStart()` clears `vigil_active` and `vigil_alive`, explicitly assuming a reload leaves no enemies behind. Scene snapshots save and restore living enemies, including the active wave. Saving during a wave and loading produces enemies from that wave with counters saying no wave is active. Talking to the Light can spawn another copy; kills are then counted by roster name against the new counter, potentially completing the wave while enemies remain.

The script harness began the first six-enemy wave, then re-ran initialization and observed `active=false`, `alive=0`, `wave=0`.

**Repair:** make quickload preserve active-wave state consistently, or deliberately discard the restored wave and restart it. Distinguish loading a snapshot from ordinary level initialization. Stable wave/entity identifiers would make completion counting less fragile.

### M04 — A permanent maximum-HP boost can make a dead character have positive HP

**Status: reproduced.** Sources: [Character.cpp:281](/home/guzpido/T2gu/src/Character.cpp:281), [Character.cpp:289](/home/guzpido/T2gu/src/Character.cpp:289), [GameScene.cpp:2552](/home/guzpido/T2gu/src/GameScene.cpp:2552).

The maximum-HP item path calls `setMaxHp()` on every party member. That setter refills HP but does not reset `m_dead`. A dead member can become `hp=110, maxHp=110, dead=true`. Snapshot restoration later derives death from HP through `setCurrentHp()`, so the same saved state can become alive after loading.

The UI normally prevents item use after the controlled character dies; a dead follower in an otherwise living party is the relevant gameplay case. The fixture invoked the same item path directly to isolate the invariant.

**Repair:** separate maximum-HP changes, healing, and revival. Keep dead members at zero HP unless an explicit revival is intended, and keep death flags, animation state, and saved HP consistent.

### M05 — Saving omits temporary buffs even though their consumed items are saved

**Status: reproduced.** Sources: [Character.h:239](/home/guzpido/T2gu/src/Character.h:239), [GameScene.cpp:2374](/home/guzpido/T2gu/src/GameScene.cpp:2374), [GameScene.cpp:2522](/home/guzpido/T2gu/src/GameScene.cpp:2522).

Temporary strength, intelligence, and speed bonuses and their remaining durations live only on `Character`. Snapshots contain positions and HP, while inventory records that the potion was consumed. Restoring into a new scene loses an effect that was still active at save time. The fixture measured speed **14 before saving, 10 after restoring**.

Scene replacement also drops these effects on a chapter transition. Whether transitions should cancel buffs is a design decision; quickload silently changing a supposedly restored gameplay state is the concrete discrepancy.

**Repair:** serialize active bonus channels and remaining simulation durations, or explicitly define and communicate cancellation semantics. Cover both quickload and chapter transitions.

### M06 — `api.setTileset()` leaves old cached tiles and water-rendering metadata

**Status: reproduced; latent API defect, not exercised by current chapter population.** Sources: [TileMapItem.cpp:124](/home/guzpido/T2gu/src/TileMapItem.cpp:124), [TileMapItem.cpp:178](/home/guzpido/T2gu/src/TileMapItem.cpp:178), [GameScene.cpp:2684](/home/guzpido/T2gu/src/GameScene.cpp:2684).

Terrain variants are cached by numeric tile index, and the renderer captures the water index once in its constructor. `scriptSetTileset()` reloads the underlying sheet and requests repainting, but neither invalidates the cache nor refreshes the renderer's water index.

The fixture painted a red tileset, loaded a blue one, and painted again:

```text
TILESET_SWAP before=#ff0000 after=#ff0000 direct=#0000ff
```

Collision follows the map's refreshed water classification, while rendering can still use the old one.

**Repair:** make successful tileset changes notify the renderer to clear variants and rebuild tileset-dependent metadata. Make failed reloads transactional so old metadata and artwork remain mutually consistent.

### M07 — The time-step clamp does not guarantee collision safety at supported speeds

**Status: endpoint tunneling reproduced.** Sources: [GameScene.cpp:46](/home/guzpido/T2gu/src/GameScene.cpp:46), [GameScene.cpp:302](/home/guzpido/T2gu/src/GameScene.cpp:302), [Character.cpp:435](/home/guzpido/T2gu/src/Character.cpp:435), [MainWindow.cpp:923](/home/guzpido/T2gu/src/MainWindow.cpp:923).

Movement checks only the final feet point for each axis. Clamping `dt` to 0.05 seconds bounds displacement, but does not ensure it is smaller than every prop footprint. Running, speed buffs, level bonuses, and the follower catch-up multiplier of up to 3 increase supported displacement substantially. Lara's current base speed stat is 12, so reasoning from an old flat movement speed is insufficient.

With a supported 1,024 px/s velocity and `dt=0.05`, the fixture moved from x=200 to x=251.2 across an obstacle covering x=210–238.8. Neither endpoint was blocked, so the obstacle was missed completely.

**Repair:** subdivide movement according to displacement and the collision geometry, or use a swept segment test. Retain the time-step clamp for simulation stability, but do not treat it as a proof that tunneling is impossible. Preserve the existing feet-point collision convention.

### M08 — Malformed map metadata can be accepted and later crash; load failure is not contained

**Status: division-by-zero reproduced; other failure consequences established by source.** Sources: [TileMap.cpp:40](/home/guzpido/T2gu/src/TileMap.cpp:40), [TileMap.cpp:101](/home/guzpido/T2gu/src/TileMap.cpp:101), [GameScene.cpp:577](/home/guzpido/T2gu/src/GameScene.cpp:577), [MainWindow.cpp:260](/home/guzpido/T2gu/src/MainWindow.cpp:260).

Map loading checks positive map width/height, but not positive tile width/height. A map with `tileWidth=0` successfully loads; `isWalkable()` then divides by zero:

```text
INVALID_MAP accepted=1 tileWidth=0
TileMap.cpp:101: runtime error: division by zero
AddressSanitizer: FPE
```

Also, loading changes dimensions before every dependency has succeeded. A failed tileset load can leave positive dimensions with uninitialized grids; `GameScene` merely logs map failure and continues creating the scene. Grid allocation has no sensible dimension/product limit, and missing/ragged grids are silently padded with `-1`.

Save loading does correctly check JSON parsing, supported versions, and map-file existence. Semantic fields still need validation: character entries, positions, HP, level, counts, and script-variable types can be malformed despite syntactically valid JSON.

**Repair:** validate metadata, shape, index bounds, and allocation limits before committing a map; construct a candidate scene and preserve the previous playable state on failure. Validate saves into a temporary state before replacing live state. These are local robustness issues, not evidence that shipped JSON is currently malformed.

### M09 — Fireball damage is guaranteed to the original target despite the documented dodge behavior

**Status: established by source.** Sources: [GameScene.cpp:2049](/home/guzpido/T2gu/src/GameScene.cpp:2049), [GameScene.cpp:2063](/home/guzpido/T2gu/src/GameScene.cpp:2063), [GameScene.cpp:2079](/home/guzpido/T2gu/src/GameScene.cpp:2079), [FireballItem.cpp:43](/home/guzpido/T2gu/src/FireballItem.cpp:43).

The visual bolt snapshots an impact location, with a comment describing the target dodging by moving away. Pending damage stores a target pointer and applies damage when its timer expires, without checking the target's distance from the impact point. A living target still takes the hit after moving away.

Projectile visuals use elapsed wall-clock time; damage uses the scene's clamped simulation time. After stalls, the visual can already have impacted or disappeared while the damage countdown still has time left.

**Repair:** choose an explicit combat model. For dodgeable projectiles, store the impact location and validate overlap at impact; for guaranteed targeted spells, make the visual and description communicate that model. Drive both visuals and damage from a consistent clock.

Terrain is also ignored in melee hit testing and projectile damage. A focused fixture placed both characters outside a 128 px barrier, only 130 px apart, and melee reduced enemy HP from 100 to 85 across it. This can permit damage across corridor walls or gates. Whether walls should block attacks is a design decision; adding line-of-sight must preserve the deliberate circular, facing-independent melee reach rule.

### M10 — Path recovery can classify slow progress as stuck, and failed searches bypass cooldown

**Status: established by source; frequency in a live campaign was not measured.** Sources: [GameScene.cpp:388](/home/guzpido/T2gu/src/GameScene.cpp:388), [GameScene.cpp:1711](/home/guzpido/T2gu/src/GameScene.cpp:1711), [GameScene.cpp:1741](/home/guzpido/T2gu/src/GameScene.cpp:1741).

`moveAlongPath()` expects the distance to the waypoint to shrink by at least 8 px **per call**, otherwise it accumulates a stuck timer. At roughly 60 ticks/s, perfectly normal 320 px/s movement advances about 5.3 px per call and fails that threshold. Waypoint changes can further distort the comparison. A falsely stuck character can blacklist a genuinely reachable cell.

Separately, `waypoints.isEmpty()` causes a new A* search irrespective of `repathCooldown`. An unreachable target can therefore provoke a search every tick per character, each allowed up to 12,000 expansions. The node cap bounds one search, not aggregate work per frame.

**Repair:** assess accumulated movement over a time window, as the trail-following path already does; reset comparisons when changing waypoints. Keep a cooldown/backoff for failed searches and a shared per-tick search budget if measurements justify it. Retain A* for combat and rejoining; this finding is not a recommendation to remove it.

### M11 — Delayed dialogue and inventory can both be active, with inventory taking Enter

**Status: reproduced using synthetic Qt events.** Sources: [MainWindow.cpp:362](/home/guzpido/T2gu/src/MainWindow.cpp:362), [MainWindow.cpp:760](/home/guzpido/T2gu/src/MainWindow.cpp:760), [MainWindow.cpp:797](/home/guzpido/T2gu/src/MainWindow.cpp:797).

Inventory opening checks whether dialogue is visible now, not whether a waiting script will show it later. `showDialogue()` does not close inventory. Thus opening inventory during an intro wait or post-kill wait can leave both visible; inventory input has priority and consumes Enter instead of advancing the dialogue.

```text
MODAL_BEFORE inventory=1 dialogue=1
MODAL_AFTER_ENTER inventory=1 dialogue=1
MODAL_RECOVERED dialogue=0
```

The player can recover by closing inventory with Escape and then pressing Enter, so this is not an unrecoverable softlock. It contradicts the input logic's stated aim of avoiding two competing modal interfaces.

**Repair:** resolve modal ownership when dialogue arrives, not only when inventory opens or an item returns immediately. Closing inventory in `showDialogue()` is a small, direct option; a shared modal state would avoid future priority drift.

### M12 — Movement keys are not cleared when the application loses focus

**Status: source-established missing handling; physical focus-loss delivery was not tested.** Sources: [MainWindow.cpp:907](/home/guzpido/T2gu/src/MainWindow.cpp:907), [MainWindow.cpp:914](/home/guzpido/T2gu/src/MainWindow.cpp:914), [MainWindow.h:25](/home/guzpido/T2gu/src/MainWindow.h:25).

Held keys are inserted on press and removed on release. There is no focus/window-deactivation handler clearing them. If a movement or Shift key is released while another application has focus, this window may never receive its release and can continue moving or running after the user returns. The per-tick refresh preserves the stale intent.

**Repair:** clear held movement keys and stop the controlled character on window/application deactivation. Verify with a real display; the offscreen tests here do not prove actual desktop input delivery.

### M13 — Ambient music scheduling can override explicit script music or silence

**Status: established by source; the two-minute audio path was not runtime-tested.** Sources: [GameScene.cpp:548](/home/guzpido/T2gu/src/GameScene.cpp:548), [GameScene.cpp:551](/home/guzpido/T2gu/src/GameScene.cpp:551), [GameScene.cpp:2806](/home/guzpido/T2gu/src/GameScene.cpp:2806), [AudioManager.cpp:90](/home/guzpido/T2gu/src/AudioManager.cpp:90).

Every scene schedules a fade after two minutes and connects the first `musicFinished` event to random level music. `api.playMusic()` and `api.stopMusic()` do not cancel that ambient-intro policy. A script's replacement track can be faded by the old timer; a requested silent scene can later resume random music. `stopMusic()` also leaves an active fade alive, whose completion emits `musicFinished`.

The constructor comment assumes the natural-end and fade routes cannot both occur, but the one-shot timer is not canceled if the ambient source ends early and the fallback starts a new track.

**Repair:** model ownership of the current music request and cancel obsolete intro timers/fades/connections when scripts take control or request silence. Keep audio loading failures distinct from intentional completion.

## Low-priority findings

### L01 — Slightly negative world coordinates map into tile zero

**Status: reproduced.** Source: [TileMap.cpp:100](/home/guzpido/T2gu/src/TileMap.cpp:100).

Integer conversion/division truncates toward zero, so `isWalkable(-1,64)` returns true on a walkable tile-zero fixture. Values just west/north of the map can be treated as in bounds rather than outside the world. Border barriers mask this in many maps.

**Repair:** reject negative/out-of-world coordinates before tile conversion, or use floor division with explicit bounds checks.

### L02 — Rendering bounds and overlay-order comments do not consistently match painting

**Status: source-established geometry/order issues; full visual impact not exhaustively rendered.** Sources: [FireballItem.cpp:54](/home/guzpido/T2gu/src/FireballItem.cpp:54), [FireballItem.cpp:96](/home/guzpido/T2gu/src/FireballItem.cpp:96), [Prop.cpp:168](/home/guzpido/T2gu/src/Prop.cpp:168), [GameScene.cpp:472](/home/guzpido/T2gu/src/GameScene.cpp:472), [GameScene.cpp:2586](/home/guzpido/T2gu/src/GameScene.cpp:2586), [LevelUpTextItem.cpp:36](/home/guzpido/T2gu/src/LevelUpTextItem.cpp:36).

The fireball bounds extend by `2 * glowRadius`, but the expanding impact reaches almost `2.8 * glowRadius` before disappearing. Qt can clip/cull that outer paint. Prop bounds cover the full source-art rectangle, while a measured ground anchor plus shadow offset/radius can place part of the shadow outside it; the asset scan suggests this is common, but it used Pillow scaling rather than an exact Qt render.

Item pickups have `1,000,000 + groundY` z-order while the lighting overlay sits at 1,000,000, so the comment that lighting paints over every prop is false for pickups. A level-up item's large **child-local** z-value does not lift it above unrelated top-level siblings, despite its “always drawn on top” comment.

**Repair:** cover all painted geometry while preserving the full-cell/full-art anchoring contracts. Define explicit top-level layer ordering and decide whether pickups and level-up effects should share world lighting. Verify with edge-of-viewport renders.

### L03 — Selection information is a snapshot rather than a live display

**Status: established by source.** Source: [GameScene.cpp:2872](/home/guzpido/T2gu/src/GameScene.cpp:2872).

`selectionChanged` is emitted when selecting, with copied HP/stats. Subsequent damage, healing, or progression does not refresh the selected information widget. A selected target can display stale health until selection changes.

**Repair:** refresh only when relevant selected-entity state changes, or poll just that entity at a modest UI interval. Clear or update the panel when death changes its meaning.

### L04 — Refreshing inventory jumps selection to the first item

**Status: established by source.** Sources: [InventoryWidget.cpp:58](/home/guzpido/T2gu/src/InventoryWidget.cpp:58), [MainWindow.cpp:784](/home/guzpido/T2gu/src/MainWindow.cpp:784).

After using an item that does not open dialogue, inventory is rebuilt and row zero becomes selected. Repeated Enter can therefore operate on a different item instead of continuing to use the highlighted stack.

**Repair:** remember the selected item ID; restore it if still present, otherwise select the nearest remaining row.

### L05 — Chapter 25's next boss form appears at the original spawn cell

**Status: established by source.** Source: [chapter25.js:650](/home/guzpido/T2gu/assets/scripts/chapter25.js:650).

The documented encounter says each form spawns where the previous one fell. `nextForm()` always uses `bossCell`, even if the boss chased the party elsewhere. The defeat event exposes only the roster name, so the script cannot recover the death position through the current API.

**Repair:** either align the description with deliberate respawning at the door, or pass a stable entity identifier and death position to the defeat handler and use that position. Address H01 before extending phase-spawn behavior.

### L06 — Sprite preview JSON points to the original image instead of the preview

**Status: established by source.** Sources: [realign_sprites.py:173](/home/guzpido/T2gu/tools/realign_sprites.py:173), [refit_sprites.py:334](/home/guzpido/T2gu/tools/refit_sprites.py:334).

`--dry-run` intentionally writes suffixed preview PNG/JSON files. Both tools copy the original metadata's `sheet` field without changing it to the suffixed PNG name. Loading the preview JSON therefore loads the original art. For realignment, the new frame geometry can also disagree with that original image.

**Repair:** set the preview metadata's `sheet` to `out_png.name` and check that the preview pair loads together. The deliberate creation of preview files during “dry run” is documented and is not itself a defect.

## Design, documentation, and maintenance attention flags

### A01 — Per-scene ownership does not imply per-scene sprite memory release

Sources: [GameScene.cpp:57](/home/guzpido/T2gu/src/GameScene.cpp:57), [GameScene.cpp:855](/home/guzpido/T2gu/src/GameScene.cpp:855), [SpriteSheet.h:49](/home/guzpido/T2gu/src/SpriteSheet.h:49).

The process-lifetime sprite cache retains trimmed frames for every unique roster name loaded, and mirrored frames are cached lazily. Destroying a scene releases its entities but does not release those cached sprite assets. A long campaign can therefore retain substantially more than one chapter's working set. This is intentional caching, not proof of a leak.

The 815–1,283 MiB observed here came from separate instrumented cold-start processes. It does **not** establish the memory footprint after traversing all 25 chapters in one process or exercising all animations. Measure that scenario before setting minimum RAM expectations.

The repository explicitly records that offline per-frame/lazy-decoding changes were considered and declined. This report does not reopen that asset-pipeline decision. If memory pressure later justifies a change, first add cache accounting and measure whether bounded caching would help the actual campaign.

### A02 — Chapter 15 is a sequence of hunts, despite its defense description

**Addressed in batch eight:** dialogue and quest comments describe the
implemented hunt-and-return flow. The findings below preserve review history.

Sources: [chapter15.js:594](/home/guzpido/T2gu/assets/scripts/chapter15.js:594), [chapter15.js:639](/home/guzpido/T2gu/assets/scripts/chapter15.js:639), [chapter15.js:647](/home/guzpido/T2gu/assets/scripts/chapter15.js:647), [GameScene.cpp:1902](/home/guzpido/T2gu/src/GameScene.cpp:1902).

Wave spawn locations are at least four tiles, approximately 512 px, from the Light. Enemies' detection range is 440 px, their AI targets the controlled character, and the Light is an ordinary noncombat NPC. They are not given an objective that makes them head toward or damage the Light. The player may need to walk out and find them. Waves also require another conversation to begin, despite a nearby comment saying they follow automatically.

This is a gameplay/description mismatch, separate from M03. Either describe the implemented hunt-and-return flow or add an explicit objective/defense system. The Light's optional quest status after gate removal is intentional and is not classified as a missing-gate bug.

### A03 — Repository instructions and API documentation contain obsolete claims

**Addressed in batch eight:** the claims listed below are corrected, including
the retained readiness/RSS smoke checker. This table records the original review.

| Claim or implication | Current code/history | Suggested correction |
| --- | --- | --- |
| The new scene's timer is stopped during sprite population | H03 reproduces ticks during population | Correct the loading lifecycle after fixing it |
| Queued readiness callbacks run after population simply because they were queued later | Nested `processEvents()` runs them before population completes | Document an explicit readiness boundary |
| Many quests still unlock mandatory physical progression gates | Commit `c4777d8` deliberately removed hard gates from 16 chapters | Update quest tables and distinguish optional rewards from mandatory progression |
| Chapters 1–2 share one hub; the first level transition is to chapter 3 | Each has its own map, and chapter 1 loads chapter 2 | Update [SCRIPTING.md:408](/home/guzpido/T2gu/docs/SCRIPTING.md:408) |
| Current save version is 1 and missing-version saves are accepted | Current and minimum supported versions are both 2; missing version defaults to 1 and is rejected | Update [AGENTS.md:588](/home/guzpido/T2gu/AGENTS.md:588) and the stale comment at [MainWindow.cpp:637](/home/guzpido/T2gu/src/MainWindow.cpp:637) |
| Stats and sounds are flat catalogs | Files contain `stats` and `sounds` wrapper objects | Correct catalog examples and instructions |
| Intelligence is stored for a future system and has no gameplay effect | Fireball damage/cooldowns and casting eligibility use intelligence | Update `assets/characters/stats.json`'s catalog comment |
| Older 115/135-character roster figures describe the current roster | Current tree contains 99 character directories | Label historical measurements and refresh current counts |
| Chapter 25 spawns each new form where the previous one fell | It uses the original cell | Resolve L05 and align documentation |
| An 8-second, chapters-1–16 warning grep is sufficient startup verification | Current game has 25 chapters; these Debug cold starts took about 11.5–16.5 seconds including the post-population interval | Check population explicitly and cover all shipped chapters |

The old `timeout ... | grep ...` recipe can also hide process failures: a crash message may not match the selected words, and the pipeline does not preserve the game's exit status without additional handling. A timeout should be interpreted in relation to an initialization marker, not automatically as successful startup.

These contradictions matter because a future contributor following them literally can reintroduce removed gates, misunderstand catalog structures, or rely on a lifecycle invariant that is not true.

### A04 — Build and installation assumptions should be explicit

**Addressed in batch eight:** declared Qt 6.9 baseline, selectable portable
Release tuning, and GNUInstallDirs-aware discovery with executable regressions.
See fix progress for the actual tested Qt version and relocation limits.

Sources: [CMakeLists.txt:21](/home/guzpido/T2gu/CMakeLists.txt:21), [CMakeLists.txt:85](/home/guzpido/T2gu/CMakeLists.txt:85), [CMakeLists.txt:110](/home/guzpido/T2gu/CMakeLists.txt:110), [AssetPath.cpp:14](/home/guzpido/T2gu/src/AssetPath.cpp:14).

`find_package(Qt6)` declares no minimum version although code uses newer API such as `QImage::flipped`. Declare and test the actual supported baseline instead of leaving older Qt installations to fail during compilation.

Release `-march=native` is already documented as a deliberate local-build optimization. Keep it for that purpose; provide a clearly selectable portable build mode before distributing binaries to different CPUs.

Installation uses customizable `CMAKE_INSTALL_BINDIR` and `CMAKE_INSTALL_DATADIR`, but runtime asset discovery assumes `../share/t2gu2/assets`. The default `bin`/`share` layout is coherent; custom GNUInstallDirs layouts are not necessarily relocatable with that hardcoded lookup. Derive the relative runtime path from the configured layout or explicitly constrain supported layouts.

The generated desktop file intentionally uses the configure-time install prefix. Installation under a later `--prefix` does not rewrite its launcher path; this is already documented and should remain visible to packagers.

### A05 — Roster names are doing the work of entity identity

Source: [GameScene.h](/home/guzpido/T2gu/src/GameScene.h), [ScriptBridge.h](/home/guzpido/T2gu/src/ScriptBridge.h).

Dozens of enemies can share a roster key, while name lookup retains one pointer for a name. Talk/kill callbacks and quest bookkeeping also use roster names. Current chapters mostly manage this with reserved archetypes, spawn guards, and careful name exclusions, but it limits mechanics such as attributing a kill to a particular wave or reporting a particular boss's death position.

Batch seven removes the boss-position limitation by copying death coordinates
into the queued callback. It does not add persistent instance IDs or change
the roster-key lookup model; those remain considerations for future mechanics.

If extending those mechanics, give instances stable IDs while retaining roster names as asset/archetype keys. This can be incremental; it does not require an ECS or a replacement ownership graph. Validate NPC/companion/hostile name constraints in an asset/script check instead of relying solely on convention.

### A06 — Targeted executable checks would provide more value than broad restructuring

The current architecture is understandable: Qt ownership, a distinct script bridge, deterministic layout generation, and simple combat state. There is no demonstrated need to introduce an ECS, generic scene graph, or broad framework rewrite.

The largest maintainability risks are concentrated responsibilities and unenforced cross-file contracts. `GameScene.cpp` combines population, AI, combat, serialization, item effects, and audio policy; `MainWindow.cpp` combines scene transitions, input modes, and save orchestration. Once the correctness defects are fixed, extract cohesive helpers around these responsibilities without changing Qt ownership or the script-facing contract accidentally.

Copy-pasted generation helpers are an explicit engine constraint: scripts cannot import modules, and the reviewed copies match. A build-time check or generation step that proves matching helper blocks would improve maintenance without adding runtime module support. Generated maps and repeated script constants likewise deserve a repeatable consistency check.

One-off tools such as `upscale_2x.py` should be labeled as historical/non-idempotent transformations and guarded against accidental repeat application. The map generator's `--out` requires an existing directory; creating it or reporting a focused error would make scratch verification easier.

## What is working well

- All chapters populated successfully in the real engine, and checked assets and generated map structures were internally consistent.
- The Qt ownership model is direct and matches the project scale. `ScriptBridge` keeps the external API distinguishable from implementation details.
- Waiting coroutine events are queued instead of dropped; the identified gap concerns active ordinary functions and nested event processing.
- Seeded generation, one shared placement pool, solid maze barriers, and the split between core and edge props provide useful structural guarantees. The approximate reachability check found no inaccessible checked entities once intended gates were lifted.
- Trimmed, shared sprite frames avoid retaining full decoded sheets per character. The full-cell anchoring contract remains worth preserving.
- The spatial blocking grid and viewport-limited painting address measured costs without replacing the engine architecture.
- Following the leader's trail avoids the collision/grid disagreement that a blanket switch back to pathfinding would reintroduce.
- Saves use `QSaveFile`, support version rejection, avoid depending on the original absolute asset root, and suppress artificial party follow correction after restoration. These are good foundations; incomplete state and readiness ordering remain the weaknesses.
- Inventory sorting is deterministic, and scene transitions deliberately stop the retired scene's tick timer.

## Suggested repair order and regression checks

1. **Stabilize mutation and initialization boundaries:** H01, H03, and M01. Reproduce a kill that spawns enemies; test cold and warm initialization; assert no tick or restore runs before population readiness.
2. **Repair campaign continuity:** H02. Exercise chapter exits with every optional recruit absent, one absent, and all present. Keep the intentional optional-quest design.
3. **Make restoration coherent:** M02–M05. Test overlapping item anchors, a partially consumed wave, a dead follower receiving an HP upgrade, and every active temporary buff across quickload.
4. **Protect movement and input:** M07, M10–M12. Test supported maximum movement speeds against thin blockers, unreachable path targets, delayed dialogue during inventory, and desktop focus loss.
5. **Make asset/API changes reliable:** M06, M08, M09, M13, then the low-priority rendering/UI/tool findings. Verify actual repainting after tileset swaps and graceful failure on invalid maps.
6. **Update the docs and retain small checks:** keep sanitizer fixtures, a campaign-state harness, map/helper consistency checks, and guarded chapter population checks. Repeat broad tests when changes justify them; startup smoke alone cannot certify combat or quest completion.

These findings support focused repairs with clear validation. The review does not establish that all bugs have been found; it does establish specific failures that clean compilation and successful chapter startup currently miss.
