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

### Maze pathfinding optimization (2026-10-05)

The owner suspected pathfinding costs inside mazes. Source inspection found
that every A* call allocated two per-cell hash tables and a priority queue,
repeated map/prop-center checks for neighboring cells, and counted stale heap
entries against the 12,000-expansion cap. This is evidence of avoidable work;
no new runtime profile establishes pathfinding as the current bottleneck.

`findPath()` now retains a dense tile array for generation-stamped costs and
parents, plus heap capacity across searches. Walkability is evaluated lazily
once per queried tile until terrain or blocker revisions change. Successful
map/tileset loads, water transitions and blocking-grid insert/remove/clear
operations invalidate this cache; ordinary decorative terrain edits do not.
Temporary stuck-cell blocks are checked independently so their expiration
cannot leave stale cached obstacles. Stale queue entries are discarded before
expansion accounting, and equal estimated-cost ties prefer progress toward
the target. Endpoint bounds are checked before indexing the dense array.

Four-directional shortest-path search, blocked start/goal-center exceptions,
retry cooldowns, continuous movement collision and leader-trail following
remain in place. The change can choose a different equally short route.
Per-scene retained search storage scales with map cell count (16 bytes per
tile plus the heap), rather than only the cells explored by the latest call.
The existing map validation bounds this allocation to at most 1,048,576
cells; ordinary shipped maps are much smaller.

`T2GU_PROFILE_PATHFINDING=1` adds three-second summaries of combined
enemy/party AI time per tick, search average/maximum time, counts, successes,
expansion-cap failures, expanded cells and uncached walkability checks.
Combined AI includes search, trail/crowd steering and melee decisions, but
excludes movement integration, other simulation, rendering and presentation.
Search timing includes initial scratch allocation/cache invalidation and
waypoint reconstruction. Timing adds overhead and is disabled by default.
Use alongside `T2GU_PROFILE_RENDER=1` for an owner's manual maze session.

New opt-in regression cases compare routes against an independent BFS
reference through alternating maze turns and cover gate changes, temporary
blocks, blocked endpoints, clearing blockers, water edits, tileset swaps
and invalid endpoints. The Release game and Debug regression executable
were compiled. No tests, game launches or benchmarks were run, honoring the
owner's manual-verification instruction. Gameplay speedup and the relative
contribution of pathfinding remain unmeasured.

### Solo-maze stutter investigation (2026-10-07)

The owner reported continuing stutter in complex mazes even with only the
controlled hero. No T2gu2 process was running during inspection. This was a
source audit and diagnostic implementation, not a reproduced or measured hitch.

The controlled character's movement has no pathfinding call. Hostile melee
AI steers directly toward the hero; A* belongs to companion chase/rejoin
behavior. With one party member, the old `updatePartyAI()` still maintained
the leader trail, checked its recorded length and potentially sampled a
synthetic tail against terrain/blockers. That work now stops immediately in
solo play, and the trail is invalidated so a later recruit initializes it
from the leader's current position. This is bounded, unnecessary work;
inspection does not establish it as a substantial hitch source.

Movement collision sweeps terrain cells and nearby blocking-grid buckets,
rather than every maze prop. The September point-query timings precede the
current sweep implementation and cannot rule out a current collision cost.
The simulation's 16 ms QTimer had no explicit timer type. It now requests
`Qt::PreciseTimer`. Qt documents coarse timing as the default and permits
late delivery for all timer types under load; this change cannot fix a busy
GUI thread by itself. See [Qt's timer accuracy documentation](https://doc.qt.io/qt-6/qtimer.html#accuracy-and-timer-resolution).

Remaining paths relevant without a party:

- Every enemy and NPC still receives character updates, even far from the
  hero. Enemy AI, corpse cleanup, hostile casting and pickup scans run on
  the same GUI thread. Maze prop counts do not directly multiply these
  entity loops, but a large population can add work.
- Whistles are scheduled for living characters across the map. The first
  use of a sound creates a QSoundEffect and requests its WAV source;
  synchronous setup and subsequent backend callbacks can occur during play.
  Cached, already-playing effects avoid duplicate playback requests.
- Script callbacks can synchronously spawn a previously unused character.
  A cold sheet decode processes a roughly 181 MB image, then trims frames.
  Left-facing frames are mirrored lazily once and cached. Prop art also
  decodes/scales on first use. Settled walking does not repeatedly reload
  sheets, but quest ambushes and new boss forms can encounter cold assets.
- Process-lifetime sprite/prop caches retain assets across chapter changes.
  The current scene's roster count alone does not describe process memory
  pressure. Page faults, swap or OS scheduling can delay the GUI thread.
- Scene input queries, queued JavaScript/media callbacks and UI updates
  share the event loop with simulation. Existing paint/pathfinding profiles
  do not account for every event delivery or wait between ticks.
- When real tick intervals exceed 50 ms, the existing delta clamp discards
  elapsed simulation time. That produces slowdown alongside a hitch; it is
  a consequence of delayed ticks, not evidence identifying their cause.

`T2GU_PROFILE_RUNTIME=1` now reports every three seconds after readiness:
tick wall duration, actual start-to-start interval and previous-end-to-next-
start gap (p50/p95/max), stage total/max/call counts, current entity counts,
and delta-clamp count/discarded time. Stages cover visual animation timers,
script tick, each AI pass, combat/cleanup, pickups, character updates and
UI/input/camera callbacks. Nested samples cover actual character movement
collision sweeps, sound/music setup, JavaScript calls including queued
dispatch, cold sprite/prop loading and first mirrored-frame creation.
No paint/backend/driver behavior was changed.

The normal executable times outer GUI-thread QApplication event deliveries
and records the count above 16 ms plus the slowest receiver class/event type.
Nested delivery is counted inside its outer event, avoiding duplicate event
counts. Events can include entire simulation ticks or paints; this is broad
event-loop visibility, not independent CPU attribution. Qt/platform work
outside `notify()` and compositor/GPU waits are not separately traced.

Linux adds per-tick GUI-thread CPU-time percentiles, process-wide minor/major
fault and voluntary/involuntary context-switch deltas, plus current VmRSS and
VmSwap. A fault counter is not proof of swapping. Low CPU time with high wall
time suggests blocking/preemption; low tick cost with long intervals locates
the delay outside simulation, including normal timer waits. Stage timings
and nested/event timings overlap and must not be summed. Reporting is bounded
and opt-in, with overhead; report logging appears in the next interval. A
boundary event can be recorded in the following report. Loading/resume resets
the diagnostic baseline so a deliberate transition is not a gameplay gap.

Use the README's combined runtime/render/pathfinding command, compare an open
area with the dense maze after loading, and keep the raw log. The Release
binary compiled successfully. No tests, game launches or runtime benchmarks
were run, following the owner's manual-verification instruction. The cause
of the reported stutter and gameplay benefit remain unmeasured.

### First reproduced solo runtime trace (2026-10-07)

The owner ran the runtime command, then confirmed that it reproduced the
reported maze stutter. `/tmp/t2gu-runtime.log` contains 13 three-second reports
and 1,306 recorded ticks. A raw copy and parsed per-window summary are saved
under ignored `output/runtime-2026-10-07/solo-maze-runtime.log` and
`summary.json`. The startup identifies Intel Iris Xe OpenGL / Mesa 26.0.8
with the existing cache-flushing option. No explicit map identifier, route,
window dimensions or CPU timing for the long Qt callbacks was captured.

| Recorded quantity | Observation |
| --- | --- |
| Early tick intervals | Approximately 16.7 ms median in reports 2–4 |
| Later tick intervals | Approximately 80–83 ms median in several reports; 184.203 ms maximum |
| Simulation tick wall duration | Later medians 0.3–0.84 ms; 6.511 ms maximum across all reports |
| Movement collision per call | 0.080 ms maximum |
| Sound/music setup per call | 0.612 ms maximum |
| Script execution per call | 0.043 ms maximum; no sustained script activity matching the slow windows |
| Asset work | One 29.078 ms out-of-tick cold/mirrored asset sample; later maxima no greater than 5.994 ms |
| Memory | RSS 684.5–756.0 MiB, VmSwap 0 and no recorded major faults |
| Delayed simulation | 271 delta clamps; 8.462 seconds discarded over the recorded windows |
| Worst outer Qt event | GameScene MetaCall, 151.297 ms; repeated later GameScene MetaCalls around 84–98 ms |

These observations locate the sustained slowdown outside `onTick()` in this
reproduced session. Movement collision, AI, script execution, audio setup and
swapping do not account for the repeated 80 ms delays in this log. Async media
callbacks and unrelated scheduling were not exhaustively traced, so the result
does not rule them out in every possible session. At about 37 ticks per report,
the existing 50 ms clamp discards roughly 1.2 seconds from each three-second
window, explaining an additional visible movement slowdown.

The outer receiver name must not be read as a script diagnosis. Qt's
`QGraphicsScenePrivate::_q_processDirtyItems()` processes dirty items and then
immediately dispatches pending updates on its views; those updates synchronously
send window/viewport UpdateRequest events. See the
[Qt scene implementation](https://codebrowser.dev/qt6/qtbase/src/widgets/graphicsview/qgraphicsscene.cpp.html#444)
and [update-dispatch implementation](https://codebrowser.dev/qt6/qtbase/src/widgets/graphicsview/qgraphicsview_p.h.html#156).
Those sources display Qt 6.10.0; the installed headers report 6.10.2. They
establish why graphics work can be nested under a scene callback, not which
private slot ran in this exact capture. The existing observer records only
the receiver class/event type, not a private queued-method identity or stack.

The working inference is therefore scene-update/drawing/composition or a
wait within that path, rather than expensive simulation. The first trace
does not distinguish dirty-item processing, viewport drawing, GPU/driver waits
and Qt window presentation. It also lacks matching paint-profile output.

The runtime diagnostic now measures three nested scopes separately:

- GameScene queued MetaCall dispatch through its normal event handler.
- Window/viewport UpdateRequest deliveries, including those nested inside a
  scene MetaCall (the outer slow-event counter still avoids duplicate counts).
- GameView viewport painting through the existing base paint handler.

On Linux, each scope reports its wall total/max plus GUI-thread CPU total/max.
Comparing these with ordinary tick costs and the existing category paint
profile can distinguish CPU-heavy scene/draw work from blocking/preemption
and locate waits before, within or after viewport painting. The measurements
overlap and should not be added. CPU clocks are requested only for these broad
scopes and ticks, avoiding a syscall on each collision/prop paint sample.

The Release binary was rebuilt successfully after adding the probes. No
gameplay behavior, rendering configuration or synchronization was changed,
and the agent did not run tests or launch the game. Next manual capture:

```sh
T2GU_PROFILE_RUNTIME=1 T2GU_PROFILE_RENDER=1 ./build/T2gu2 2>&1 | tee /tmp/t2gu-runtime-detail.log
```

Repeat the open-area/maze route that reproduced the hitch. A precise root
cause and remedy remain pending this narrower trace.

### Detailed trace locates the stall in window updates (2026-10-07)

The owner completed the requested combined runtime/paint capture. The raw
`/tmp/t2gu-runtime-detail.log` is preserved as ignored
`output/runtime-2026-10-07/solo-maze-runtime-detail.log`, with its parsed
`detail-summary.json`. It contains 29 runtime reports, 30 paint reports and
2,859 recorded ticks. OpenGL and the existing Intel cache option remained
active; the trace alternates between smooth and slow windows with the same
4,551 scenery props in the scene. The logs do not record exact camera routes
or concurrent OBS activity; neither game nor OBS was running at inspection.

Report 8 provides matching call counts for all nested scopes, so their window
totals can be compared without mixing unlike populations. Smooth report 23
also has matching window-update/viewport-paint counts:

| Quantity, milliseconds | Slow report 8 | Smooth report 23 |
| --- | ---: | ---: |
| Simulation tick wall median | 0.870 | 0.124 |
| Tick start-to-start median | 79.845 | 16.541 |
| Window-update wall mean per call | 77.717 | 14.472 |
| Window-update GUI-thread CPU mean per call | 41.110 | 4.259 |
| Viewport-paint wall mean per call | 30.542 | 3.336 |
| Viewport-paint GUI-thread CPU mean per call | 30.014 | 3.299 |
| Window-update wall time outside viewport paint, mean | 47.175 | 11.137 |

All three slow nested scopes recorded 38 calls; the smooth window/paint scopes
recorded 169 calls each. Slow scene dispatch averaged 78.949 ms, only 1.232 ms
more than its nested window update. This constrains scene bookkeeping outside
the window update to a small portion of the observed stall, even though the
outer event is labelled GameScene MetaCall. It does not justify a scene-index
switch as the principal remedy.

The slow viewport paint consumed approximately 30 ms of actual GUI-thread
CPU per call. Subtracting its matched CPU total from the window-update total
leaves about 11.096 ms of additional CPU work. The remaining window-update
wall time outside paint is about 47.175 ms, including roughly 36.079 ms
without GUI-thread CPU execution. Thus both CPU-heavy drawing and additional
work/blocking outside viewport painting contribute; this is not merely a
cheap simulation waiting for its next timer. The wall-minus-CPU difference
can include blocking and preemption and is not a direct GPU measurement.

Nearby paint reports show scene-paint medians around 28–31 ms in sustained
slow sections, versus about 3–4 ms in smooth sections. Tiles often account
for about 10 ms in slow paint reports versus about 1 ms when smooth, and props
about 5–6 ms versus about 0.5 ms. These category timers surround drawing and
submission; they do not measure isolated shader/GPU execution. The existing
paint log label "CPU scene paint" is elapsed wall time; the new runtime CPU
clock provides the actual GUI-thread CPU values used above. Similar prop
callback counts across some smooth/slow reports do not imply identical
assets, overdraw, tile counts or driver state.

Other recorded work remains much smaller: movement-collision maximum 0.303 ms,
sound/music setup maximum 0.686 ms, script-execution maximum 0.087 ms. The
largest simulation tick was 9.015 ms, compared with a 185.327 ms maximum
interval. RSS ranged from 685.4 to 779.5 MiB, with no major faults or VmSwap.
There were 606 delta clamps and 16.537 seconds discarded over the recorded
reports. This reinforces the previous result: non-rendering simulation and
swapping are not the sustained bottleneck in these captures. It does not
exclude unobserved asynchronous work or different workloads in general.

The remaining investigation is the window drawing/composition/presentation
path, including its CPU work and waits. This trace cannot identify a particular
driver defect, texture-cache eviction, GPU dependency or swap/Wayland mechanism;
those need direct attribution before a specific remedy is claimed. No additional
rendering, simulation or synchronization change was applied on this reading.
The diagnostic binary was already built. Only evidence and documentation were
updated; no tests or game launches were performed by the agent.

### Wayland/KDE/Intel drawing and presentation probes (2026-10-07)

The owner clarified that the target is drawing and window composition/
presentation on Wayland with Intel drivers and KDE. The detailed trace already
places the sustained slowdown inside window updates: approximately 30.5 ms
scene paint and another 47.2 ms outside that paint in a slow report. The
additional interval is not yet attributable to a specific driver or compositor
operation. Memory swapping was absent; this does not exclude buffer-swap waits.

The source path provides specific measurement boundaries:

- [QOpenGLWidget](https://doc.qt.io/qt-6/qopenglwidget.html#frameSwapped)
  paints into a framebuffer texture; Qt later combines this with raster widget
  content. `frameSwapped` follows top-level composition and the potentially
  blocking window swap call. It does not establish when KWin displays a frame.
- [Qt's widget implementation](https://codebrowser.dev/qt6/qtbase/src/openglwidgets/qopenglwidget.cpp.html#806)
  calls `makeCurrent`/`flushShared` before emitting `aboutToCompose`. Therefore
  measuring only `aboutToCompose` to `frameSwapped` misses this earlier flush.
- [Qt's default backing-store compositor](https://codebrowser.dev/qt6/qtbase/src/gui/painting/qbackingstoredefaultcompositor.cpp.html#499)
  begins a QRhi frame, prepares raster backing-store texture updates and
  texture composition, then ends the frame.
- [Qt's Wayland EGL swap implementation](https://codebrowser.dev/qt6/qtbase/src/plugins/platforms/wayland/plugins/hardwareintegration/wayland-egl/qwaylandglcontext.cpp.html#403)
  can emulate a positive swap interval with `glFlush` and a frame-callback
  wait (100 ms timeout), followed by `handleUpdate` and `eglSwapBuffers`.
  This is an existing Qt path, not newly introduced synchronization. The
  inspected mirror is Qt 6.10.0; installed headers report Qt 6.10.2. This source
  lead does not prove which operation consumed the owner's measured delay.

Added opt-in `T2GU_PROFILE_PRESENT=1` diagnostics in `OpenGLViewport`, using
public Qt APIs and the same existing QOpenGLWidget renderer. Three-second
reports contain p50/p95/max and sample counts for:

| Measurement | What it includes / practical limit |
| --- | --- |
| `scene-paint` wall and Linux GUI CPU | QGraphicsView paint including submission and diagnostic query work |
| `paint-to-compose` wall and Linux GUI CPU | Latest unconsumed paint completion to aboutToCompose; shared-context flush, raster painting and any intervening event/scheduling delay |
| `compose-to-swap` wall and Linux GUI CPU | aboutToCompose to frameSwapped; Qt window composition and platform submission/waits, without isolating an individual call |
| `Qt-swap-interval` | Intervals between Qt swap-return notifications, including chrome-only compositions; not actual display intervals |
| `scene-GPU` | Delayed OpenGL elapsed-query results around scene paint, excluding later window composition; elapsed timeline can include GPU stalls/scheduling |

The probe logs actual platform, desktop, Qt/GL versions, cache option, GL context
swap interval, logical/pixel viewport dimensions, DPR, screen name and nominal
refresh rate. It makes the viewport context current before the query marker
when necessary (normally QPainter does this inside its paint operation), so
diagnostics can perturb timing. Eight reusable queries bound storage; a busy
pool skips measurement. Results are read only after `isResultAvailable`, per
the [Qt timer-query API](https://doc.qt.io/qt-6/qopengltimerquery.html).
No explicit flush, glFinish or unfinished-result wait was added. Query objects
are released with their owning context current, including context destruction;
the base widget's destructor cannot invoke a callback into destroyed members.
Reports discard delayed results from a previous scene/runtime generation.
Sample vectors are bounded at 1,024 entries each. Unsupported GL contexts and
software rendering retain their existing paint/runtime diagnostics.

Runtime profiling also records `raster-widget-paint`: nested Qt Paint event
delivery for non-GL widgets, including parent backgrounds and HUD/chrome.
These timings may overlap window updates/other raster deliveries and do not
measure backing-store texture upload cost. The original paint report's label
was corrected from CPU to wall time; its elapsed clock was never a CPU clock.

For manual capture on the specified platform:

```sh
QT_QPA_PLATFORM=wayland T2GU_PROFILE_PRESENT=1 T2GU_PROFILE_RUNTIME=1 T2GU_PROFILE_RENDER=1 ./build/T2gu2 2>&1 | tee /tmp/t2gu-present.log
```

Use an open area and the affected maze in the same run. Large scene GPU times
would support a GPU drawing/stall lead; large paint CPU with smaller GPU time
would support a submission/CPU lead. Large pre-composition gaps with cheap
raster paints would narrow investigation toward shared-resource flushing or
intervening event/scheduling work. Large composition wall time with little CPU
would support waiting/preemption in the platform window path. These are
interpretation guides, not diagnoses; the phase distributions and delayed GPU
samples are not aligned frame-by-frame and must not be subtracted or summed
as such. None measures KWin's actual presentation timestamps.

Release rebuild passed. No tests or game launches were performed, honoring
the owner's manual-verification instruction. Capture is pending. No compositor
configuration, swap interval, frame callback timeout, FPS default or Intel
cache-flushing workaround was changed; no performance improvement is claimed.

### Smooth presentation capture with Chrome and Tidal closed (2026-10-07)

The owner completed the first presentation capture and reported no noticed
spikes, adding that Chrome and Tidal had been closed. The raw log is saved as
ignored `output/runtime-2026-10-07/solo-maze-present-chrome-tidal-closed.log`;
`present-summary.json` preserves parsed presentation/runtime reports and a
summary. App closure is owner-reported, not independently instrumented.

Startup confirms Qt 6.10.2, Wayland, KDE, Mesa Intel Iris Xe (TGL GT2), Mesa
26.0.8-1ubuntu0.3, desktop OpenGL 4.6 and cache-flush=true. GPU timer queries
were supported, with zero pool skips across the reported windows. The viewport
was 1920x1128 physical/logical pixels, DPR 1, screen DP-2 at nominal 59.95 Hz.

| Recorded measurement | Result |
| --- | --- |
| Runtime windows / ticks | 41 / 7,426 |
| Tick interval window medians | 16.169–16.737 ms |
| Maximum simulation tick | 1.331 ms |
| Delta clamps / discarded simulation time | 5 / 98 ms |
| Scene paint window medians / maximum | 1.682–4.567 / 14.984 ms |
| Scene GPU elapsed window medians / maximum | 4.160–8.666 / 20.620 ms |
| Paint-to-compose window medians / maximum | 0.107–0.545 / 1.194 ms |
| Compose-to-swap window medians / maximum | 0.124–13.830 / 25.314 ms |
| Compose-to-swap CPU window medians | 0.123–1.398 ms |
| Maximum raster-widget paint delivery | 0.542 ms |
| Process RSS / VmSwap / major faults | 685.0–1726.7 MiB / zero / zero |

The sustained 80 ms interval/30 ms scene-paint pattern from the previous
stuttering recording did not recur. Most active-window swap-return medians
were approximately 16.7 ms. Composition wall time substantially exceeding
its CPU time is compatible with frame pacing/waiting at this cadence; it is
not itself evidence of a fault. The tiny pre-composition gaps and raster paint
costs do not identify either as an active bottleneck in this smooth session.
The previous stuttering capture had no matching public-signal/GPU probes, so
these new measurements cannot explain its 47 ms outside-paint cost directly.

There are still isolated intervals: maximum recorded tick gap 105.615 ms;
five clamps, versus 606 in the earlier detailed run. Swap-return intervals
also include a 474.921 ms maximum and a sparse initial window with 63.788 ms
median. The last paint report includes a 1.2 s interval. Scene-driven rendering
can skip unchanged frames, and scene/loading/pause timing can span such
intervals; a long paint/swap interval alone is not proof of stalled drawing.
Individual causes are not marked in this log, so do not claim all such gaps
were idle or that no spikes occurred whatsoever.

The first 26 runtime reports have 4,551 props and 11 NPCs, matching the earlier
scene configuration; enemies range from 46 to 40 as play progresses. Later
reports contain 6,185/5 and 7,356/7 props/NPCs. The initial counts make this
more useful than a wholly unrelated-map comparison, but exact maze location,
route and browser/media workload were not held constant. Newly enabled GPU
timer queries can also perturb scheduling. Closing both applications at once
does not isolate either one's effect. Competing CPU/GPU/compositor work is now
a useful investigation lead; a specific application, driver or KWin defect
has not been established.

The next discriminating comparison is the same save, maze segment and render
settings with both apps closed, Chrome alone open, and Tidal alone open,
recording whether media is actively playing. Preserve each log separately and
compare sustained tick/paint/GPU/composition costs. This remains manual work:
the agent did not reopen applications, launch the game, run tests or change
renderer/system settings during this log analysis. Only evidence and
documentation were updated; no rendering fix is claimed.

### Smooth comparison with Chrome open and Tidal playing (2026-10-07)

The owner repeated the presentation capture with Chrome open and Tidal playing
music, then explicitly confirmed that it stayed smooth. The overwritten
`/tmp/t2gu-present.log` was saved separately as ignored
`output/runtime-2026-10-07/solo-maze-present-chrome-tidal-playing.log`, with
`present-chrome-tidal-playing-summary.json`. The earlier closed-app evidence
is retained. Backend, Qt/Mesa version, cache option, display dimensions/DPR
and refresh metadata match the previous run.

The run contains 28 runtime/presentation reports, 5,083 ticks and zero delta
clamps/discarded time. Tick interval medians are 16.142–16.691 ms, maximum
48.584 ms; maximum simulation tick is 1.156 ms. All runtime reports show
4,551 props and 11 NPCs, with enemies decreasing from 46 to 37. This matches
the initial scene population of the closed-app run; exact routes and browser
activity remain uncontrolled.

| Measurement | Closed apps, initial 26 reports | Chrome open + Tidal playing, 28 reports |
| --- | --- | --- |
| Scene paint window median range | 1.682–3.254 ms | 1.799–3.504 ms |
| GPU scene window median range | 4.551–8.666 ms | 4.718–9.594 ms |
| Paint-to-compose window median range | 0.107–0.534 ms | 0.120–0.512 ms |
| Compose-to-swap window median range | 0.124–13.830 ms | 0.129–13.755 ms |
| Simulation delta clamps | 5 | 0 |

The new run's scene GPU maximum is 24.558 ms, pre-compose maximum 5.031 ms
and composition maximum 22.530 ms. Such individual outliers do not recreate
the original sustained 80 ms intervals/30 ms scene paints. RSS is
685.5–771.1 MiB, with no major faults or VmSwap. There were no GPU query pool
skips. The small differences in median ranges cannot be attributed to the
applications without matching route/content/workload. Opening both apps and
playing music did not reproduce the earlier problem, weakening app closure
as the explanation for the first smooth run. A particular Chrome, Tidal,
KWin or driver cause has not been established.

Both smooth captures share one additional variable absent from the older
stuttering trace: scene GPU timer queries. Query markers/polling and moving
the GL context binding ahead of QPainter can change command submission timing.
This is a plausible measurement effect to check, not proof that the probes
mask the issue. Added `T2GU_PROFILE_PRESENT_GPU=0` to disable GPU query
creation, markers and polling while retaining public-signal wall/CPU timing.
With no queries, beginScenePaint also skips the early makeCurrent, leaving
context binding to the ordinary QPainter path. Unset/nonzero values preserve
the existing optional queries; PRESENT profiling itself remains disabled by
default. Disabled GPU measurements report `n/a`.

The next manual comparison retains the same route/app workload and changes
only the GPU-query option:

```sh
QT_QPA_PLATFORM=wayland T2GU_PROFILE_PRESENT=1 T2GU_PROFILE_PRESENT_GPU=0 T2GU_PROFILE_RUNTIME=1 T2GU_PROFILE_RENDER=1 ./build/T2gu2 2>&1 | tee /tmp/t2gu-present-no-gpu.log
```

Release rebuild passed. No tests or game/application launches were performed.
The Intel cache-flushing workaround, frame scheduling and compositor settings
remain unchanged. No rendering performance fix or identified root cause is
claimed; the new flag supports a narrower diagnostic comparison.

### Stutter returns with GPU queries disabled (2026-10-07)

The owner ran the comparison with PRESENT profiling enabled but GPU queries
disabled, and confirmed that visible maze stutter returned. Evidence is saved
as ignored `output/runtime-2026-10-07/solo-maze-present-no-gpu.log` and
`present-no-gpu-summary.json`. Startup logs query request=false, GPU
queries=false, cache-flush=true and the same Wayland/KDE/Intel stack and display
metadata. All scene-GPU results are absent as expected.

Across 15 runtime/presentation reports / 2,117 ticks, 137 delta clamps discard
5.446 seconds. Tick interval medians range from 16.156 to 95.507 ms; maximum
gap is 221.571 ms, maximum simulation tick 5.074 ms. The run starts smoothly,
becomes slow in reports 11–14, then returns to smooth timing in report 15.
There are no major faults or VmSwap; RSS is 685.3–758.0 MiB.

| Slow report | Tick interval median | Scene paint wall / GUI CPU median | Paint-to-compose median | Compose-to-swap wall / GUI CPU median |
| --- | --- | --- | --- | --- |
| 11 | 95.507 ms | 17.382 / 17.386 ms | 2.182 ms | 64.497 / 6.160 ms |
| 12 | 75.880 ms | 27.406 / 27.135 ms | 3.071 ms | 36.819 / 7.851 ms |
| 13 | 77.519 ms | 29.868 / 29.201 ms | 2.946 ms | 34.945 / 7.904 ms |
| 14 | 67.090 ms | 30.074 / 29.495 ms | 1.738 ms | 30.473 / 1.141 ms |

These independently timed phase distributions must not be summed as aligned
frames. They establish that both CPU-heavy painting and non-CPU composition/
swap delay recur with the GPU timing probe disabled. In report 13, matched
window/paint counts give mean window update 75.720 ms and scene paint 30.068
ms. Scene bookkeeping and HUD raster work are not the sustained bottleneck.
A late mirrored-asset sample costs 47.336 ms in report 14, but it does not
explain the multi-report sustained drawing/composition slowdown.

This is stronger evidence for a rendering command/submission/timing effect
than the earlier app-load lead: two query-enabled captures were smooth, even
with Chrome open and Tidal playing, followed by an owner-confirmed slow
query-disabled capture. It is not yet an isolated GPU-query result, because
the disabled option also removes early viewport context binding. Locations,
OS/driver state and exact workload are not guaranteed identical across runs.
Do not treat the GPU timings from the smooth probe runs as measurements of
the uninstrumented slow path.

Source inspection narrows the next comparison:

- [Qt's GL paint engine](https://codebrowser.dev/qt6/qtbase/src/opengl/qopenglpaintengine.cpp.html#2189)
  calls ensureActiveTarget before context validation/engine setup. The
  [widget implementation](https://codebrowser.dev/qt6/qtbase/src/openglwidgets/qopenglwidget.cpp.html#629)
  binds its own context/FBO there. Early binding is therefore an ordering
  change to test, not evidence that ordinary Qt drawing uses the wrong context.
- Upstream [Mesa 26.0.8 source archive](https://archive.mesa3d.org/mesa-26.0.8.tar.xz)
  was already downloaded/verified in the October 5 investigation. Its
  iris_query.c was extracted as ignored
  `output/runtime-2026-10-07/iris_query-mesa-26.0.8.c`. Time-elapsed queries
  emit PIPE_CONTROL timestamp snapshots, and end-query availability uses
  ordered post-sync writes with FLUSH_ENABLE. iris_get_query_result can flush
  the current batch before returning unavailable even when wait=false.
  This distinguishes nonblocking lookup from absence of submission effects;
  it does not show that the conditional flush happened in these captures.
  Ubuntu downstream changes were not inspected.

Added an independent, default-off `T2GU_PROFILE_PRESENT_PREBIND=1` comparison.
With PRESENT=1 / PRESENT_GPU=0, it moves only the existing viewport context
binding before QGraphicsView painting. There are no GPU query objects,
markers, polls, explicit flushes or completion waits. It has no effect with
PRESENT profiling disabled. Reports include `early-context-binds` for both
query-enabled and prebind-only probes. This is a diagnostic option, not a
default rendering change or a confirmed fix.

```sh
QT_QPA_PLATFORM=wayland T2GU_PROFILE_PRESENT=1 T2GU_PROFILE_PRESENT_GPU=0 T2GU_PROFILE_PRESENT_PREBIND=1 T2GU_PROFILE_RUNTIME=1 T2GU_PROFILE_RENDER=1 ./build/T2gu2 2>&1 | tee /tmp/t2gu-present-prebind.log
```

Manual comparison should keep the same maze route and app workload. If early
binding alone remains slow, the query-command/polling behavior becomes the
stronger lead; if it is smooth, repeat confirmation can narrow the ordering
effect before changing ordinary rendering. Release rebuild passed; no tests
or game launches were performed. Existing Intel cache flushing and normal
renderer/frame scheduling remain unchanged.

### Early context binding does not remove stutter (2026-10-07)

The owner completed the prebind-only comparison and confirmed that stutter
returned. The log is preserved as ignored
`output/runtime-2026-10-07/solo-maze-present-prebind.log`, with
`present-prebind-summary.json`. Startup confirms query request=false,
queries=false, prebind-without-GPU=true and unchanged cache-flush=true,
Wayland/KDE/Intel/Qt/Mesa/display metadata. The probe performed 1,901 early
context binds across 1,901 scene paints, so this option did actually exercise
the intended context-ordering change.

Across 21 reports / 3,061 ticks, 182 delta clamps discard 6.498 seconds.
Maximum tick gap is 218.125 ms; maximum simulation tick 4.120 ms. Reports
6–9 have median tick intervals 75.575–107.266 ms, scene paints
27.130–42.179 ms and composition/swap 25.135–62.194 ms. Later windows recover.
Some sparse paint/swap intervals occur while ticks remain fast, and must not
be treated as blocked rendering without supporting stage costs. RSS is
684.9–737.8 MiB; no major faults or VmSwap. Context binding alone did not
reproduce the smooth query-enabled behavior. Keep it default-off rather than
claiming or shipping it as the fix.

The remaining controlled distinction is query commands versus availability/
result reads. Additional source inspection uses the previously verified
[Mesa 26.0.8 archive](https://archive.mesa3d.org/mesa-26.0.8.tar.xz), extracting
queryobj.c, glthread.c and u_threaded_context.c into ignored
`output/runtime-2026-10-07/mesa-query-source/`. Query handling now lives in
queryobj.c rather than the older st_cb_queryobj.c path. In this upstream source:

- `_mesa_check_query` calls get_query_result with wait=false.
- `tc_get_query_result` conditionally calls tc_sync when the query has not
  been marked flushed. This can wait for queued CPU driver work and execute
  unflushed calls directly before asking Iris for the result.
- Iris result lookup can also submit a current batch, while query begin/end
  emit timestamp and ordered availability commands as described above.

These are conditional driver paths, not proof of the calls exercised in the
owner's captures. They explain why a nonblocking GPU query is not necessarily
free of CPU submission/scheduling effects. Actual compositor presentation
timestamps and exact driver/kernel wait attribution remain unmeasured.

Added `T2GU_PROFILE_PRESENT_POLL=0` to keep query commands but remove all
availability checks/result reads. With PRESENT=1 / PRESENT_GPU=1, it rotates
through the same eight timer-query objects, begins/ends one around scene
painting and discards old results. Beginning an ended query resets its result;
the [Gallium query contract](https://docs.mesa3d.org/gallium/context.html#queries)
also explicitly specifies result reset on begin_query. No completed-result
requirement, explicit GL flush or GPU completion wait is added. Driver-managed
resource allocation/scheduling effects still belong to the query-command
side of this comparison. `GPU-query-begins` records actual issuance; GPU elapsed
statistics report n/a because results are deliberately never read.

```sh
QT_QPA_PLATFORM=wayland T2GU_PROFILE_PRESENT=1 T2GU_PROFILE_PRESENT_GPU=1 T2GU_PROFILE_PRESENT_POLL=0 T2GU_PROFILE_RUNTIME=1 T2GU_PROFILE_RENDER=1 ./build/T2gu2 2>&1 | tee /tmp/t2gu-present-markers.log
```

This keeps the early binding used by the original query-enabled probe and
changes only polling/result retrieval. Keep the same maze/app workload. A
smooth marker-only capture would strengthen the command-ordering lead; a
slow one would strengthen the availability/polling/submission lead, subject
to repeat confirmation and uncontrolled route/OS state. Default profiling and
normal rendering behavior remain unchanged. Release rebuild passed; no tests
or game launches were performed. Manual comparison is pending.

### Query commands without result polling also stutter (2026-10-07)

The owner completed the marker-only comparison and confirmed visible maze
stutter. Raw evidence is saved as
`output/runtime-2026-10-07/solo-maze-present-markers.log`, with
`present-markers-summary.json`. Startup records query request=true,
queries=true, result polling=false and cache-flush=true on Wayland/KDE/Intel.
The probe issued 994 query begins and performed 994 early context binds for
994 scene paints; GPU result statistics remain n/a.

Ten reporting windows contain 1209 simulation ticks, 166 delta clamps and
4.418 seconds discarded by the unchanged 50 ms cap. Slow-window interval
medians are 63.932–83.439 ms, while simulation execution peaks at 3.044 ms.
Scene-paint window medians reach 35.566 ms (maximum 89.175 ms), and
compose-to-swap medians reach 44.263 ms (maximum 71.637 ms). RSS remains
685.1–704.8 MiB, with no VmSwap or major faults. Query commands and early
context binding together therefore did not reproduce the smooth behavior.
Only the full probe with availability/result polling has stayed smooth in
the observed comparisons. Exact routes and OS state remain uncontrolled;
the source lead is conditional, not a diagnosed Mesa or compositor defect.

The verified upstream Mesa 26.0.8 source defines
`intel_disable_threaded_context` in src/util/driconf.h and
src/gallium/drivers/iris/driinfo_iris.h. iris_screen.c reads the option and
iris_context.c bypasses threaded_context_create when it is true; xmlconfig.c
accepts process environment overrides. This disables the Iris Gallium driver
worker, a separate mechanism from Mesa GL API threading (`mesa_glthread`).
Since tc_get_query_result can synchronize that worker before checking results,
the next comparison disables it without issuing GPU queries:

```sh
intel_disable_threaded_context=true QT_QPA_PLATFORM=wayland T2GU_PROFILE_PRESENT=1 T2GU_PROFILE_PRESENT_GPU=0 T2GU_PROFILE_PRESENT_PREBIND=0 T2GU_PROFILE_RUNTIME=1 T2GU_PROFILE_RENDER=1 ./build/T2gu2 2>&1 | tee /tmp/t2gu-present-no-thread.log
```

Keep the same maze and app workload. Startup diagnostics now log the requested
thread-context option. Mesa may also print its environment-override notice;
neither message proves that the baseline actually created a threaded context.
A smooth run would strengthen the driver-worker scheduling lead, subject to
repeat comparison. A slow run would leave result-lookup batch submission and
other polling effects under investigation. The game applies no automatic
thread override; the integrated cache workaround and normal rendering defaults
remain intact. Release rebuild and `git diff --check` passed. Manual verification
is pending. No tests or game launches were performed.

### Disabling the Iris driver worker also stutters (2026-10-07)

The owner completed the process-only threaded-context comparison and confirmed
visible maze stutter. Saved evidence is
`output/runtime-2026-10-07/solo-maze-present-no-thread.log` and
`present-no-thread-summary.json`. Mesa prints its
intel_disable_threaded_context environment-override notice; startup records
the requested value=true, GPU queries=false, prebind=false and cache-flush=true
on the same Wayland/KDE/Intel stack. There are no GPU query begins or early
context binds in this capture. Baseline worker creation remains unmeasured.

Twelve reporting windows contain 1610 simulation ticks, 142 delta clamps and
2.794 seconds discarded by the unchanged 50 ms cap. Slow-window tick interval
medians are 44.423–73.051 ms, while simulation execution peaks at 3.658 ms.
Scene-paint window medians reach 42.605 ms (maximum 106.122 ms), and
compose-to-swap medians reach 24.673 ms (maximum 94.399 ms). In reporting
window ten, scene-paint wall/CPU medians are 42.605/40.928 ms, while
compose-to-swap wall/CPU medians are 24.673/7.682 ms. Drawing therefore consumes
substantial GUI CPU time as well as the observed composition wait; phase
medians are not additive or exact per-frame attribution.

RSS remains 685.2–717.7 MiB without VmSwap. One major fault occurs in the first
reporting window, with none during the sustained slowdown. All windows retain
one party member, 46 enemies, 11 NPCs, 4551 props and 32 items. Disabling the
Iris driver worker alone did not reproduce the smooth full-query behavior.
Mesa GL API threading is a separate mechanism: inspected upstream
src/gallium/frontends/dri/dri_context.c accepts mesa_glthread independently,
and glthread.c implements CPU queue synchronization. Neither mechanism's
baseline state was sampled, and no automatic driver-thread override is added.

The next manual capture records CPU call stacks to attribute active drawing
cost instead of relying solely on phase timings. The installed perf reports
version 7.0.14; kernel perf_event_paranoid is 1 and maximum sample rate is
31000 Hz. Those read-only checks establish tool availability and configuration,
not permission or successful stack unwinding for a recording. The prepared
command requests process/worker user-space cycle samples at 99 Hz with 8192-byte
DWARF snapshots, retaining the existing wall/CPU diagnostics with GPU queries
and prebinding off:

```sh
QT_QPA_PLATFORM=wayland T2GU_PROFILE_PRESENT=1 T2GU_PROFILE_PRESENT_GPU=0 T2GU_PROFILE_PRESENT_PREBIND=0 T2GU_PROFILE_RUNTIME=1 T2GU_PROFILE_RENDER=1 perf record -o /tmp/t2gu-maze-perf.data -e cycles:u -F 99 --call-graph dwarf,8192 -- ./build/T2gu2 2>&1 | tee /tmp/t2gu-maze-perf.log
```

The earlier inline environment override does not persist into this command.
Use the same maze/app workload and exit normally after reproducing stutter so
perf finalizes its data. Samples may perturb timing; symbol availability and
stack unwinding constrain function attribution. This records the game's CPU
work, not system-wide KWin stacks, GPU execution or off-CPU wait attribution.
Manual recording is pending. No C++ changes were needed for this step; no
tests, perf recordings or game launches were performed by the agent.

### CPU profile and clock-throttling lead (2026-10-07)

The owner completed the CPU capture and confirmed visible stutter. Saved
evidence under `output/runtime-2026-10-07/` includes solo-maze-perf.data,
solo-maze-perf.log, perf-summary.json, decoded perf-stacks.txt/perf-samples.json,
perf-slow-leaves.txt, perf-cycle-rate-analysis.json and hardware-after-perf.json.
The recording spans 36.172 seconds and contains 2058 user-cycle samples with
zero lost samples. Startup confirms GPU queries=false, prebind=false, default
thread override and cache-flush=true on Wayland/KDE/Intel. Eight reporting
windows contain 910 ticks, 117 clamps and 2.271 seconds discarded; interval
medians reach 71.525 ms, scene-paint medians 36.830 ms, and compose-to-swap
medians 33.335 ms. Simulation execution peaks at 2.341 ms. RSS is 684.7–699.9
MiB with no VmSwap or major faults.

Whole-record CPU percentages are dominated by initial PNG decoding. Decoded
stacks place that work in SpriteSheet::load and spawning during startup; it
does not recur during the later slowdown. A later eight-second selection,
monotonic 158080.5–158088.5, contains 627 samples with GUI leaf-cycle shares of
21.94% Qt Widgets, 20.74% Mesa Gallium, 20.54% Qt Gui and 14.17% libc. The Iris
gdrv0 thread contributes a further 9.11% in Gallium, establishing its presence
in the baseline capture. No GL API worker appears in the sampled thread names.
Qt stacks include drawSubtreeRecursive, processDirtyItemsRecursive, item
sorting, backing-store toTexture copies/detaches and raster texture uploads.
Mesa's private functions remain largely unresolved. Inclusive stack categories
overlap; these active CPU samples cannot attribute blocked driver/compositor
waits. Keep the existing NoIndex choice: sampling its work does not establish
that changing the scene index cures the slowdown.

There is a broader clock-rate lead. For consecutive main-thread samples
separated by 4–18 ms, period/wall-gap medians fall from multi-GHz rates to
0.34–0.36 GHz in seconds 22–28 after the first sample, then recover. The
slowdown spans ordinary Qt/Mesa work rather than a single new gameplay task.
This is consistent with a substantial CPU-clock reduction. It is not a direct
frequency measurement: the denominator includes off-CPU time, sample periods
adapt, and sample boundaries are approximate. No precise frame alignment or
thermal/power root cause is claimed from this derived estimate.

Read-only inspection after exit found intel_pstate active with performance
governor/EPP, turbo enabled, 400–4800 MHz CPU limits, balanced platform profile
and AC online. Package temperature was 86 C. Package/core throttle counts are
cumulative and were not captured during gameplay. The
[Linux intel_pstate documentation](https://docs.kernel.org/admin-guide/pm/intel_pstate.html)
explains that thermal stress or power-limit violations can force lower
P-states, and describes scaling_cur_freq's periodic feedback updates. These
facts motivate direct telemetry; they do not establish which limit, if any,
was active during this game recording.

The perf header reader warned `Invalid HEADER_EVENT_DESC`; event metadata was
unavailable in that header view. The report/script readers still decoded all
2058 cycles:u samples with timestamps, periods and stacks. Addr2line also
reported a Qt Gui debug-cache record error; resolved Qt frames are available,
but unwinding/symbol completeness remains a limitation. Original data and
header warnings are retained. No debug-package installation or online symbol
fetch was requested for analysis.

Added tools/profile_hardware.py for the next manual comparison. It records
read-only sysfs CPU frequencies, package/core throttle counters, temperatures,
AC/battery state and Intel GPU frequencies every 250 ms, plus perf stat
cycles:u/ref-cycles:u/task-clock intervals for the command and its threads.
Game log delivery receives monotonic timestamps in a separate JSONL file so
reports can be aligned to sensor snapshots. Missing/unreadable sensors become
null. Metadata captures policy settings and relevant environment values;
existing capture files are rejected rather than overwritten.

```sh
QT_QPA_PLATFORM=wayland T2GU_PROFILE_PRESENT=1 T2GU_PROFILE_PRESENT_GPU=0 T2GU_PROFILE_PRESENT_PREBIND=0 T2GU_PROFILE_RUNTIME=1 T2GU_PROFILE_RENDER=1 python3 tools/profile_hardware.py -- ./build/T2gu2 2>&1 | tee /tmp/t2gu-maze-hardware.log
```

Outputs are /tmp/t2gu-maze-hardware/{metadata.json,hardware.jsonl,
game-events.jsonl,counters.csv}. Reproduce the stutter and exit normally.
The next analysis should compare direct frequency readings, user-cycle/reference
ratios, throttle-counter deltas and temperatures against slow frame windows.
Sysfs feedback can lag, log timestamps measure delivery rather than callback
entry, and hardware/perf sampling adds overhead. The helper makes no governor,
thermal, driver or rendering changes. Python AST parsing and git diff checks
passed; the helper was not executed, and no tests or game launches were
performed by the agent. Manual hardware capture remains pending.

### Hardware capture confirms clock reduction during stutter (2026-10-07)

The owner completed the hardware-monitored run and confirmed visible stutter.
Raw metadata, hardware.jsonl, game-events.jsonl, counters.csv and capture.log
are saved in `output/runtime-2026-10-07/hardware-capture/`, with summary.json
and separate post-run power-limit/control snapshots. The capture lasts 59.670
seconds, with 14 runtime/presentation reports, 2023 ticks, 102 delta clamps and
3.874 seconds discarded. Simulation execution peaks at 5.870 ms; RSS remains
692.6–735.1 MiB with no VmSwap or major faults. Cache-flush=true remains logged;
GPU queries and early context binding are disabled.

Direct scaling_cur_freq readings for every logical CPU show approximately
400 MHz in capture seconds 30–33 and 50–55. The later plateau has per-CPU
sample ranges around 399.6–400.2 MHz. Perf user-cycle/reference-cycle ratios
independently fall to approximately 0.221 during these plateaus and recover
above 2 during faster periods. These observations confirm the clock reduction
suggested by the earlier sampled-cycle estimate. User cycles divided by task
time are lower because task-clock includes kernel time; do not equate that
ratio with an exact CPU frequency or assume a 3 GHz reference-counter rate.

| Reporting window | CPU frequency median across readings | GPU actual frequency median | Tick interval median | Scene-paint median |
|---|---:|---:|---:|---:|
| 12, sustained slow period | 400 MHz | 100 MHz | 82.005 ms | 41.984 ms |
| 13, sustained slow period | 400 MHz | 100 MHz | 81.871 ms | 32.732 ms |
| 14, recovery | 3494 MHz | 550 MHz | 16.440 ms | 3.638 ms |

Report windows are aligned by log-delivery timestamps. Runtime and presentation
report boundaries are close but not identical; this is window-level correlation,
not per-frame causality. GPU frequency may also fall when the slow CPU supplies
less work. The observed CPU reduction explains a substantial part of the
inflated drawing costs without identifying every composition wait or proving
that eliminating the reduction would cure all stutter.

All recorded core/package thermal-throttle counters remain unchanged (package
43420 throughout). Package temperature is 77–79 C during the worst plateau,
compared with 80–87 C in nearby faster windows; startup briefly reaches 94 C.
AC remains online and the battery Full throughout. Thus there is no recorded
new CPU hardware thermal-throttle event, but power limits, firmware control and
userspace thermal policy are still possible. No specific trigger is established.

Read-only host service inspection confirms thermald running with --adaptive
and power-profiles-daemon active. The installed CPU cooling-device order lists
rapl_controller, intel_pstate, intel_powerclamp, cpufreq and Processor. Post-run
snapshots show enabled package control through both MSR and MMIO: MSR long-term
limit 200 W / short-term 60 W; MMIO long-term 15 W / short-term 18.75 W. The
platform profile is balanced, CPU policy performance, turbo permitted, and
adapter-reported maximum 20 V / 3.25 A. These are post-run observations, not
limit changes measured during the plateau. Neither thermald nor the 15 W limit
is proven to be its cause. The
[Linux power-cap documentation](https://docs.kernel.org/power/powercap/powercap.html)
describes the constraint/enabled attributes and their units; the
[thermald project](https://github.com/intel/thermal_daemon) documents its
thermal-management role. No services, power limits, governors or thermal
protections were changed.

One exploratory sensor read followed recursive sysfs links and stalled. The
agent stopped only that diagnostic process, then switched to bounded patterns.
This happened after gameplay capture, so it did not affect recorded frame or
hardware measurements. Service inspection required access outside the sandbox;
it was read-only. Evidence collection does not justify disabling thermald or
raising power limits as an unverified workaround.

Extended tools/profile_hardware.py to record changing RAPL power constraints
and enable states, cooling-device current states, CPU governor/min/max limits,
intel_pstate controls, platform profile and adapter maximum ratings. Bounded
patterns avoid recursive sysfs traversal. Sensor records now contain read-start
and read-completion timestamps. The helper pauses 250 ms after each scan;
actual intervals include sensor read costs and are not guaranteed to be 4 Hz.
The next manual command preserves rendering/driver settings and uses a fresh
output directory:

```sh
QT_QPA_PLATFORM=wayland T2GU_PROFILE_PRESENT=1 T2GU_PROFILE_PRESENT_GPU=0 T2GU_PROFILE_PRESENT_PREBIND=0 T2GU_PROFILE_RUNTIME=1 T2GU_PROFILE_RENDER=1 python3 tools/profile_hardware.py --output-dir /tmp/t2gu-maze-power -- ./build/T2gu2 2>&1 | tee /tmp/t2gu-maze-power.log
```

Compare limit/cooling-state changes with the confirmed frequency plateaus and
frame slowdowns; unchanged controls would leave firmware/external-limit leads
open. Python AST parsing and git diff checks passed. No C++ rebuild was needed,
and no tests, updated-helper executions or game launches were performed by the
agent. Manual power-policy capture is pending.

### Power-policy capture traces the package-limit drop (2026-10-07)

The owner completed the power-policy capture and confirmed visible stutter.
They also clarified that KDE's power/CPU configuration is Balanced. Raw data,
timestamps, perf stat counters, log, summary and a post-run firmware-limit
snapshot are saved under `output/runtime-2026-10-07/power-capture/`.
Duration is 54.421 seconds, with 10 runtime/presentation reports, 1384 ticks,
91 delta clamps and 3.140 seconds discarded. Simulation execution peaks at
5.905 ms; RSS is 692.9–724.6 MiB without VmSwap. One major fault occurs in the
first reporting window. The Intel cache workaround remains active, and GPU
queries/prebinding remain disabled.

The enabled MMIO package long-term power constraint changes during gameplay:

| Capture time, seconds | MMIO long-term package limit | CPU frequency median across readings | Observation |
|---:|---:|---:|---|
| 28.565 | 13.750 W | multi-GHz | reduction starts from 15 W |
| 31.546 | 11.875 W | multi-GHz | further reduction |
| 34.587 | 9.875 W | falling | drawing begins to slow |
| 37.736 | 5.875 W | 2200 MHz | clocks fall afterward |
| 39.421 | 5.875 W | 400 MHz | GPU actual frequency 100 MHz |
| 41.053 | 5.000 W | 400 MHz | sustained slow period |
| 43.351 | 15.000 W | 400 MHz | limit restored before clock recovery |
| 45.676 | 15.000 W | 3100 MHz | clocks/timing recover after brief interruptions |

MMIO PL1 briefly falls again to 6.25 W around 44.137–44.940 s and 8.875 W around
46.065–47.086 s. The slow reporting window has interval median 82.978 ms and
scene-paint median 36.211 ms. Later interval/paint medians return to
16.754/3.647 ms. This provides the measured sequence of package-limit reduction,
clock reduction and slower drawing, followed by recovery. It strongly supports
package power restriction as a substantial cause of the observed slowdown.
Sensor scans are not atomic, and report timestamps measure delivery; these
times are approximate window-level observations, not exact command attribution.

Other controls remain unchanged throughout: platform profile balanced,
performance governor on every CPU, 400–4800 MHz limits, intel_pstate min/max
8/100%, turbo allowed, processor/powerclamp cooling states zero and fan state
one. MSR package PL1/PL2 remain 200/60 W while MMIO PL2 stays 18.75 W. AC and
adapter ratings stay constant. Package/core thermal counters gain five events
at approximately 2.157 s during startup; no new events occur during the later
gameplay slowdown. This differs from the previous capture's zero total delta
and does not establish that the startup thermal events caused the later cap.

Installed thermald is 2.5.11-0ubuntu1.1; power-profiles-daemon is 0.30-2. The
[upstream thermald v2.5.11 RAPL implementation](https://raw.githubusercontent.com/intel/thermal_daemon/v2.5.11/src/thd_cdev_rapl.cpp)
writes long-term constraint attributes and supports adaptive PL1 targets and
firmware PPCC ranges. This makes adaptive thermald a concrete writer candidate,
but the telemetry did not trace a process's writes. Firmware or another policy
component has not been excluded, and downstream package differences were not
audited. Post-run firmware attributes expose a 3–15 W long-term range with a
0.1 W step; the platform-profile driver identifies as dell-pc. These are
post-run source/context observations, not live attribution.

The next comparison selects KDE's existing Performance profile manually and
records the same workload with GPU queries/prebinding off. The
[Linux platform-profile documentation](https://docs.kernel.org/userspace-api/sysfs-platform_profile.html)
explains that profiles select automatic platform mechanisms and do not
guarantee achieved performance; thermal and other constraints still apply.
The observed platform advertises performance as an available choice. No
profile or system setting was changed by the agent, and no service was stopped.

```sh
QT_QPA_PLATFORM=wayland T2GU_PROFILE_PRESENT=1 T2GU_PROFILE_PRESENT_GPU=0 T2GU_PROFILE_PRESENT_PREBIND=0 T2GU_PROFILE_RUNTIME=1 T2GU_PROFILE_RENDER=1 python3 tools/profile_hardware.py --output-dir /tmp/t2gu-maze-performance -- ./build/T2gu2 2>&1 | tee /tmp/t2gu-maze-performance.log
```

The capture will verify the selected profile and whether the low PL1 limit
and frequency plateau recur. Keep the same maze/app workload; Performance
has not yet been verified as a cure. Added bounded firmware-limit/profile-driver
metadata to the hardware helper for this comparison. Python syntax and git
diff checks passed, with no tests, helper executions or game launches by the
agent. Performance-profile capture is pending.

### Battery comparison for the external-power lead (2026-10-07)

The owner requested a battery run because they suspect the outlet/power supply.
Prepare this comparison with the charger disconnected and KDE Balanced,
matching the recorded AC policy. Keep the same maze/apps for roughly 60–90
seconds, then exit normally. The proposed Performance comparison remains
unverified; the agent has not changed a profile or launched the game.

```sh
QT_QPA_PLATFORM=wayland T2GU_PROFILE_PRESENT=1 T2GU_PROFILE_PRESENT_GPU=0 T2GU_PROFILE_PRESENT_PREBIND=0 T2GU_PROFILE_RUNTIME=1 T2GU_PROFILE_RENDER=1 python3 tools/profile_hardware.py --output-dir /tmp/t2gu-maze-battery -- ./build/T2gu2 2>&1 | tee /tmp/t2gu-maze-battery.log
```

Extended hardware telemetry with available supply power/current/voltage-now,
capacity, temperature, health, USB type and input-limit attributes. Existing
AC-online/battery-status, platform profile, package limits and clock readings
provide the comparison's controls. Interpret units and optional attributes
according to the [Linux power-supply documentation](https://docs.kernel.org/power/power_supply_class.html).
Values are driver-reported; negotiated USB current/voltage ratings are not
physical outlet-quality measurements. No adapter fault was indicated by the
constant 20 V/3.25 A ratings in the previous capture, but those ratings cannot
rule out an external-power problem.

A smooth battery run with a stable package limit would support an AC-dependent
power-policy or external-power-path lead. It would not distinguish faulty
outlet, adapter, cable or AC-specific firmware/thermal behavior. Battery-only
operation also changes charging and platform conditions, even with the same
profile label; compare recorded limits/temperatures rather than relying only
on perceived smoothness. If the 5 W limit and 400 MHz plateau recur on battery,
the directly connected outlet/adapter lead weakens while package-policy leads
remain. Python syntax and git diff checks passed. The updated helper was not
executed; no tests, game launches or system-setting changes were performed by
the agent. Manual battery capture is pending.

### Battery transition restores power limit and drawing speed (2026-10-07)

The owner completed the proposed battery capture and reported that it stayed
smooth. Raw metadata, hardware JSONL, timestamped game events, perf counters,
terminal log and analysis are retained under ignored
`output/runtime-2026-10-07/battery-capture/`. The actual run starts on AC and
switches to battery in the sensor scan spanning capture seconds 25.566–26.860;
all subsequent scans show AC offline and battery Discharging. The platform
profile is **performance throughout**, with CPU governors performance and
unchanged 400 MHz/4.8 GHz frequency bounds. This is therefore a useful
within-run power-source transition, but not the requested battery-only Balanced
comparison. The agent did not change the selected profile.

Duration is 106.124 seconds, with 31 runtime/presentation reports and 5280
simulation ticks. There are 39 delta clamps and 2.190 seconds discarded,
including 37 clamps in the six early/transition reporting windows. RSS is
692.0–746.8 MiB with no swap or major faults. Simulation execution peaks at
11.434 ms; an early interval reaches 724.882 ms. Every three-second tick-interval
median stays around 16 ms, so this run's early stalls should not be equated
with the sustained 83 ms tick median in the previous AC capture.

| Observation | AC phase | After battery transition/recovery |
| --- | --- | --- |
| Enabled MMIO package PL1 | Falls to 5 W | Returns to 15 W; later varies 9.5–15 W |
| CPU frequencies | Approximately 400 MHz for several seconds; one snapshot median 200 MHz | Recover to GHz frequencies; no subsequent all-CPU low-clock plateau |
| Scene-paint window medians | 18.531–20.187 ms in slow windows | 2.064–4.718 ms in fully post-transition windows |
| Runtime delta clamps | 37 across early/transition windows | Two, discarding 16 ms across the final 25 windows / 4484 ticks |

The first battery snapshot already has the 15 W limit but still has roughly
400 MHz CPU clocks. The next scan, beginning at 27.111 seconds, shows a median
approximately 2.5 GHz across the logical CPUs; subsequent snapshots reach
higher clocks. Read-start and completion timestamps matter here: a slow sysfs
scan lasts about 1.3 seconds during the transition, and individual values are
read sequentially. These are correlated observations within a scan/report
window, not simultaneous measurements of each frame.

After recovery, Qt swap-return interval medians mostly approach 16.7 ms during
active drawing. Some gaps remain, including periods with fewer repaint calls;
these signals are not KWin display timestamps and the run is not a guarantee
of perfect pacing. The owner reports no visible maze stutter. Neither GPU
queries nor early context binding were enabled, and the Intel cache workaround
remained active.

Package thermal-throttle counters rise by 634 during the AC/startup phase and
by nine during the battery phase, for +643 overall. During the 5 W/low-clock
plateau the counter is unchanged and package temperature is about 77–79 C.
Recovery briefly reaches 94 C. Thus this capture includes hardware thermal
events, unlike the first hardware run, but they do not by themselves explain
the low-power plateau. Battery operation does not remove all power or thermal
control: the limit continues changing, with repeated resets before reaching
the prior 5 W floor. The process/firmware imposing those changes remains
unidentified.

The unplug transition strengthens an AC-dependent power-path or policy lead,
and Performance alone did not prevent the recorded AC slowdown. It does not
identify a faulty wall outlet, charger or cable: unplugging also changes
AC-specific firmware/thermal conditions. The next suggested manual comparison
holds the charger, cable, Performance profile and maze/apps constant while
using another wall outlet for 60–90 seconds:

```sh
QT_QPA_PLATFORM=wayland T2GU_PROFILE_PRESENT=1 T2GU_PROFILE_PRESENT_GPU=0 T2GU_PROFILE_PRESENT_PREBIND=0 T2GU_PROFILE_RUNTIME=1 T2GU_PROFILE_RENDER=1 python3 tools/profile_hardware.py --output-dir /tmp/t2gu-maze-other-outlet -- ./build/T2gu2 2>&1 | tee /tmp/t2gu-maze-other-outlet.log
```

A repeated 5 W/400 MHz slowdown would keep charger/cable and AC-specific
system-policy leads open. A smooth result alone requires repetition before
attributing the original outlet. No system settings, renderer behavior or C++
code were changed for this analysis; no tests or game launches were performed
by the agent. The other-outlet comparison remains pending.

### Power-limit writer attribution prepared; outlet trial skipped (2026-10-07)

The owner explicitly skipped the other-wall-outlet comparison and requested
continuing the investigation. No outlet trial was performed. Read-only host
service inspection confirms thermald PID 1921 running with --adaptive and
power-profiles-daemon PID 3265 active. The host exposes the loaded
intel_rapl_common module's BTF and rapl_write_pl_data/set_power_limit symbols;
bpftrace 0.25.0 is installed. Kernel lockdown reports none, while unprivileged
BPF is disabled and passwordless sudo is unavailable.

Added `tools/trace_power_limits.bt`, a narrow observer for entry and return of
`intel_rapl_common:rapl_write_pl_data` when its operation is PL_LIMIT. The
[upstream Linux v7.0 RAPL implementation](https://github.com/torvalds/linux/blob/v7.0/drivers/powercap/intel_rapl_common.c)
defines that operation as 2 and takes the requested power in microwatts before
hardware conversion. Runtime BTF supplies the domain/interface structure
layouts. The observer logs PID/TID/process name, interface (MSR/MMIO/TPMI),
domain, limit number, requested microwatts, a bounded kernel stack and return
status. A REQUEST is an attempt; RESULT status zero means driver acceptance.
The [bpftrace monotonic clock](https://bpftrace.org/docs/release_025/stdlib#nsecs)
aligns with the existing hardware/game log timestamps.

This observes kernel-mediated power-limit writes without changing any limits,
profiles or daemon behavior. Firmware writes or direct-register accesses that
bypass the probed function are outside coverage. Missing events must be
interpreted together with successful attachment, read/lost-event warnings and
hardware changes; absence alone does not identify firmware as the writer.
Thermald remains a candidate rather than an established cause.

Both sandboxed and approved host codegen attempts fail on root-only tracing
metadata (`available_events`: Permission denied), before compilation can be
validated. No probes have been attached by the agent; no game/test has been
launched. The next manual capture starts the privileged observer in one
terminal and requires its RAPL_READY marker:

```sh
sudo bpftrace -B line -k tools/trace_power_limits.bt 2>&1 | tee /tmp/t2gu-power-writer.log
```

Then, in another terminal with AC connected and KDE Performance unchanged,
play the same maze/apps for 60–90 seconds:

```sh
QT_QPA_PLATFORM=wayland T2GU_PROFILE_PRESENT=1 T2GU_PROFILE_PRESENT_GPU=0 T2GU_PROFILE_PRESENT_PREBIND=0 T2GU_PROFILE_RUNTIME=1 T2GU_PROFILE_RENDER=1 python3 tools/profile_hardware.py --output-dir /tmp/t2gu-maze-writer -- ./build/T2gu2 2>&1 | tee /tmp/t2gu-maze-writer.log
```

After normal game exit, Ctrl+C stops the observer. The ordinary game process
does not run as root. Helper metadata now also collects bounded thermal trip
points, policies/modes and INTC1040 adaptive UUID attributes. A post-run read
finds several -274000 trip attributes alongside positive thresholds; these
placeholders do not establish an active invalid thermal trip, nor were these
attributes captured during prior runs. Do not infer a thermal-policy bug from
them alone. Syntax/diff validation of Python/documentation is separate from
the still-pending privileged probe validation and writer capture.

### Thermald confirmed as the limit writer; firmware thermal-policy lead (2026-10-07)

The owner completed the writer trace and reported "a little stutter". The
observer attached four probes and logged RAPL_READY 16.559 seconds before
hardware-capture start. The game exits normally after 68.845 seconds, with
19 runtime/presentation windows, 3011 ticks, 104 delta clamps and 952 ms
discarded. Simulation execution peaks at 5.779 ms; RSS is 693.5–774.7 MiB
without swap or major faults. AC is online, battery Charging and platform
profile performance throughout. Raw files, trace, summaries and post-run
firmware decode are retained under ignored
`output/runtime-2026-10-07/writer-capture/`.

**Writer attribution is now established for the observed limit changes.**
Every one of the ten captured power-limit requests comes from thermald PID
1921, TID 2236, MMIO interface 1, package domain, PL1. Every matching return
is status zero. The stack shows the sysfs constraint-write path, through
store_constraint_power_limit_uw/kernfs/vfs_write and the userspace write syscall.
This is direct runtime evidence, beyond the earlier source-code candidate.

| Capture second | Thermald request | Subsequent observations |
| --- | --- | --- |
| 37.535–41.578 | 14 / 15 / 13.655 / 15 / 14 W | Small limit changes; hardware quantizes 13.655 to 13.625 W |
| 44.609 | 13 W | CPU remains at GHz frequencies |
| 47.640 | 11 W | CPU remains at GHz frequencies |
| 50.670 | 7 W | Clocks progressively fall from GHz frequencies |
| 53.705 | 5 W | Next sampled CPU median ~400 MHz; drawing becomes much slower |
| 59.908 | 15 W | CPU still ~400 MHz initially, then recovers after ~62 s |

During the low-power windows, tick-interval medians reach 50.770/52.019/49.669
ms and scene-paint medians 22.704/26.280/23.179 ms. After recovery these are
16.741/16.561 ms and 2.935/2.408 ms respectively. Package thermal-throttle count
increases by 755 over the whole run, but remains at 46567 during the low-clock
plateau and initial recovery; package temperature there is roughly 77–79 C.
The observed mechanism explains this drawing slowdown without proving all
stutter shares the cause or that the daemon's thermal decisions are erroneous.

The trace includes six expected missing-map lookup warnings when the return
probe sees calls excluded by the entry probe's PL_LIMIT filter, plus one
discarded delete-return warning. The logged entry/return pairs are intact and
there are no reported lost events. Updated the return predicate to has_key and
checked the deletion result to avoid those warnings. The revised script has
not been attached by the agent. The saved log lacks RAPL_STOP; it is not proof
that the owner stopped the observer, so Ctrl+C remains the manual cleanup step.

Read `/sys/bus/platform/devices/INTC1040:00/data_vault` without changing any
firmware settings. Saved 1957 bytes, SHA256
`a3dae1fecf54bf33563152f62cc39b7b891ec820344cb3c0aaf46fbb1c6266cb`.
A bounded LZMA-alone decode yields 30725 bytes. Parsing according to the
[thermald v2.5.11 data-vault reader](https://github.com/intel/thermal_daemon/blob/v2.5.11/src/thd_gddv.cpp)
consumes both repositories (dptf/platform) and all 96 keys exactly. The initial
single-repository parsing assumption stopped at the second header; analysis
was corrected to handle both repositories. No data was executed or installed.
Saved raw/decompressed blobs, key/token tables and a readable policy summary.

Both default IETM.D0 PSVT and named sp14t-balance PSVT contain CPU power-control
entries targeting TSKN at 65 C (MAX) and 70 C (MIN). The data-vault PPCC power
minimum is 5000 mW / 5 W, distinct from the earlier kernel-exposed 3 W range.
TSKN reads 70.05 C throughout the restriction, then 69.05 C shortly before the
15 W restoration. That is a strong candidate thermal trigger; the daemon's
active in-memory trip/selected table was not directly inspected. The firmware
APAT contains targets named for Balanced and Performance that select the same
Balance PSVT, but their live selection cannot be inferred from names alone.
The [adaptive thermal engine](https://github.com/intel/thermal_daemon/blob/v2.5.11/src/thd_engine_adaptive.cpp)
builds and consolidates passive trips from such tables; firmware entries and
raw sysfs trip points need not equal its active in-memory thresholds.

This shifts the investigation toward platform thermal policy/sensor behavior
and its interaction with charging and load. An outlet or adapter electrical
fault remains unestablished. No daemon was disabled/restarted, no power or
thermal limits were changed, and no renderer defaults were altered. No tests
or game launches were performed by the agent. Python syntax and diff checks
passed; no C++ rebuild was needed. No repeat maze capture is requested at this
stage.

### Active thermal-policy snapshot prepared (2026-10-07)

The owner requested proceeding after the confirmed writer attribution. Local
DMI identifies a Dell Latitude 5420 with BIOS 1.56.0 dated June 30, 2026. Cached
APT policy lists installed/candidate thermald 2.5.11-0ubuntu1.1. Upstream
[v2.5.13 release notes](https://github.com/intel/thermal_daemon/blob/v2.5.13/README.txt)
include RAPL restore and adaptive/parser changes, but do not establish a cure
for the observed TSKN/5 W cycle. No package, BIOS or service changes were made.

The next useful read is the daemon's active in-memory trip/binding snapshot,
rather than another maze capture or an inferred rule from raw firmware alone.
The installed thermald system-bus policy allows root calls and denies default
callers. A host sudo -n GetZoneCount query fails because interactive
authentication is required. This is an authentication limit, not an automatic
approval rejection or an unanswered authorization question.

Added `tools/dump_thermal_policy.py`, using only a closed list of D-Bus Get
methods from the [v2.5.11 interface](https://github.com/intel/thermal_daemon/blob/v2.5.11/src/thd_dbus_interface.xml).
It records preference, sensors, cooling-device states, active zones, trip
temperatures/types and device bindings. Counts are bounded, calls have timeouts
and start/completion timestamps, and partial failures appear in JSON with a
nonzero exit. Start/end counts and profile/source readings help detect changes
during the sequential snapshot. The command uses busctl with auto-start
disabled; it does not start an inactive daemon, write settings, restart a
service or launch the game.

```sh
sudo python3 tools/dump_thermal_policy.py | tee /tmp/t2gu-thermal-policy.json
```

Python AST parsing and diff checks passed; live root-query validation remains
pending. The existing GameView T2GU_MAX_FPS=30 option can separately reduce
drawing load without changing simulation timing or thermal limits. It remains
an unverified mitigation for this power-policy slowdown, not a new default or
an established substitute for resolving the active thermal policy. No C++
changes, builds, tests or game launches were performed for this step.

### Active trips confirmed; lower drawing-load trial prepared (2026-10-07)

The owner completed the policy reader. It returns 68 successful calls in
0.156 seconds, with no errors and stable counts of 12 sensors, 15 cooling
devices and seven zones. AC remains online and platform profile performance.
Raw JSON and summary are saved under ignored
`output/runtime-2026-10-07/active-policy/`.

| Active zone | Passive trip temperatures | Bound controller |
| --- | --- | --- |
| TSKN | 66, 70, 99 C | rapl_controller_mmio, device 12 |
| NGFF | 47.5, 49, 65, 99 C | Same device |
| TMEM | 99 C | Same device |
| TCPU | 102 C | Same device |

Trip type 3 is PASSIVE and type 5 is POLLING, according to the
[installed-version trip definitions](https://github.com/intel/thermal_daemon/blob/v2.5.11/src/thd_trip_point.h).
Polling trips have no cooling-device binding. The MMIO device's min_state is
15000000 and max_state 5000000: these are the cooling action endpoints,
unthrottled 15 W to greatest cooling 5 W, not reversed hardware power bounds.
Its current state is 15 W at snapshot time, with TSKN 62.05 C and NGFF 55.05 C
after the game run. Active bindings therefore confirm the earlier TSKN rule
lead, while multiple zones sharing the controller prevent attribution of each
previous write to one exact trip from this snapshot alone.

Stored trip sensor_id numbers differ from the D-Bus reader's sensor enumeration
positions. Those number spaces should not be equated without checking the
daemon's lookup semantics; no sensor-mapping defect is established. Thermald's
reported preference is ENERGY_CONSERVE while the platform profile is
performance. The [v2.5.11 preference implementation](https://github.com/intel/thermal_daemon/blob/v2.5.11/src/thd_preference.cpp)
defaults to ENERGY_CONSERVE. This difference alone is not evidence of a KDE
configuration error, and no preference override was performed.

Prepare a reversible mitigation using the already implemented T2GU_MAX_FPS=30
scene repaint cap. Reducing drawing load may keep the platform away from the
low-power floor while retaining existing thermal protection; this remains a
hypothesis until measured. Hold AC, Performance profile, maze/apps and diagnostic
flags constant, play for roughly 90 seconds and exit normally:

```sh
QT_QPA_PLATFORM=wayland T2GU_MAX_FPS=30 T2GU_PROFILE_PRESENT=1 T2GU_PROFILE_PRESENT_GPU=0 T2GU_PROFILE_PRESENT_PREBIND=0 T2GU_PROFILE_RUNTIME=1 T2GU_PROFILE_RENDER=1 python3 tools/profile_hardware.py --output-dir /tmp/t2gu-maze-30fps -- ./build/T2gu2 2>&1 | tee /tmp/t2gu-maze-30fps.log
```

Check that the startup reports the 30 FPS scene cap, then compare PL1, CPU
frequencies, sensor readings, delta clamps and owner-perceived stutter against
the uncapped writer run. Simulation timing remains independent. Exposure and
Qt window composition can cause additional frames; this is not a guarantee of
all-window presentation rate. No new C++ changes, builds, tests, agent game
launches or system-setting changes occurred. Diff checks passed. Mitigation
capture remains pending and no default frame-rate change has been made.

### First 30 FPS trial: little stutter, no low-power plateau (2026-10-07)

The owner completed the prepared capture and reported "very little stutter".
Raw files and parsed summary are saved under ignored
`output/runtime-2026-10-07/30fps-capture/`. Startup confirms OpenGL, the Intel
per-draw cache option, the 30 FPS scene repaint cap, and disabled GPU queries
and early context binding. The game exited normally with status 0.

| Measure | First capped trial |
| --- | --- |
| Capture duration / hardware scans | 55.728 s / 167 |
| Runtime reports / ticks | 15 / 2787 |
| Delta clamps / discarded time | 1 / 17 ms, first report only |
| Simulation interval medians | 15.943–16.682 ms |
| Maximum simulation work | 1.594 ms |
| Scene paint medians | 1.927–2.943 ms |
| MMIO package PL1 | 15 W throughout sampled scans |
| Median frequency across CPUs | 1178.84–4300 MHz, no <=500 MHz scan |
| Package throttle count increase | 0 |
| RSS / swap / major faults in reported windows | 691.4–736.0 MiB / 0 / 0 |

The severe low-power slowdown is absent in this capture. This is a promising
result, but not a controlled attribution to the repaint cap. AC/performance
remain selected, while the battery is now Full (100%, about 1 mA), compared
with Charging (98%, 464–493 mA) in the writer capture. TSKN starts at 50.05 C
and peaks at 55.05 C rather than starting at 67.05 C and reaching 70.05 C;
NGFF remains 46.05–47.05 C rather than 59.05–60.05 C. The window reports
HDMI-A-1, 1920x1008, 60 Hz, compared with DP-2, 1920x1128, 59.95 Hz earlier.
The owner confirms changing the monitor or connection. Background apps and
whether the remaining stutter is occasional or continuous await clarification.
Duration is also shorter than the writer run, whose 5 W write occurred at
53.705 seconds and whose clock/drawing recovery followed after 60 seconds.

Residual scene repaint p95 intervals reach roughly 49–52 ms in several later
windows, with maxima around 100–102 ms. During those windows Qt composition
can run more often than scene painting (153–178 swaps versus 82–91 paints per
report), with compose-to-swap wall medians about 11.6–13.4 ms and much smaller
CPU medians, about 0.7 ms. This leaves frame pacing/window composition as a
lead for the remaining visible stutter. It does not establish a compositor
defect: unchanged scenes deliberately skip paints, and Qt frameSwapped does
not report actual KWin display time. The first report's idle/startup intervals
also must not be counted as continuous movement stalls.

Keep the cap opt-in. A sustained comparison using the same display, charging
state, starting temperatures and background apps is needed to separate its
effect from those changes. No C++ modifications, rebuilds, tests, agent game
launches or thermal-setting changes were made for this analysis.

The proposed uncapped comparison was declined: the owner says the monitor is
not the cause and repeating degradation is unnecessary. Do not request another
uncapped or monitor comparison as the next step. Measurement confounds above
remain recorded; the owner's preference guides the investigation.

### Avoid repeated composition of unchanged status messages (2026-10-07)

Source inspection found a concrete independent repaint source in
`StatusMessageWidget`: a repeating 33 ms timer called `update()` throughout
both the 2600 ms opaque hold and 900 ms fade. The opaque text and box have no
changing pixels during the hold. These raster-widget updates can trigger
window composition independently of the scene repaint cap, consistent with
the capped run's extra composition counts. The capture does not attribute
all extra swaps to this widget.

Use a single-shot timer that waits for the earliest line's fade boundary.
Only fading or removal requests an animation repaint; posts and repeated
message counts still repaint immediately. Preserve any earlier pending timeout
so frequent posts cannot postpone older fades indefinitely. Hold/fade timing,
colors, layout, five-line limit and coalescing behavior remain unchanged.
Existing fade ticks still use 33 ms and can cause composition between scene
frames; no claim of a whole-window 30 FPS cap is made.

The owner-authorized Release rebuild succeeded, and diff whitespace checks
passed. No tests or game launches by the agent. This reduces demonstrably unnecessary work; live
composition counts, stutter and thermal-limit effects remain unverified.
No thermal management, GPU cache workaround, simulation timer or default
frame-rate settings were changed. The next useful manual verification retains
T2GU_MAX_FPS=30 and the same diagnostic flags, with a fresh output directory:

```sh
QT_QPA_PLATFORM=wayland T2GU_MAX_FPS=30 T2GU_PROFILE_PRESENT=1 T2GU_PROFILE_PRESENT_GPU=0 T2GU_PROFILE_PRESENT_PREBIND=0 T2GU_PROFILE_RUNTIME=1 T2GU_PROFILE_RENDER=1 python3 tools/profile_hardware.py --output-dir /tmp/t2gu-maze-overlay-30fps -- ./build/T2gu2 2>&1 | tee /tmp/t2gu-maze-overlay-30fps.log
```

### Game-side latency during OBS recording (2026-10-05)

The owner clarified that latency/stutter occurs in the game itself while
OBS records. Neither process was running during a read-only process check,
so no concurrent-load measurements were captured. OBS's
[performance guide](https://obsproject.com/kb/encoding-performance-troubleshooting#limit-the-game-framerate)
recommends limiting game rendering to leave capture/composition headroom.
This is a plausible contention lead, not a diagnosis of this session's
CPU, GPU, encoder, memory bandwidth or compositor bottleneck.

`T2GU_MAX_FPS` now optionally limits routine scene/camera repaints independently
of the simulation timer. At `30`, a precise nanosecond `QChronoTimer` requests
at most 30 full viewport updates per second when the scene/camera is dirty.
Qt's `NoViewportUpdate` disables automatic item/camera redraws, coalescing
changes into the latest complete frame. A scene-change observer is rebound
after scene replacements; camera scrolls also mark the view dirty. An unchanged
scene does not become a continuous redraw loop. Missed timer deadlines do not
queue a render catch-up burst. Exposure/resize and widget composition can still
generate additional frames; this is not a hard cap on desktop presentations.

Both OpenGL and software fallback support the cap. Terrain in this complete
frame mode uses the existing reduced art-overlap padding. The default remains
scene-driven rendering; empty/unset/zero disables the limit. Integer limits
1–240 are accepted; invalid settings log a warning and retain normal updates.
Paint profiling includes the requested repaint limit. Movement/combat/input
code, the 16 ms simulation timer, 50 ms delta clamp, swap interval and the
Intel cache-flushing workaround are unchanged. No priority boosts, focus
guards, forced minimization, GPU waits or OBS settings changes were added.

The tradeoff is reduced visual sampling at low limits. Input/simulation
remain on the shared GUI thread, so actual scheduling delays can still affect
both; no claim of a guaranteed latency bound is made. This mode needs an
owner-controlled recording comparison in the same loaded maze/window size.
Both existing CPU diagnostics can be enabled for that comparison, but neither
measures GPU or encoder time.

Renderer regressions now cover frame-limit parsing, software fallback,
opaque/translucent pixels, latest item/camera positions after a burst
of changes, and subsequent item-only updates without camera motion. Desktop
GL variants cover the scheduled full-frame path. The Release game and Debug
renderer regression executable were compiled. No tests, game launches or
recording trials were run, following the owner's manual-verification rule.

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

Sources: [GameScene.cpp:1163](/home/guzpido/T2gu/src/game/GameScene.cpp:1163), [GameScene.cpp:1222](/home/guzpido/T2gu/src/game/GameScene.cpp:1222), [GameScene.cpp:2285](/home/guzpido/T2gu/src/game/GameScene.cpp:2285), [chapter25.js:650](/home/guzpido/T2gu/assets/scripts/chapter25.js:650).

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

Sources: [SpriteSheet.cpp:72](/home/guzpido/T2gu/src/assets/SpriteSheet.cpp:72), [GameScene.cpp:808](/home/guzpido/T2gu/src/game/GameScene.cpp:808), [MainWindow.cpp:295](/home/guzpido/T2gu/src/app/MainWindow.cpp:295), [MainWindow.cpp:302](/home/guzpido/T2gu/src/app/MainWindow.cpp:302), [MainWindow.cpp:318](/home/guzpido/T2gu/src/app/MainWindow.cpp:318).

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

**Status: reproduced.** Sources: [ScriptEngine.cpp:49](/home/guzpido/T2gu/src/scripting/ScriptEngine.cpp:49), [ScriptEngine.h:69](/home/guzpido/T2gu/src/scripting/ScriptEngine.h:69).

`startEntryPoint()` calls a plain JavaScript function while the engine still reports `Idle` and has no active iterator. If that function triggers nested Qt event processing through a sprite load, another gameplay event can call another handler immediately instead of queuing it. This violates the documented one-at-a-time execution contract even though waiting generators are correctly protected.

A plain `onLevelStart` fixture recorded `TICK_DURING_START busy=0` and `nested_pickup=1`: `onItemCollected` ran while the original population handler was still executing. The otherwise similar generator fixture reported busy and did not execute the pickup handler inside its population body.

**Repair:** track active execution with a guard around both ordinary function calls and generator steps. Queue entry points whenever execution is active, and drain them only after the current call has unwound. H03 and M01 need complementary fixes.

### M02 — Item rendering, pickup coordinates, and saved coordinates can disagree

**Status: reproduced.** Sources: [GameScene.cpp:905](/home/guzpido/T2gu/src/game/GameScene.cpp:905), [GameScene.cpp:2585](/home/guzpido/T2gu/src/game/GameScene.cpp:2585), [GameScene.cpp:2394](/home/guzpido/T2gu/src/game/GameScene.cpp:2394), [GameScene.cpp:2470](/home/guzpido/T2gu/src/game/GameScene.cpp:2470), [GameScene.cpp:2662](/home/guzpido/T2gu/src/game/GameScene.cpp:2662).

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

**Status: source-established integration defect; reset reproduced in the script harness.** Sources: [chapter15.js:545](/home/guzpido/T2gu/assets/scripts/chapter15.js:545), [chapter15.js:670](/home/guzpido/T2gu/assets/scripts/chapter15.js:670), [chapter15.js:699](/home/guzpido/T2gu/assets/scripts/chapter15.js:699), [GameScene.cpp:2383](/home/guzpido/T2gu/src/game/GameScene.cpp:2383), [GameScene.cpp:2447](/home/guzpido/T2gu/src/game/GameScene.cpp:2447).

`onLevelStart()` clears `vigil_active` and `vigil_alive`, explicitly assuming a reload leaves no enemies behind. Scene snapshots save and restore living enemies, including the active wave. Saving during a wave and loading produces enemies from that wave with counters saying no wave is active. Talking to the Light can spawn another copy; kills are then counted by roster name against the new counter, potentially completing the wave while enemies remain.

The script harness began the first six-enemy wave, then re-ran initialization and observed `active=false`, `alive=0`, `wave=0`.

**Repair:** make quickload preserve active-wave state consistently, or deliberately discard the restored wave and restart it. Distinguish loading a snapshot from ordinary level initialization. Stable wave/entity identifiers would make completion counting less fragile.

### M04 — A permanent maximum-HP boost can make a dead character have positive HP

**Status: reproduced.** Sources: [Character.cpp:281](/home/guzpido/T2gu/src/game/Character.cpp:281), [Character.cpp:289](/home/guzpido/T2gu/src/game/Character.cpp:289), [GameScene.cpp:2552](/home/guzpido/T2gu/src/game/GameScene.cpp:2552).

The maximum-HP item path calls `setMaxHp()` on every party member. That setter refills HP but does not reset `m_dead`. A dead member can become `hp=110, maxHp=110, dead=true`. Snapshot restoration later derives death from HP through `setCurrentHp()`, so the same saved state can become alive after loading.

The UI normally prevents item use after the controlled character dies; a dead follower in an otherwise living party is the relevant gameplay case. The fixture invoked the same item path directly to isolate the invariant.

**Repair:** separate maximum-HP changes, healing, and revival. Keep dead members at zero HP unless an explicit revival is intended, and keep death flags, animation state, and saved HP consistent.

### M05 — Saving omits temporary buffs even though their consumed items are saved

**Status: reproduced.** Sources: [Character.h:239](/home/guzpido/T2gu/src/game/Character.h:239), [GameScene.cpp:2374](/home/guzpido/T2gu/src/game/GameScene.cpp:2374), [GameScene.cpp:2522](/home/guzpido/T2gu/src/game/GameScene.cpp:2522).

Temporary strength, intelligence, and speed bonuses and their remaining durations live only on `Character`. Snapshots contain positions and HP, while inventory records that the potion was consumed. Restoring into a new scene loses an effect that was still active at save time. The fixture measured speed **14 before saving, 10 after restoring**.

Scene replacement also drops these effects on a chapter transition. Whether transitions should cancel buffs is a design decision; quickload silently changing a supposedly restored gameplay state is the concrete discrepancy.

**Repair:** serialize active bonus channels and remaining simulation durations, or explicitly define and communicate cancellation semantics. Cover both quickload and chapter transitions.

### M06 — `api.setTileset()` leaves old cached tiles and water-rendering metadata

**Status: reproduced; latent API defect, not exercised by current chapter population.** Sources: [TileMapItem.cpp:124](/home/guzpido/T2gu/src/rendering/TileMapItem.cpp:124), [TileMapItem.cpp:178](/home/guzpido/T2gu/src/rendering/TileMapItem.cpp:178), [GameScene.cpp:2684](/home/guzpido/T2gu/src/game/GameScene.cpp:2684).

Terrain variants are cached by numeric tile index, and the renderer captures the water index once in its constructor. `scriptSetTileset()` reloads the underlying sheet and requests repainting, but neither invalidates the cache nor refreshes the renderer's water index.

The fixture painted a red tileset, loaded a blue one, and painted again:

```text
TILESET_SWAP before=#ff0000 after=#ff0000 direct=#0000ff
```

Collision follows the map's refreshed water classification, while rendering can still use the old one.

**Repair:** make successful tileset changes notify the renderer to clear variants and rebuild tileset-dependent metadata. Make failed reloads transactional so old metadata and artwork remain mutually consistent.

### M07 — The time-step clamp does not guarantee collision safety at supported speeds

**Status: endpoint tunneling reproduced.** Sources: [GameScene.cpp:46](/home/guzpido/T2gu/src/game/GameScene.cpp:46), [GameScene.cpp:302](/home/guzpido/T2gu/src/game/GameScene.cpp:302), [Character.cpp:435](/home/guzpido/T2gu/src/game/Character.cpp:435), [MainWindow.cpp:923](/home/guzpido/T2gu/src/app/MainWindow.cpp:923).

Movement checks only the final feet point for each axis. Clamping `dt` to 0.05 seconds bounds displacement, but does not ensure it is smaller than every prop footprint. Running, speed buffs, level bonuses, and the follower catch-up multiplier of up to 3 increase supported displacement substantially. Lara's current base speed stat is 12, so reasoning from an old flat movement speed is insufficient.

With a supported 1,024 px/s velocity and `dt=0.05`, the fixture moved from x=200 to x=251.2 across an obstacle covering x=210–238.8. Neither endpoint was blocked, so the obstacle was missed completely.

**Repair:** subdivide movement according to displacement and the collision geometry, or use a swept segment test. Retain the time-step clamp for simulation stability, but do not treat it as a proof that tunneling is impossible. Preserve the existing feet-point collision convention.

### M08 — Malformed map metadata can be accepted and later crash; load failure is not contained

**Status: division-by-zero reproduced; other failure consequences established by source.** Sources: [TileMap.cpp:40](/home/guzpido/T2gu/src/game/TileMap.cpp:40), [TileMap.cpp:101](/home/guzpido/T2gu/src/game/TileMap.cpp:101), [GameScene.cpp:577](/home/guzpido/T2gu/src/game/GameScene.cpp:577), [MainWindow.cpp:260](/home/guzpido/T2gu/src/app/MainWindow.cpp:260).

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

**Status: established by source.** Sources: [GameScene.cpp:2049](/home/guzpido/T2gu/src/game/GameScene.cpp:2049), [GameScene.cpp:2063](/home/guzpido/T2gu/src/game/GameScene.cpp:2063), [GameScene.cpp:2079](/home/guzpido/T2gu/src/game/GameScene.cpp:2079), [FireballItem.cpp:43](/home/guzpido/T2gu/src/rendering/FireballItem.cpp:43).

The visual bolt snapshots an impact location, with a comment describing the target dodging by moving away. Pending damage stores a target pointer and applies damage when its timer expires, without checking the target's distance from the impact point. A living target still takes the hit after moving away.

Projectile visuals use elapsed wall-clock time; damage uses the scene's clamped simulation time. After stalls, the visual can already have impacted or disappeared while the damage countdown still has time left.

**Repair:** choose an explicit combat model. For dodgeable projectiles, store the impact location and validate overlap at impact; for guaranteed targeted spells, make the visual and description communicate that model. Drive both visuals and damage from a consistent clock.

Terrain is also ignored in melee hit testing and projectile damage. A focused fixture placed both characters outside a 128 px barrier, only 130 px apart, and melee reduced enemy HP from 100 to 85 across it. This can permit damage across corridor walls or gates. Whether walls should block attacks is a design decision; adding line-of-sight must preserve the deliberate circular, facing-independent melee reach rule.

### M10 — Path recovery can classify slow progress as stuck, and failed searches bypass cooldown

**Status: established by source; frequency in a live campaign was not measured.** Sources: [GameScene.cpp:388](/home/guzpido/T2gu/src/game/GameScene.cpp:388), [GameScene.cpp:1711](/home/guzpido/T2gu/src/game/GameScene.cpp:1711), [GameScene.cpp:1741](/home/guzpido/T2gu/src/game/GameScene.cpp:1741).

`moveAlongPath()` expects the distance to the waypoint to shrink by at least 8 px **per call**, otherwise it accumulates a stuck timer. At roughly 60 ticks/s, perfectly normal 320 px/s movement advances about 5.3 px per call and fails that threshold. Waypoint changes can further distort the comparison. A falsely stuck character can blacklist a genuinely reachable cell.

Separately, `waypoints.isEmpty()` causes a new A* search irrespective of `repathCooldown`. An unreachable target can therefore provoke a search every tick per character, each allowed up to 12,000 expansions. The node cap bounds one search, not aggregate work per frame.

**Repair:** assess accumulated movement over a time window, as the trail-following path already does; reset comparisons when changing waypoints. Keep a cooldown/backoff for failed searches and a shared per-tick search budget if measurements justify it. Retain A* for combat and rejoining; this finding is not a recommendation to remove it.

### M11 — Delayed dialogue and inventory can both be active, with inventory taking Enter

**Status: reproduced using synthetic Qt events.** Sources: [MainWindow.cpp:362](/home/guzpido/T2gu/src/app/MainWindow.cpp:362), [MainWindow.cpp:760](/home/guzpido/T2gu/src/app/MainWindow.cpp:760), [MainWindow.cpp:797](/home/guzpido/T2gu/src/app/MainWindow.cpp:797).

Inventory opening checks whether dialogue is visible now, not whether a waiting script will show it later. `showDialogue()` does not close inventory. Thus opening inventory during an intro wait or post-kill wait can leave both visible; inventory input has priority and consumes Enter instead of advancing the dialogue.

```text
MODAL_BEFORE inventory=1 dialogue=1
MODAL_AFTER_ENTER inventory=1 dialogue=1
MODAL_RECOVERED dialogue=0
```

The player can recover by closing inventory with Escape and then pressing Enter, so this is not an unrecoverable softlock. It contradicts the input logic's stated aim of avoiding two competing modal interfaces.

**Repair:** resolve modal ownership when dialogue arrives, not only when inventory opens or an item returns immediately. Closing inventory in `showDialogue()` is a small, direct option; a shared modal state would avoid future priority drift.

### M12 — Movement keys are not cleared when the application loses focus

**Status: source-established missing handling; physical focus-loss delivery was not tested.** Sources: [MainWindow.cpp:907](/home/guzpido/T2gu/src/app/MainWindow.cpp:907), [MainWindow.cpp:914](/home/guzpido/T2gu/src/app/MainWindow.cpp:914), [MainWindow.h:25](/home/guzpido/T2gu/src/app/MainWindow.h:25).

Held keys are inserted on press and removed on release. There is no focus/window-deactivation handler clearing them. If a movement or Shift key is released while another application has focus, this window may never receive its release and can continue moving or running after the user returns. The per-tick refresh preserves the stale intent.

**Repair:** clear held movement keys and stop the controlled character on window/application deactivation. Verify with a real display; the offscreen tests here do not prove actual desktop input delivery.

### M13 — Ambient music scheduling can override explicit script music or silence

**Status: established by source; the two-minute audio path was not runtime-tested.** Sources: [GameScene.cpp:548](/home/guzpido/T2gu/src/game/GameScene.cpp:548), [GameScene.cpp:551](/home/guzpido/T2gu/src/game/GameScene.cpp:551), [GameScene.cpp:2806](/home/guzpido/T2gu/src/game/GameScene.cpp:2806), [AudioManager.cpp:90](/home/guzpido/T2gu/src/audio/AudioManager.cpp:90).

Every scene schedules a fade after two minutes and connects the first `musicFinished` event to random level music. `api.playMusic()` and `api.stopMusic()` do not cancel that ambient-intro policy. A script's replacement track can be faded by the old timer; a requested silent scene can later resume random music. `stopMusic()` also leaves an active fade alive, whose completion emits `musicFinished`.

The constructor comment assumes the natural-end and fade routes cannot both occur, but the one-shot timer is not canceled if the ambient source ends early and the fallback starts a new track.

**Repair:** model ownership of the current music request and cancel obsolete intro timers/fades/connections when scripts take control or request silence. Keep audio loading failures distinct from intentional completion.

## Low-priority findings

### L01 — Slightly negative world coordinates map into tile zero

**Status: reproduced.** Source: [TileMap.cpp:100](/home/guzpido/T2gu/src/game/TileMap.cpp:100).

Integer conversion/division truncates toward zero, so `isWalkable(-1,64)` returns true on a walkable tile-zero fixture. Values just west/north of the map can be treated as in bounds rather than outside the world. Border barriers mask this in many maps.

**Repair:** reject negative/out-of-world coordinates before tile conversion, or use floor division with explicit bounds checks.

### L02 — Rendering bounds and overlay-order comments do not consistently match painting

**Status: source-established geometry/order issues; full visual impact not exhaustively rendered.** Sources: [FireballItem.cpp:54](/home/guzpido/T2gu/src/rendering/FireballItem.cpp:54), [FireballItem.cpp:96](/home/guzpido/T2gu/src/rendering/FireballItem.cpp:96), [Prop.cpp:168](/home/guzpido/T2gu/src/game/Prop.cpp:168), [GameScene.cpp:472](/home/guzpido/T2gu/src/game/GameScene.cpp:472), [GameScene.cpp:2586](/home/guzpido/T2gu/src/game/GameScene.cpp:2586), [LevelUpTextItem.cpp:36](/home/guzpido/T2gu/src/rendering/LevelUpTextItem.cpp:36).

The fireball bounds extend by `2 * glowRadius`, but the expanding impact reaches almost `2.8 * glowRadius` before disappearing. Qt can clip/cull that outer paint. Prop bounds cover the full source-art rectangle, while a measured ground anchor plus shadow offset/radius can place part of the shadow outside it; the asset scan suggests this is common, but it used Pillow scaling rather than an exact Qt render.

Item pickups have `1,000,000 + groundY` z-order while the lighting overlay sits at 1,000,000, so the comment that lighting paints over every prop is false for pickups. A level-up item's large **child-local** z-value does not lift it above unrelated top-level siblings, despite its “always drawn on top” comment.

**Repair:** cover all painted geometry while preserving the full-cell/full-art anchoring contracts. Define explicit top-level layer ordering and decide whether pickups and level-up effects should share world lighting. Verify with edge-of-viewport renders.

### L03 — Selection information is a snapshot rather than a live display

**Status: established by source.** Source: [GameScene.cpp:2872](/home/guzpido/T2gu/src/game/GameScene.cpp:2872).

`selectionChanged` is emitted when selecting, with copied HP/stats. Subsequent damage, healing, or progression does not refresh the selected information widget. A selected target can display stale health until selection changes.

**Repair:** refresh only when relevant selected-entity state changes, or poll just that entity at a modest UI interval. Clear or update the panel when death changes its meaning.

### L04 — Refreshing inventory jumps selection to the first item

**Status: established by source.** Sources: [InventoryWidget.cpp:58](/home/guzpido/T2gu/src/ui/InventoryWidget.cpp:58), [MainWindow.cpp:784](/home/guzpido/T2gu/src/app/MainWindow.cpp:784).

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

Sources: [GameScene.cpp:57](/home/guzpido/T2gu/src/game/GameScene.cpp:57), [GameScene.cpp:855](/home/guzpido/T2gu/src/game/GameScene.cpp:855), [SpriteSheet.h:49](/home/guzpido/T2gu/src/assets/SpriteSheet.h:49).

The process-lifetime sprite cache retains trimmed frames for every unique roster name loaded, and mirrored frames are cached lazily. Destroying a scene releases its entities but does not release those cached sprite assets. A long campaign can therefore retain substantially more than one chapter's working set. This is intentional caching, not proof of a leak.

The 815–1,283 MiB observed here came from separate instrumented cold-start processes. It does **not** establish the memory footprint after traversing all 25 chapters in one process or exercising all animations. Measure that scenario before setting minimum RAM expectations.

The repository explicitly records that offline per-frame/lazy-decoding changes were considered and declined. This report does not reopen that asset-pipeline decision. If memory pressure later justifies a change, first add cache accounting and measure whether bounded caching would help the actual campaign.

### A02 — Chapter 15 is a sequence of hunts, despite its defense description

**Addressed in batch eight:** dialogue and quest comments describe the
implemented hunt-and-return flow. The findings below preserve review history.

Sources: [chapter15.js:594](/home/guzpido/T2gu/assets/scripts/chapter15.js:594), [chapter15.js:639](/home/guzpido/T2gu/assets/scripts/chapter15.js:639), [chapter15.js:647](/home/guzpido/T2gu/assets/scripts/chapter15.js:647), [GameScene.cpp:1902](/home/guzpido/T2gu/src/game/GameScene.cpp:1902).

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
| Current save version is 1 and missing-version saves are accepted | Current and minimum supported versions are both 2; missing version defaults to 1 and is rejected | Update [AGENTS.md:588](/home/guzpido/T2gu/AGENTS.md:588) and the stale comment at [MainWindow.cpp:637](/home/guzpido/T2gu/src/app/MainWindow.cpp:637) |
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

Sources: [CMakeLists.txt:21](/home/guzpido/T2gu/CMakeLists.txt:21), [CMakeLists.txt:85](/home/guzpido/T2gu/CMakeLists.txt:85), [CMakeLists.txt:110](/home/guzpido/T2gu/CMakeLists.txt:110), [AssetPath.cpp:14](/home/guzpido/T2gu/src/assets/AssetPath.cpp:14).

`find_package(Qt6)` declares no minimum version although code uses newer API such as `QImage::flipped`. Declare and test the actual supported baseline instead of leaving older Qt installations to fail during compilation.

Release `-march=native` is already documented as a deliberate local-build optimization. Keep it for that purpose; provide a clearly selectable portable build mode before distributing binaries to different CPUs.

Installation uses customizable `CMAKE_INSTALL_BINDIR` and `CMAKE_INSTALL_DATADIR`, but runtime asset discovery assumes `../share/t2gu2/assets`. The default `bin`/`share` layout is coherent; custom GNUInstallDirs layouts are not necessarily relocatable with that hardcoded lookup. Derive the relative runtime path from the configured layout or explicitly constrain supported layouts.

The generated desktop file intentionally uses the configure-time install prefix. Installation under a later `--prefix` does not rewrite its launcher path; this is already documented and should remain visible to packagers.

### A05 — Roster names are doing the work of entity identity

Source: [GameScene.h](/home/guzpido/T2gu/src/game/GameScene.h), [ScriptBridge.h](/home/guzpido/T2gu/src/scripting/ScriptBridge.h).

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
