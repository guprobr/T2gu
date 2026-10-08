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

- Requires Qt 6.9 or newer (Widgets, Qml, Multimedia). For binaries intended
  for other CPUs, configure with `-DT2GU_NATIVE_CPU=OFF`; local Release builds
  retain `-march=native` by default, and portable builds retain supported LTO.
- `GameView` defaults to OpenGL rendering. `T2GU_RENDERER=software` forces
  software; unset/empty values use the default. The optional
  `QOpenGLWidget` viewport uses `FullViewportUpdate`, no MSAA,
  and a requested swap interval of 1. Qt OpenGLWidgets is discovered
  optionally; `-DT2GU_OPENGL_RENDERER=OFF` omits that dependency. Missing
  contexts/modules, offscreen/minimal platforms and failed initialization
  fall back to software. Backend and GL driver/device are logged. Compare
  frame intervals on a real GPU/display; offscreen tests only verify the
  software/fallback paths. The October 5 Intel Iris Xe trials reduced CPU
  use; the owner requested OpenGL as the default with software fallback.
  Focus/minimize rendering workarounds were removed at the owner's request:
  no forced minimization, no activation filters or update suspension. Kernel
  logs confirm i915 render-engine GPU hangs in T2gu2 followed by failed resets
  and KWin fence timeouts on Intel Tiger Lake / Mesa 26.0.8 / kernel 7.0.0-38.
  This explains desktop-wide locks; the precise GPU command/driver defect
  remains unidentified. See the October 5 GPU investigation in the review
  report. Do not present the older focus checks as proof that this is fixed.
  The owner's October 5 `INTEL_DEBUG=stall` run retained Intel OpenGL,
  exited normally after roughly seven minutes with no recorded GPU hangs,
  and had only a modest perceived slowdown. This strengthens a GPU
  synchronization/timing lead, not a confirmed root cause. The subsequent
  `INTEL_DEBUG=sync` comparison hung the GPU at 10:13:45 and required a reboot;
  previous-boot journals confirm the same hang signature and failed resets.
  Its launcher is now disabled. Upstream Mesa 26.0.8 Iris source shows that
  `stall` enables cache flush/invalidation around draws, whereas `sync` waits
  after batch submission. Investigate dependencies/cache handling within a
  batch; waiting at batch/frame boundaries is not an established fix.
  The owner subsequently requested applying the successful `stall` behavior.
  `GameView::configureRendererEnvironment()`, called before QApplication,
  now requests `always_flush_cache=true` on Linux when Intel PCI adapter
  8086:9a49 is present and OpenGL is selected/built. Explicit values are
  preserved; software selection skips the automatic option. Upstream Iris
  maps this to the identical cache path used by DEBUG_STALL, including blits.
  The owner subsequently reported that it apparently did not hang. A
  read-only kernel journal check since the 10:47:40 rebuild found no matching
  GPU hang/reset/fence-timeout messages. Run duration and backend output were
  not independently captured; sustained verification is pending. The agent
  has not launched the binary. INTEL_DEBUG itself remains untouched. No
  end-of-frame glFinish or focus/minimize guard was added. Saved evidence and manual launchers are under the ignored
  `output/gpu-hang-2026-10-05/` directory.
  Validate GL resources after an actual paint attempt, since minimized startup
  can defer initialization. The owner
  requested manual verification: rebuild without running
  tests or launching the game unless subsequently authorized.
- October 5 paint-cost follow-up: the owner reported no hangs with the
  integrated cache option but continued gameplay stutter. Water now bakes
  wrapped stripes into per-row/orientation pixmaps at its 120 ms cadence,
  with a 16 MiB nominal pixel cache cleared on phase/tileset changes.
  FullViewportUpdate terrain uses actual art-overlap padding (256 px art
  on a 128 px grid); partial software updates retain their old margin.
  Character shadows are cached per radius, and unchanged animation frames
  no longer call Qt's unconditional setPixmap geometry invalidation. Lighting
  advances at 240 ms rather than every movement repaint; the debug coordinate
  HUD refreshes at most every 100 ms. T2GU_PROFILE_RENDER=1 enables three-second
  CPU scene-paint/interval summaries and per-category costs/callback counts.
  Those exclude later Qt composition/presentation and GPU timing; profiling
  adds overhead. After the paint changes were rebuilt, the owner confirmed
  empirically that both hangs and stuttering were gone in manual play.
  Keep this accelerated configuration, including the Iris cache-flushing
  option. This is owner verification on the observed setup, not a measured
  frame-time result or identification of the underlying driver defect.
- October 5 OBS follow-up: the owner reported game-side latency/stutter
  during recording. `T2GU_MAX_FPS=30` now opts into scheduled whole-viewport
  scene repaints, using `NoViewportUpdate` plus a precise `QChronoTimer`;
  camera and item changes accumulate until the next frame. Unchanged
  scenes skip repaint requests; scene replacements rebind the dirty observer.
  The simulation timer, input handling and 50 ms delta cap remain independent. Unset/empty
  or `0` retains scene-driven rendering; valid limits are 1–240. Both GL
  and software fallback support the cap, and terrain retains its reduced
  whole-frame art-overlap margin in this mode. Exposure/resize and widget
  composition may cause extra frames; this is a scene repaint cap, not a
  guarantee of all-window presentation rate or input latency. Renderer
  regressions were added/compiled but not run; the agent did not launch
  the game. OBS-loaded performance remains unmeasured.
- October 7 solo-maze follow-up: the owner reported continued stuttering in
  complex mazes even without companions. The controlled hero never uses A*,
  and hostile AI chases directly; follower pathfinding does not explain the
  solo case. `updatePartyAI()` now skips trail maintenance with at most one
  party member, invalidating the trail for future recruitment. The 16 ms
  simulation timer now requests `Qt::PreciseTimer`; late delivery is still
  possible under load. `T2GU_PROFILE_RUNTIME=1` adds three-second wall-time
  summaries for ticks, actual intervals and outside-tick gaps, per-stage
  timings, nested movement collision/audio/script/asset costs, entity counts,
  and 50 ms delta clamps/discarded time. The normal executable also records
  slow outer GUI Qt event deliveries, including queued callbacks and input.
  Linux adds GUI-tick CPU time, process faults/context switches and RSS/swap.
  Nested timings overlap; outside-tick time includes normal timer waiting.
  Loading/resume resets the diagnostic baseline. Profiling is opt-in and
  adds overhead. All enemies/NPCs still tick and may whistle remotely; new
  scripted spawns can decode sprites synchronously, and process-lifetime
  asset caches retain memory across chapters. These are investigated leads,
  not confirmed causes. The Release binary was rebuilt; no tests or game
  launches were run. A manual trace is pending. Renderer/cache configuration
  is retained. See README and the October 7 review-report follow-up.
  The owner's subsequent `/tmp/t2gu-runtime.log` run visibly reproduced the
  stutter. Saved evidence: ignored `output/runtime-2026-10-07/` (raw log and
  parsed summary). Across 13 reports, simulation ticks peaked at 6.511 ms
  while actual intervals peaked at 184.203 ms; later medians were about
  80–83 ms. Collision max was 0.080 ms, audio setup max 0.612 ms, with no
  major faults or swap and RSS 684.5–756.0 MiB. Delayed delivery triggered
  271 delta clamps, discarding 8.462 seconds of simulation time. Long outer
  events predominantly targeted GameScene MetaCall, which is not proof of
  expensive scripts: Qt's queued dirty-item updates synchronously deliver
  window UpdateRequest events. Added opt-in nested scene-dispatch,
  window-update and viewport-paint timings, including Linux GUI-thread CPU
  costs, to separate scene maintenance/drawing from composition/presentation
  waits. Rebuilt without agent launches or tests. The next detailed capture
  is pending; renderer behavior and the underlying cause remain unchanged.
  The next `/tmp/t2gu-runtime-detail.log` capture contains 29 runtime reports
  and 30 paint reports. It locates the sustained stall inside window updates,
  including drawing and additional non-paint work/waits. In report 8, scene
  dispatch averaged 78.949 ms, window update 77.717 ms and viewport paint
  30.542 ms (all 38 calls); tick median was 0.870 ms. Window CPU averaged
  41.110 ms, paint CPU 30.014 ms. Thus scene maintenance outside the window
  update cost ~1.232 ms, with ~47.175 ms elsewhere inside the update (~11.096
  ms CPU plus ~36.079 ms without GUI-thread CPU execution). In smooth report
  23, matched window/paint counts gave 14.472/3.336 ms mean wall duration.
  Collision max 0.303 ms, audio setup max 0.686 ms, script execution max
  0.087 ms; no major faults or swap, RSS 685.4–779.5 MiB. Across this capture,
  606 clamps discarded 16.537 seconds of simulation. Saved raw detail log and
  parsed `detail-summary.json` alongside the first evidence. These measurements
  identify a drawing/window-update bottleneck; they do not identify a specific
  driver defect, texture-cache issue or presentation mechanism. Non-rendering
  simulation is not the sustained bottleneck in these recordings. No further
  code changes, tests or agent game launches were made after reading the trace.
  The owner then directed the investigation toward drawing and window
  composition/presentation on Wayland, Intel and KDE. `T2GU_PROFILE_PRESENT=1`
  now enables public QOpenGLWidget boundary measurements: scene paint,
  paint completion to aboutToCompose, composition to frameSwapped, and Qt
  swap-return intervals, with wall/GUI CPU distributions and display size,
  DPR/refresh metadata. Desktop GL timer queries measure scene GPU elapsed
  time asynchronously (eight-query pool, fetch only available results);
  unsupported contexts retain wall/CPU probes. Qt flushShared precedes
  aboutToCompose, so the preceding gap includes that synchronization plus
  raster/event work. Qt Wayland EGL can wait for a frame callback before
  eglSwapBuffers; the composition interval does not isolate the exact call.
  frameSwapped is Qt submission completion, not KWin presentation/scanout.
  Runtime profiling also times non-GL widget paint delivery (parent/HUD),
  excluding backing-store texture uploads. Existing paint labels now correctly
  say wall time. These diagnostics are opt-in, preserve the Intel cache option
  and introduce no explicit GL flush/finish or unfinished-query waits. Release
  rebuilt successfully; no game launches or tests. Manual capture pending.
  The owner's first `/tmp/t2gu-present.log` capture felt smooth; Chrome and
  Tidal had been closed. Saved as ignored
  `output/runtime-2026-10-07/solo-maze-present-chrome-tidal-closed.log`, with
  `present-summary.json`. Wayland/KDE/Intel GL and cache-flush=true are logged;
  viewport 1920x1128, DPR 1, DP-2 nominal 59.95 Hz. Across 41 runtime reports,
  7,426 ticks, interval medians were 16.169–16.737 ms; five clamps discarded
  98 ms (previous detailed run: 606 clamps / 16.537 s). Scene paint medians
  were 1.682–4.567 ms, GPU elapsed medians 4.160–8.666 ms; pre-compose max
  1.194 ms and raster-widget-paint max 0.542 ms. No sustained 80 ms stalls.
  Isolated gaps remain; idle/scene-driven update intervals are not proof of
  blocked rendering. First 26 reports have the prior scene's 4551 props/11
  NPCs, with changing enemy counts; later populations differ. The two apps'
  closure and new GPU-query instrumentation prevent a controlled attribution.
  External CPU/GPU/compositor contention is a lead, not an identified cause.
  No renderer changes, tests or agent launches were made after this reading.
  A subsequent `/tmp/t2gu-present.log` run with Chrome open and Tidal playing
  music also stayed smooth (owner confirmed). Saved as
  `solo-maze-present-chrome-tidal-playing.log`, with
  `present-chrome-tidal-playing-summary.json` alongside the closed-app run.
  Across 28 runtime reports / 5083 ticks, interval medians were 16.142–16.691 ms,
  max 48.584 ms, zero delta clamps, tick max 1.156 ms. All reports have 4551
  props / 11 NPCs. Scene paint medians 1.799–3.504 ms; GPU medians 4.718–9.594
  ms. No major faults or swap. App closure is not established as the reason
  for smoothness. Both smooth runs enabled new GPU query instrumentation;
  to check its timing effects, `T2GU_PROFILE_PRESENT_GPU=0` now disables query
  creation/markers/polling and their early makeCurrent while retaining all
  wall/CPU boundary probes. Unset retains query behavior when PRESENT=1.
  This is a diagnostic comparison, not a synchronization fix or a claim that
  probes explain the original stutter. Release rebuilt; no tests or launches.
  The following GPU-disabled run reproduced visible stutter (owner confirmed).
  Saved `solo-maze-present-no-gpu.log` / `present-no-gpu-summary.json` contain
  15 reports, 2117 ticks, 137 clamps / 5.446 s discarded. Slow reports 11–14
  have tick medians 67.090–95.507 ms, paint medians 17.382–30.074 ms and
  composition/swap medians 30.473–64.497 ms; GUI CPU paint rises too. Global
  tick gap max 221.571 ms. GPU queries=false and cache-flush=true are logged,
  with no major faults/swap. Reports recover to smooth timing at the end.
  This strengthens a probe-sensitive rendering/submission lead; GPU commands
  and early makeCurrent were removed together, so neither is isolated yet.
  Qt already binds the viewport in ensureActiveTarget before engine setup.
  Mesa 26.0.8 iris_query source emits timestamp PIPE_CONTROL commands and
  availability ordering; nonblocking result lookup can flush a current batch.
  Those source paths are not proof they caused this session's slowdown.
  `T2GU_PROFILE_PRESENT_PREBIND=1`, with PRESENT=1 / PRESENT_GPU=0, now enables
  only early context binding, logging early-context-binds; off by default and
  ineffective without PRESENT profiling. No explicit flush/finish/query added
  by this option. Release rebuilt without tests/launches; manual comparison
  pending. The renderer and Intel cache mitigation remain unchanged by default.
  The prebind-only run also visibly stuttered (owner confirmed). Saved
  `solo-maze-present-prebind.log` / `present-prebind-summary.json`: 21 reports,
  3061 ticks, 182 clamps / 6.498 s discarded; slow interval medians 75.575–
  107.266 ms and paint medians up to 42.179 ms. GPU queries=false / prebind=true
  are logged; 1901 early context binds for 1901 scene paints. No swap/major
  faults. Early binding alone is not the observed cure. The remaining
  query-command/polling distinction has an opt-in comparison:
  `T2GU_PROFILE_PRESENT_POLL=0`, with PRESENT=1 / PRESENT_GPU=1, emits begin/end
  markers through the same fixed eight-query pool, resetting/reusing ended
  queries and discarding results without availability checks/result reads.
  `GPU-query-begins` confirms marker issuance; GPU time reports n/a. No forced
  GPU completion or explicit flush added. Mesa 26.0.8 queryobj.c and
  u_threaded_context.c show availability checks use wait=false but can sync
  queued driver work; this is a conditional source lead, not measured call
  attribution. Source copies are in ignored runtime evidence/mesa-query-source.
  Release rebuilt; no tests/launches. The owner confirmed marker-only stutter.
  Saved `solo-maze-present-markers.log` / `present-markers-summary.json`:
  10 reports, 1209 ticks, 166 clamps / 4.418 s discarded; slow interval medians
  63.932–83.439 ms, paint medians up to 35.566 ms and compose-to-swap medians
  up to 44.263 ms. 994 query begins / early context binds for 994 scene paints;
  polling=false, GPU timings n/a, no swap/major faults. Only full query probes
  with result polling have stayed smooth in these comparisons; exact route/OS
  state remain uncontrolled. Upstream Iris exposes the process environment
  option `intel_disable_threaded_context=true`, bypassing Gallium driver-worker
  creation when it would otherwise be requested. This differs from mesa_glthread.
  Next manual comparison uses this option with PRESENT=1 / PRESENT_GPU=0 /
  PRESENT_PREBIND=0. Startup logs the requested override, not proof of actual
  worker creation/absence. Do not apply it automatically based on this source
  lead; manual verification is pending. Preserve always_flush_cache=true.
  The owner confirmed this driver-worker-disabled comparison also stuttered.
  Saved `solo-maze-present-no-thread.log` / `present-no-thread-summary.json`:
  12 reports, 1610 ticks, 142 clamps / 2.794 s discarded; slow interval medians
  44.423–73.051 ms, scene-paint medians up to 42.605 ms and compose-to-swap
  medians up to 24.673 ms. Mesa printed the option-override notice; startup
  records thread override=true, GPU queries=false, prebind=false and cache=true.
  RSS 685.2–717.7 MiB, no swap, one major fault in the first reporting window
  and none during the sustained slowdown. Disabling this worker alone did not
  prevent the observed stutter; no automatic override is applied. Next manual
  capture uses installed perf 7.0.14, process/worker user-space cycles at 99 Hz
  with 8192-byte DWARF call stacks, GPU queries/prebind off and default driver
  threading. Outputs `/tmp/t2gu-maze-perf.data` / `t2gu-maze-perf.log`. Sampling
  can perturb timing and does not attribute off-CPU waits or actual compositor
  presentation. Capture pending; no tests, perf recordings or game launches
  performed by the agent.
  The owner completed the CPU capture and confirmed stutter. Saved
  `solo-maze-perf.data` / `solo-maze-perf.log`, `perf-summary.json`, decoded
  `perf-stacks.txt` / `perf-samples.json`, and cycle-rate analysis under ignored
  runtime evidence. 2058 samples, zero lost samples; 8 runtime/presentation
  reports, 910 ticks, 117 clamps / 2.271 s discarded; interval median max
  71.525 ms, simulation execution max 2.341 ms, paint median max 36.830 ms.
  RSS 684.7–699.9 MiB, no swap/major faults. Startup decoding dominates whole-run
  CPU percentages; exclude it. Later 8-second selection has GUI leaf samples
  across Qt Widgets (21.94%), Mesa (20.74%), Qt Gui (20.54%), libc (14.17%), plus
  Iris gdrv0 (9.11% Mesa). Baseline Iris worker presence is now measured;
  no GL API worker appears in recorded thread names. Inferred GUI cycle rate
  from 4–18 ms consecutive sample gaps falls to ~0.34–0.36 GHz for seven seconds
  before recovering. This is a throttling lead, not direct clock measurement;
  gaps include scheduling/PMU sampling effects. Post-run CPU policy is performance,
  turbo allowed, 400–4800 MHz limits, platform balanced, AC online. Package
  temperature was 86 C and throttle counters are cumulative; they were not
  recorded during that run. Do not claim thermal/power attribution from this.
  Added `tools/profile_hardware.py` for the next manual run: read-only 250 ms
  sysfs CPU/GPU frequency, thermal/power sensors and throttle counters, plus
  process/worker perf stat cycles:u/ref-cycles:u/task-clock. Timestamped game
  log delivery and sensor snapshots permit correlation; default output directory
  `/tmp/t2gu-maze-hardware`, refusing existing capture files. No driver/governor/
  thermal defaults change. Python syntax and git diff checked; helper not run,
  no tests or game launches. Manual hardware capture pending.
  The owner completed hardware capture and confirmed stutter. Raw metadata,
  hardware/game-event JSONL, perf stat CSV, log and summary are saved under
  ignored `output/runtime-2026-10-07/hardware-capture/`. Duration 59.670 s,
  14 runtime/presentation reports, 2023 ticks, 102 clamps / 3.874 s discarded;
  simulation execution max 5.870 ms, RSS 692.6–735.1 MiB, no swap/major faults.
  All eight logical CPUs directly measure ~400 MHz at capture seconds 30–33
  and 50–55; worst interval/scene-paint medians 82.005/41.984 ms, with Intel GPU
  frequency 100 MHz. Recovery interval/paint medians 16.440/3.638 ms. Perf cycle/
  reference-cycle ratios independently fall to ~0.221 during these plateaus.
  Package temperature is 77–79 C then, all core/package thermal-throttle count
  deltas are zero, AC stays online. Clock reduction is confirmed; hardware
  thermal counters alone do not rule out power/firmware/thermal policy.
  Host read-only service inspection shows thermald --adaptive and power-profiles-
  daemon active. Post-run RAPL MSR long limit 200 W vs enabled MMIO long/short
  limits 15/18.75 W; these were not captured during gameplay. No service or
  firmware attribution established. Extended helper with bounded RAPL limit/
  enable reads, cooling states, governor/frequency limits, intel_pstate controls,
  platform profile and adapter ratings, plus scan start/end timestamps. Scans
  pause 250 ms after reads; actual intervals include reading time. Next manual
  run uses fresh --output-dir /tmp/t2gu-maze-power. Syntax/diff checks passed;
  no tests or game launches, no system/renderer changes. Manual power-policy
  capture pending.
  The owner completed power-policy capture and confirmed stutter; KDE's CPU/
  power configuration is Balanced. Raw data/summary are saved under ignored
  `output/runtime-2026-10-07/power-capture/`. Duration 54.421 s; 10 runtime/
  presentation reports, 1384 ticks, 91 clamps / 3.140 s discarded, simulation
  max 5.905 ms, RSS 692.9–724.6 MiB, no swap. One major fault in first reporting
  window. Enabled MMIO package PL1 changes 15→13.75→11.875→9.875→5.875→5 W
  over capture seconds ~28.6–41.1. CPU clocks fall afterward to 400 MHz; slow
  interval/paint medians 82.978/36.211 ms. PL1 rises to 15 W at ~43.35 s with
  brief lower-limit interruptions, then clocks and timing recover. Platform
  profile stays balanced, all governors performance, CPU ceilings/minima and
  pstate controls unchanged; MSR PL1/PL2 stay 200/60 W, MMIO PL2 18.75 W. AC
  remains online; cooling states unchanged. Thermal counters +5 at ~2.16 s
  during startup, unchanged across gameplay slowdown. Strong package-power
  restriction lead; sysfs reads do not identify its writer. Upstream thermald
  v2.5.11 RAPL source writes long-term constraints, but live attribution remains
  unproven (installed 2.5.11-0ubuntu1.1; PPD 0.30-2). Post-run firmware limits
  expose 3–15 W PL0 range and 0.1 W step; profile driver dell-pc. Next manual
  comparison asks owner to select KDE Performance, use fresh output directory
  /tmp/t2gu-maze-performance, same workload/diagnostic flags. No agent system
  changes. Helper metadata now includes profile choices/driver name and bounded
  firmware power-limit reads. Syntax/diff checks passed; no tests/game launches.
  Performance capture pending; do not claim it is a fix or disable thermald.
  The owner requested a battery run, suspecting outlet/power supply. Next manual
  comparison is battery-only with KDE Balanced to match recorded AC runs, same
  maze/apps, roughly 60–90 s, output /tmp/t2gu-maze-battery. Performance-profile
  comparison remains unverified; do not assume the owner switched profiles.
  Helper now samples available battery/supply power_now, current_now, voltage_now,
  capacity, temp, health, usb_type and input limits. AC online/status and actual
  profile remain recorded, so validate source/profile before interpreting data.
  Supply driver ratings/negotiation values do not measure electrical outlet
  quality. Smooth battery behavior would support an AC-dependent policy or
  external-power lead, not prove a defective outlet/charger. Python syntax/diff
  checks passed; no helper/game/test execution or system settings changed.
  The owner completed the battery capture and reported no visible stutter.
  Actual capture is mixed-source: AC initially, battery Discharging in the scan
  spanning ~25.566–26.860 s, then battery throughout the remaining ~79 s.
  Actual platform profile is performance throughout, unlike prior Balanced
  captures. Evidence is saved under ignored
  `output/runtime-2026-10-07/battery-capture/`. Duration 106.124 s; 31 runtime/
  presentation reports, 5280 ticks, 39 clamps / 2.190 s discarded; RSS
  692.0–746.8 MiB, no swap or major faults. AC PL1 reaches 5 W and CPU clocks
  roughly 400 MHz (one snapshot median ~200 MHz). First battery snapshot has
  PL1 15 W but clocks still ~400 MHz; later scans recover to GHz frequencies.
  Battery PL1 continues varying 9.5–15 W, without another sustained low-clock
  plateau. Final 25 runtime windows: 4484 ticks, two clamps / 16 ms discarded;
  scene-paint medians 2.064–4.718 ms vs slow AC windows ~18.5–20.2 ms.
  Thermal package counter +634 in AC/startup phase, +9 in battery phase;
  5 W/low-clock plateau itself shows no new counter increments. Sensor scans
  are sequential; source/limit changes cannot be timed more precisely than
  their scan. Supports AC-dependent policy/power path, not an identified
  outlet/adapter/cable defect. Performance alone did not prevent AC slowdown.
  An other-outlet comparison was suggested, then explicitly skipped by the
  owner. Continue with writer attribution. Added tools/trace_power_limits.bt:
  observes intel_rapl_common:rapl_write_pl_data entry/return for PL_LIMIT writes,
  with CLOCK_MONOTONIC timestamps, PID/TID/comm, interface/domain/PL, requested
  microwatts, kernel stack and return status. No settings writes/overrides.
  Runtime module BTF and symbols are present, bpftrace 0.25 installed. Host
  thermald PID 1921 remains --adaptive; PPD PID 3265 active. Tracing metadata
  requires root; codegen attempt fails Permission denied even outside sandbox;
  passwordless sudo unavailable. Compile/attachment validation therefore
  pending, not passed. Manual root observer in one terminal must reach
  RAPL_READY before unprivileged game/hardware capture in another, AC connected,
  Performance profile, same maze/apps for 60–90 s, fresh /tmp/t2gu-maze-writer.
  Stop observer with Ctrl+C after game exits; log /tmp/t2gu-power-writer.log.
  Firmware/direct-register writes bypassing the probed function are not covered;
  trace absence alone cannot prove firmware is responsible. Helper metadata
  includes bounded thermal trip/policy/mode and INTC1040 adaptive UUID reads.
  Post-run firmware trip attributes include -274000 placeholders; these are not
  proof of an active invalid thermal policy. No agent game/test launches or system/
  renderer changes; no C++ rebuild needed for evidence/documentation analysis.
  Owner completed writer capture, reporting "a little stutter". Trace attached
  four probes and logged RAPL_READY before the game. All ten recorded PL_LIMIT
  requests are thermald PID 1921 TID 2236, interface 1 (MMIO), package PL1;
  all matching returns status 0. Requests 14→15→13.655→15→14→13→11→7→5→15 W
  (13.655 request reads back quantized 13.625 W). 5 W at capture t53.705 s;
  sampled CPU ~400 MHz shortly after. 15 W restored t59.908; clocks recover
  after ~62 s. Slow report scene-paint medians 22.704/26.280/23.179 ms vs ~3 ms
  after recovery. AC online, battery Charging, platform performance throughout.
  68.845 s, 19 reports, 3011 ticks, 104 clamps / 952 ms discarded; simulation
  max 5.779 ms, RSS 693.5–774.7 MiB, no swap/major faults. Package hardware
  throttle counter +755 overall, unchanged during the low-power plateau.
  Evidence under ignored output/runtime-2026-10-07/writer-capture. Trace has
  six expected missing-map warnings for non-PL_LIMIT returns and one discarded
  delete-result warning; changed guard to has_key and checked delete result.
  No lost-event messages; observed entry/return attribution remains valid.
  Saved log lacks RAPL_STOP; owner should Ctrl+C observer terminal if still open.
  Read-only INTC1040 data_vault snapshot: 1957 bytes, SHA256
  a3dae1fecf54bf33563152f62cc39b7b891ec820344cb3c0aaf46fbb1c6266cb;
  bounded LZMA decode yields 30725 bytes, two repositories and 96 keys, consumed
  exactly. Default and named sp14t-balance PSVT include TSKN 65 C MAX / 70 C MIN;
  data-vault PPCC min 5 W (distinct from kernel-exposed earlier 3 W minimum).
  Recorded TSKN 70.05 C during clamp, falling to 69.05 before restoration.
  Strong candidate trigger, not confirmed active daemon trip/policy selection.
  Firmware APAT includes Balanced and Performance named targets selecting same
  Balance PSVT, but live target not read. Thermald writer now confirmed for this
  run; do not keep labeling it unproven. Do not disable thermal management,
  raise limits, or assume its policy is faulty. No game launches/tests/system
  setting changes by agent; Python/documentation diff checks passed. Corrected
  probe needs manual validation before another use; no repeat capture requested.
  Owner requested proceeding. Added tools/dump_thermal_policy.py to obtain
  actual daemon sensors, active zones, trips and cooling bindings through a
  closed allowlist of D-Bus Get methods. No settings writes or service starts;
  bounded counts, per-call timeout/timestamps, start/end counts, JSON with errors.
  Direct host sudo -n GetZoneCount fails: interactive authentication required.
  Installed org.freedesktop.thermald system-bus policy permits root, denies default
  callers. Next owner command: sudo python3 tools/dump_thermal_policy.py | tee
  /tmp/t2gu-thermal-policy.json. No game run needed. Live helper query validation
  pending; AST/diff checked only. Local DMI: Dell Latitude 5420, BIOS 1.56.0 dated
  2026-06-30. Cached APT candidate equals installed thermald 2.5.11-0ubuntu1.1;
  upstream 2.5.13 exists but no established cure for observed sensor/limit cycle,
  no installation performed. Existing optional T2GU_MAX_FPS=30 can reduce drawing
  load while preserving simulation/thermal protection; this is a potential
  mitigation, unverified for power-limit stutter, not a changed default.
  Owner completed active-policy reader: 68 calls, no errors, 0.156 s, counts
  stable 12 sensors/15 cooling devices/7 zones, AC on/platform performance.
  Saved output/runtime-2026-10-07/active-policy/thermal-policy.json and summary.
  Active PASSIVE type 3 trips: TSKN 66/70/99 C; NGFF 47.5/49/65/99 C; TMEM99,
  TCPU102. All bind cdev12 rapl_controller_mmio, endpoints 15 W (unthrottled)
  and 5 W (most cooling); do not misread min_state/max_state naming as reversed
  hardware limits. POLLING type5 has no bound cdev. Snapshot temperatures
  TSKN62.05/NGFF55.05 and MMIOcurrent15W after run/cooldown. It confirms active
  trip/controller bindings, but several zones share cdev12; exact trip causing
  each previous write remains unattributed. API sensor enumeration positions
  do not necessarily equal stored trip sensor_id: do not invent a mismatched-
  sensor bug from their different numbering. Thermald preference ENERGY_CONSERVE
  is its upstream default and distinct from platform performance; no evidence
  that this is a KDE misconfiguration or safe to override its passive policy.
  Owner completed T2GU_MAX_FPS=30 trial, reported very little stutter. Saved
  output/runtime-2026-10-07/30fps-capture/: 55.728 s, 167 hardware scans,
  15 runtime reports/2787 ticks, one initial clamp/17 ms discarded, none in
  later reports. AC/performance constant, MMIO PL1 always15W, median all-CPU
  frequency1.179–4.3GHz, no <=500MHz median scan or package throttle increment.
  Scene paint medians1.927–2.943ms, simulation intervals15.943–16.682ms;
  max simulation1.594ms, RSS691.4–736MiB, noSwap/majorfaults. Residual scene
  repaint gaps50–100ms occur, but dirty skipping/idle prevents labeling every
  gap a missed moving frame; Qt swap return does not measure KWin presentation.
  IMPORTANT comparison confounds: battery Full100%/~1mA versus writer run
  Charging98%/464–493mA, colder TSKN50.05–55.05C versus prior67.05–70.05C,
  HDMI-A-1 1920x1008 60Hz versus DP-2 1920x1128 59.95Hz;
  owner confirms changing monitor or connection. Background apps remain unknown.
  Promising mitigation,
  not isolated proof that cap prevents restriction; sustained same-condition
  comparison needed. Simulation unchanged; exposure/composition may add frames.
  No new C++ changes/build/tests/game launches/system changes by agent. No
  default cap changed. Do not silently make 30FPS the default. Owner says
  monitor is not the cause and rejected repeating the uncapped degradation
  trial as obvious. Skip that trial and further monitor comparisons.
  Composition follow-up: StatusMessageWidget previously called update() every
  33ms even throughout each fully opaque2600ms hold. Its timer is now
  single-shot, waiting for the earliest fade boundary; updates occur only
  during fading or when lines are removed. Posts/repeat counts still repaint
  immediately, and scheduling preserves an earlier pending timeout so frequent
  posts cannot starve older fades. Hold/fade durations2600/900ms unchanged.
  This removes a concrete source of unnecessary raster-overlay composition,
  not a demonstrated thermald fix. Release rebuild and diff checks passed;
  manual verification pending, no agent tests/game launches. Keep existing cap opt-in and cache option.
- Assets are found through `assetDir()`/`assetPath()` (`src/assets/AssetPath.h`) —
  never build a path from the `ASSET_DIR` macro directly (`QStringLiteral(ASSET_DIR
  "/x")` was the old pattern and is gone). Resolution order: `$T2GU_ASSET_DIR`,
  then the configured GNUInstallDirs data path (`<exe dir>/../share/t2gu2/assets`
  by default), then `ASSET_DIR`, the compile-time absolute
  path to the source tree's `assets/` that a run out of `build/` uses. See the
  save-format note below for how saves avoid depending on any of these.
  Relative bindir/datadir layouts remain relocatable with the whole prefix;
  explicitly absolute install directories retain the configured data path.
- **Install (Linux):** `cmake --install build` / `make install` installs the
  binary, all of `assets/` (~1 GB) to `<prefix>/share/t2gu2/assets`, the
  `app_icon_*.png` set as hicolor `t2gu2.png`, and `t2gu2.desktop` (generated
  at configure time from `packaging/t2gu2.desktop.in`, so `Exec=` follows the
  *configure-time* `CMAKE_INSTALL_PREFIX`, not an install-time `--prefix`).
  `main.cpp` calls `setDesktopFileName("t2gu2")` so a Wayland app-id matches
  the desktop file. Validate the launcher with `desktop-file-validate`.
  If `build/install_manifest.txt` is root-owned (an earlier `sudo make
  install`), run installs with sudo or use a separate build directory.
- `T2GU_MAP_PATH` env var overrides which map boots first (defaults to
  `chapter1.json`) — use it to jump straight into any map/chapter or the
  sandbox without recompiling or playing through.
- `T2GU_SAVE_DIR` overrides the quicksave directory (normally
  `~/.T2gu2`). Use a temporary directory for save/load regression runs so
  they cannot overwrite the player's slot.
- Headless/CI-style chapter checks use the opt-in regression executable and
  the Linux RSS guard below. Each chapter runs in a fresh process, waits for
  explicit scene readiness, advances the introductory coroutine, reports
  population counts, simulates for another 2.5 seconds, and exits normally.
  Run affected chapters after generation, combat or script changes; omit
  `--chapters` to check all 25. Keep raw logs and investigate diagnostics:
  ```sh
  cmake -S . -B build-regression -DCMAKE_BUILD_TYPE=Debug -DT2GU_BUILD_TESTS=ON
  cmake --build build-regression -j2
  python3 tests/chapter_smoke.py --binary build-regression/T2guRegression --chapters 15
  ```
  The guard requires Python 3 and Linux `/proc`; it enforces a 3 GiB RSS
  ceiling and a 60-second deadline. A missing population/completion marker,
  nonzero exit, timeout, or diagnostic fails the run. See `tests/README.md`
  for limits and known optional Qt backend diagnostics. An arbitrary
  `timeout ... | grep ...` is not proof that population finished.
  **Watch memory when testing.** A character's sprite sheet is
  4480×10120 RGBA — ~181 MB decoded — so `SpriteSheet::load()` decodes it
  once, keeps only each frame's non-transparent bounding box
  (`SpriteSheet::Frame`: trimmed pixmap + offset within the cell, ~14–69 MB
  per character, ~56 MB mean) and drops the sheet. Measured once settled
  (RSS flat for several seconds — a fixed-time sample catches a chapter
  mid-load and under-reports, which an earlier version of these numbers
  did): historically chapter 4 849 MB (was 2,453 MB); `sandbox.json`, with
  the then-current *entire* 115-character roster, 6.4 GB after ~68 s of
  loading (was ~20 GB). The current roster has 99 characters; those are
  historical measurements, not a new measurement of today's sandbox. Still enough
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
  **Sprite facing and anchoring:** `Character::setVelocity()` shows the Back
  block only when moving up with vertical movement at least as strong as
  horizontal; *any other movement* (including purely horizontal) shows the
  Front block, mirrored for left — there is no side art, so Front's three-
  quarter view is the side view. Purely horizontal movement used to leave
  the facing unchanged, so walking up then left kept the back view. Anything
  that should sit "above the character" (health bar, `LevelUpTextItem`)
  anchors at `Character::headTopY()`, never at y=0 — the cell's top edge is
  ~550px above the head after the sprite refit, which is what pushed the
  level-up caption off-screen. An item's `boundingRect()` must cover
  everything its `paint()` draws (Qt culls by it).
  **Sprite rendering contract:** `Character::boundingRect()` is always the
  full cell (`SpriteSheet::cellSize()`), not the trimmed pixmap actually
  drawn — the feet anchor, shadow, health bar, selection marker and
  level-up text are all laid out against the cell. Anything needing a
  whole-cell image (the UI portrait) uses `SpriteSheet::paddedFrame()`,
  which composes it on demand. The historical 115-character audit verified
  every frame and both orientations pixel-identical to the old full-cell path.
  Focused regression checks are opt-in: configure with
  `-DT2GU_BUILD_TESTS=ON`, build, and run `ctest --test-dir build
  --output-on-failure`. These cover script reentry/queues, combat callbacks
  that spawn enemies, scene readiness/restoration, and (when Node is
  installed) chapter 6 progression across recruitment combinations. They
  use tiny temporary assets, not the full roster. There is no live-input
  test framework. Verifying
  actual keyboard/mouse interaction requires a real (or nested) X11
  display and synthetic input (XTest) — this has proven flaky in sandboxed
  environments (unpredictable input delivery, occasional `BadMatch` on
  `SetInputFocus`); prefer the headless method above for anything that
  doesn't specifically require live input, and don't take an X11 test's
  silence as proof of a bug — retry once before concluding.

## Source layout

```
src/            C++ grouped by responsibility
  app/          entry point, MainWindow, and Version.h
  assets/       asset paths, sprite sheets, and tile sheets
  audio/        music and sound playback
  game/         scene, characters, props, tile map, collision, and game state
  persistence/  save serialization and validation
  rendering/    viewport, scene visuals, layers, and paint metrics
  scripting/    JavaScript engine and api bridge
  ui/           dialogue, inventory, status, death, and loading widgets
assets/
  characters/   one subdirectory per roster entry (99 currently — down
                from 135 at launch; a fine-tooth-comb sprite audit found
                real per-frame defects (bleed, hard clipping, cross-cell
                ghosting) in several dozen, some regenerated via Codex,
                the rest removed and substituted for in every quest that
                referenced them), each a sprite sheet PNG + JSON sidecar;
                stats.json and sounds.json contain "stats" and "sounds"
                wrapper objects, respectively, keyed by roster name
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

`src/app/Version.h` defines `kGameVersion`, the game's version string.
Bump it and the version in README.md (right below the screenshot) together
on every release; `src/app/main.cpp` registers it with Qt through
`setApplicationVersion()`.

Project headers use paths relative to `src/` (for example,
`#include "game/GameScene.h"`). Every C++ target includes `src/` as its
include root; keep headers beside their corresponding implementation.

## Architecture

Qt's own object graph *is* the ownership graph — there is no separate
scene-graph or entity-component system layered on top.

- **`MainWindow`** — the `QMainWindow`. Owns `GameState` (the only thing
  that survives a level transition), the current `GameScene`, and every
  chrome widget (dialogue box, inventory, death menu, loading overlay,
  status box, debug HUD). Handles all keyboard input and dispatches into `GameScene`.
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
  Scene music starts with an ambient intro and then a shuffled playlist.
  An early intro end cancels its two-minute fade deadline. Script music or
  silence cancels automatic playback for that scene; replacement/stop
  also cancels pending fades. Retiring a scene stops its music.

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
  Ordinary functions and synchronous generator steps are protected too
  (`m_executing`); nested Qt event processing must not reenter JavaScript.
  Combat and pickup callbacks use `postEntryPoint()` so entity iteration
  finishes before handlers can spawn entities. They count as busy as soon
  as posted, preserve queue order, and are canceled when a scene retires.
- Level generation (`buildBranchingMaze`, `scatterOrganic`, `mulberry32`)
  is copy-pasted verbatim into every chapter script rather than shared via
  a module, because scripts can't `import`/`require` each other in this
  engine. When fixing a bug in one of these, grep for the same function
  name across every `chapterN.js` file — they're expected to be
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

Chapters 2–6 follow this macro-shape (chapters 1 and 7–25 are
"town, then maze" — see the next subsection): a small entrance pocket (plain
`scatterOrganic` decoration, no maze) → one whole-map `buildBranchingMaze`
(a real branching structure — recursive-backtracker spanning tree + a 15%
braid pass for extra loops, not a single corridor) → optionally one small
distinct climax pocket for a real narrative set-piece (a boss, a gated
vault). Don't reintroduce the old segmented/multi-zone pattern without
being asked — this shape was arrived at after several rounds of explicit
user feedback rejecting straight corridors, then single curvy corridors,
then segmented mazes.

### Town, then maze (chapters 1 and 7–25)

Chapter 1 was reformulated and nineteen chapters (7–25) added on this shape: a
walkable **town first**, then the **maze**, then a small exit pocket that
holds the chapter's key item. Levels alternate direction — 1, 8, 10, 12, 14,
16, 18, 20, 22 and 24 run left→right, 7, 9, 11, 13, 15, 17, 19, 21, 23 and 25
right→left — so the hero spawns against the west or east edge. Along the
level: `[border][town][river — chapters 1, 14 and 20 only][maze][pocket][border]`.
Chapters 7–16 are the first run of ten ("the ten notes", ending in the Long
Room); 17–25 are the second, nine places along "the Quiet Road".

| Ch | Title | Tileset | Light | Dir | Quest |
|----|-------|---------|-------|-----|-------|
| 1 | Fernhollow | grass_water | sunrise | → | Wren, order-of-three riddle, fox/deer riddle, hostage, glowing acorn; a river with one ford |
| 7 | The Frostmarket | dirt_snow | sunrise | ← | herd three stray horses to the pasture gate |
| 8 | Lanternside | dirty_plate_asphalt | torch | → | three permit chips for the checkpoint warden |
| 9 | Highgate Toll | grass_stone | sunset | ← | optional bounty for five troll kills |
| 10 | The Mourning Fair | haunted_grass_cobble | mystical | → | a rite whose order (moon, sun, storm) is taught by a riddle in town |
| 11 | The Bramble Bazaar | grass_dirt | none | ← | alchemist trade: three ingredients for the bramble crown (no gate) |
| 12 | Cinderport | stone_grass | torch | → | boss hunt: a 260 hp golem holds the crucible gate; 3-tile corridors |
| 13 | The Undertrack | asphalt_dirty_plate | cavern | ← | relay chain: each relay wakes only after the one upstream |
| 14 | Mirrorwater Ford | grass_water | mystical | → | optional toll of three valuables paid in town; ford already passable |
| 15 | The Vigil Lights | snow_grass | sunset | ← | optional three-wave hunt: clear each pack and return to the Vigil Light to begin the next |
| 16 | The Long Room | dirt_grass | sunrise | → | hostage + relic "chord" check + boss; hands off to 17 |
| 17 | Hushgate | dirt_snow | torch | ← | lost property: three things found in the maze go back to their owners; the Clerk then stamps the road |
| 18 | The Keepwalk | haunted_cobble_grass | cavern | → | **three consecutive maze stages**; optional keys for two Doorwards, with both doorways already passable |
| 19 | Gildmere | grass_dirt | mystical | ← | cursed treasure: each of four heirlooms springs an ambush when picked up; all four go back to the Reeve |
| 20 | Sluicegate | grass_water | sunset | → | map file has an unbroken river; script drains the ford on every start; three sluice parts earn an optional reward |
| 21 | The Rival Quarter | stone_grass | sunrise | ← | two guilds each want two goods for optional rewards; serving both makes peace (ending changes) |
| 22 | The Barter Mile | dirty_plate_asphalt | sunset | → | a three-trade chain (Tinker → Mystic → Gate-drone), each swap needs the previous item |
| 23 | Cartographers' Rest | snow_grass | none | ← | three surveyors read out exact tile coordinates; the hero navigates with the built-in compass item |
| 24 | The Inquest | haunted_grass_cobble | torch | → | deduction: three statements, exactly one liar; accuse with a warrant (an innocent turns hostile) |
| 25 | The Second Door | dirt_grass | mystical | ← | three-form boss (each form spawns where the last fell) that quotes earlier choices; ends on a hook, **no `loadLevel`** |

- **Maps are generated**: `python3 tools/make_chapter_maps.py [N ...] [--out DIR]`
  rewrites `assets/maps/chapterN.json` (ground only — the `obj` grid is empty;
  props are spawned by the script). The `SPECS` table at the bottom of that
  file is the source of truth for size, tileset, direction and the
  town/river/maze/pocket column split; the same numbers are stored in each
  map's `"layout"` field and repeated as constants (`W`, `H`, `DIR`, `MID`,
  `TOWN_U`, `MAZE_WEST/EAST/NORTH/SOUTH`, `POCKET_U0/U1`) at the top of each
  script. Change a spec and the script constants must follow. Running it
  with no arguments reproduces every shipped generated chapter map byte for
  byte; it does not generate the hand-authored chapter 2–6 or sandbox/test maps.
  A spec with `ford=False` (chapter 20) is an unbroken river; `--drain N` prints
  the `[col, row, tileName]` edits that turn it into the map with a ford (they
  are pasted into that script as its `DRAIN` constant, bank-blend tiles included).
- **Coordinates in these scripts are `u`**, a column counted from the start
  edge; `colAt(u)` turns it into an absolute column for either direction, and
  `mazeProgress(cell)` (0 at the maze entrance, 1 at its exit) is what
  `takeCells(pool, from, to, count, seed)` samples by. Never write an absolute
  column in a chapter body — it would only be right for one direction.
- The shared helper block is still copy-pasted verbatim per script (see
  *Scripting system*). `buildBranchingMaze` now takes a trailing options
  object: `flip` (mirror the maze for right→left levels), `diagonalSeam`
  (keeps wide core props from poking into corridor corners), `solid`
  (adds invisible full-tile `mzwall_k` barriers under every wall) and
  `wallPrefix` (the barrier id prefix, default `"mzwall_"`; `setBarrier` ignores
  an id that is already up, so a level that builds several mazes in a row must
  give each its own, as chapter 18 does). **Prop
  footprints alone leave slits between props, so a maze without `solid` can be
  walked straight through** — proven with a scripted bot in the real engine.
  Every chapter passes `solid: true` (chapters 2–6 got it after the fact, with
  identical props/NPCs/enemies/items — only barriers were added). Tilesets with
  no border ring and no interior wall ring (chapters 4 and 5, plus the
  generated no-ring maps, which span the maze over the whole height) would
  leave the top and bottom rows as a free corridor around the maze, so chapters
  4 and 5 also seal rows 0 and H-1 with `mzedge_north`/`mzedge_south` barriers.
- Physical quest gates remain in chapters 12, 16 and 25. They use
  `setExitGate(id, exitRows, blocked)` across the maze exit and lift it with
  `api.setBarrier(id, 0, 0, 1, 1, false)`. Other quests deliberately offer
  optional rewards; do not restore gates removed in commit `c4777d8`.
  Spawn-once guard vars protect hostiles, loot and bosses from respawning;
  NPCs are respawned on every level start. Hostile roster keys must not
  collide with an NPC or companion key in the same scene (`dark_knight`,
  `dwarf_miner`, `cyber_engineer` and `cyber_medic` are never enemies).
- Each chapter ends its key-item pickup with `setGlobalVar("chapter", n+1)`
  and `loadLevel("chapter{n+1}.json")`; chapter 6 hands off to 7 and 16 to 17.
  Chapter 25 sets `chapter` to 26 and stops on the open door — there is no
  chapter 26 — so it is the one that loads nothing.
  Earlier companion recruitment is optional in chapters 2–4. Chapter 6's
  Warden must accept incomplete parties and adapt its dialogue; never make
  a past optional recruit mandatory after the player can no longer return.
- **Mechanics worth knowing before adding a chapter** (all in `assets/scripts`):
  a gate can sit mid-maze only if the maze is built in stages (cutting one random
  maze with a wall strands fragments of the near side — the static check
  caught exactly that in chapter 18); a quest that edits terrain (`api.setTile`,
  chapter 20) must re-apply the edit in `onLevelStart`, because the map file
  always loads unchanged; a suspect turned hostile (chapter 24) is `despawnNpc`
  then `spawnEnemy` under the same roster key, so packs must not use that key;
  quest tokens are `keyItem: true` items, never the lootable catalog items, or an
  enemy drop could satisfy the quest. Choices worth calling back later go in a
  global var (`guilds_at_peace` from 21, `inquest_wrong` from 24, `chord_notes`
  from 16); chapter 25 reads all three and copes with each being unset.
- Verification used a scratch harness that is **not in the repo**: a mock
  `api` that runs `onLevelStart`, rasterizes props/water/barriers at 16 px,
  checks BFS reachability of every NPC, item and enemy with the real talk
  (120 px) and pickup (100 px) radii (with every gate lifted and any
  `drainFord()` applied), and measures maze sealing by comparing the median
  walking distance to the straight-line distance. A second mock drives each
  chapter's quest logic through its talk/pickup/kill handlers (both orders,
  wrong answers, reloads). Rebuild that kind of check before changing a maze or
  a gate; then load each chapter in the real engine under a memory guard (peak
  RSS 0.75–1.2 GB for these maps).

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
- The same problem hid the maze **entrances**: props draw upward from their
  base, core props are up to ~7-8 tiles tall (`cliff_face`; cottages and
  chapels ~3-4), and the border's outer face never counts as a seam, so a core
  set-piece a few rows south of a mouth painted over the whole 2-tile
  opening — walkable, but it read as a solid wall (confirmed by rendering
  every entrance; collision was open in all 25 chapters). `inMouthBand()`
  now gives edge props to wall tiles up to `kMouthClearRows` (9) rows below
  each mouth, across the border and a `kMouthSideMargin` (4) column margin.
  It rolls from its own `mulberry32` stream, so maze structure and every
  other prop are unchanged. Both margins were widened by one tile twice
  (2026-09-27, see the Asset pipeline section's props-width note below) —
  re-derive them again if that calibration ever changes.
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

`TileSheet::tile()` retains each extracted pixmap until a successful sheet
reload. Keep its pixmap cache key stable across paints: making a fresh sheet
copy for every unchanged border/object tile caused repeated GL texture
uploads in the October 5 API capture. Failed loads preserve the current
sheet and its cache. This removes avoidable rendering churn; it is not a
confirmed fix for the Intel GPU hang.

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
  `SceneLayers.h` defines top-level bands: ground-Y scenery/characters,
  pickups, projectiles, lighting, then notifications. Pickups and fireballs
  receive world lighting; level-up captions remain readable above it.
  Prop shadows within the full-art bounds share the prop's paint call;
  only overflow shadows use owned lightweight child items with independent
  bounds. Their opaque area is empty: translucent gradients must not obscure
  other items in Qt's redraw calculations. An unconditional pixmap child
  introduced in the review doubled prop item counts and increased rendering
  cost (corrected 2026-10-05). The prop's full-art `boundingRect()` and all
  placement/footprint calculations remain unchanged.
  Level-up captions are scene-owned top-level items that follow
  their original character; `beforeEntityDestroyed()` cancels them before
  that anchor is deleted.
- Every `props.json` catalog `width` was bumped again (2026-09-27, separate
  from the one-time 2x bake above) — ~9% across the board, ~18% for 16
  building-flavored entries (cottages, chapels, towers, the windmill, the
  forge, the castle wall/gate/stairs, the drawbridge, the portcullis) —
  so buildings in particular read as more proportional to characters. The
  5 horizon-backdrop props (`dense_treeline`, `distant_treeline`,
  `distant_hills`, `misty_peaks`, `misty_ridge`) are excluded — already
  deliberately oversized background scenery, unrelated to the proportion
  issue. `Prop`'s own machinery (trimming, feet fraction, footprint,
  shadow radius) all scale from `width` automatically, so this needed no
  code change — but the maze entrance clearance margins did (`inMouthBand()`
  above), since `cliff_face`, the tallest core obstacle, moved closer to
  the edge of the old margin than is safe. A further flat +8% followed the
  same day, this time uniform across all 130 non-excluded entries (no
  extra building bump) — `cliff_face` is now 800px (was 680px before
  either pass), and the maze margins were widened by one more tile again.

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
  Failed searches obey the same retry cooldown as successful searches.
  Stuck detection measures accumulated progress over its time window, not
  an 8px requirement per frame; changing waypoints resets that baseline.
  A reachable slow-moving character must never blacklist its own path.
- October 5 pathfinding optimization: A* now uses reusable dense tile
  costs/parents with generation stamps and a reusable heap. Equal-cost ties
  prefer progress toward the goal; stale heap entries do not consume the
  expansion cap. Tile-center walkability is cached lazily until
  `TileMap::walkabilityRevision()` or `BlockingGrid::revision()` changes.
  Water transitions, successful tileset/map loads and blocker mutations
  invalidate the cache; temporary stuck-cell blocks stay outside it.
  Start/goal center exceptions and four-directional routes are retained.
  `T2GU_PROFILE_PATHFINDING=1` reports three-second CPU search and combined
  enemy/party AI summaries; see `tests/README.md` for their scope. The
  optimization is source-based; gameplay speedup remains unmeasured.
  Regression checks were added but not run, honoring manual verification.
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
- `restoreSnapshot()` places every follower at its exact saved position,
  but a restarted trail (previous bullet) has no memory of that — left
  alone, `followTrail()`/`shuffleInCrowd()` would immediately "correct"
  each follower toward a trail slot computed from nothing but the leader's
  current spot, visibly undoing the restore by walking them to the leader
  instead of leaving them where the save put them. `restoreSnapshot()`
  sets `m_partyFollowSuppressedUntilLeaderMoves` right after positioning
  the party; while it's set, a follower with no nearby enemy holds still
  instead of following (it still fights an adjacent enemy normally - only
  the "no enemy, follow the leader" branch is suppressed).
  `updateLeaderTrail()` clears the flag the moment it detects genuine
  leader movement, at which point following resumes exactly as it always
  does when a follower falls out of position - this only suppresses the
  one artificial correction a load would otherwise cause immediately.

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
  Fireballs are guaranteed targeted spells: flight time is fixed at launch,
  while the visual follows the original target until impact. A control
  switch never redirects a bolt. `GameScene` advances flight, damage and
  impact fade with simulation time, so scene suspension pauses them
  together. Target removal and snapshot restoration cancel pending bolts
  and their visuals; caster removal does not cancel an already launched spell.

Enemy-defeat handlers may accept `(name, worldX, worldY)`: the extra world-pixel
feet coordinates are copied when defeat is awarded, so they remain valid after
corpse cleanup and while the event waits behind another coroutine. Existing
name-only handlers continue to work. Chapter 25 uses `spawnEnemyAtWorld` for
each following form at that exact point; `spawnItemAtWorld` places its potion
nearby using the normal pickup nudge rules. These methods reject nonfinite or
out-of-map anchors. Tile-based spawns retain their existing behavior.

## Performance findings (2026-09-19)

Measured with a scratch-only profiling tour (teleport the hero to ~10 spots
per map, run it back and forth, record tick interval, per-section logic time,
per-category paint time, and item counts; never committed). **Collision is
not the cost:** `TileMap::isWalkable` + `BlockingGrid::containsPoint` run at
35–85 ns per call (well under 1 µs per tick), and every part of `onTick`
(AI, character ticks, camera pan, input) totals about 0.1–0.2 ms. Blocking
footprint size versus the dt clamp alone does not prove collision safety:
run, buff, level and catch-up multipliers can cross a 28.8 px footprint in
one tick. `Character::tick()` now sweeps each axis continuously through
the blocking grid and every crossed terrain/object cell, retaining wall
sliding and feet-point collision. The timings above describe the earlier
point-query measurements, not a new benchmark of the sweep implementation.
World bounds are checked before converting points to tile coordinates.
Tileset swaps commit validated replacement sheets before advancing the map's
tileset revision; `TileMapItem` observes that revision to clear cached variants
and refresh the water index. Failed replacements retain the current sheet.
Dialogue arrival closes inventory immediately. Window/application
deactivation clears held direction/Shift keys and stops the controlled
character; synthetic Qt events verify those handlers, not desktop delivery.

**Frame time is paint time, and it scales with props in view.** Chapter 1
at 2560×1440: 43 props in view = 4 ms/frame, ~150 = 11 ms, ~170–200 =
16–24 ms, at which point the tick interval stretches past 16 ms (mean
25.7 ms, spikes to 90 ms) — the "slows down / jitters near edges and in
mazes" symptom. Border rows put one prop per tile on screen (191 in view at
the north edge) and dense mazes do the same. At the densest spots prop
shadows (an antialiased radial-gradient ellipse per prop per frame) plus prop
sprites are ~60% of the frame; tile map 2–3 ms, lighting 1–4 ms, characters
<1 ms. Window size matters: the same spots are fine at 796×796 and mostly
fine at 1920×1080 (occasional >33 ms frames), but not at 2560×1440. Prop
sprites are on average only ~60% content (the rest transparent margin).
**Applied (same day):** (1) the Top/Bottom horizon-border strips now use the
same every-3rd-tile stride as the side edges (`kEdgePropStride` in
`decorateMapEdges`; interior wall sets are untouched) — 3 overlapping copies
per point instead of 9, blocking still registered for every tile, and the
band reads as fewer, larger sections; (2) prop shadows are drawn from a
cached pixmap per distinct radius (`shadowPixmapFor()`), max 4/255 different
from the gradient and only inside the shadow's own area; (3) prop sprites are
trimmed to their visible bounding box like character sheets (`trimToContent()`,
`PropAsset::offset`/`fullSize`), pixel-identical for every unrotated prop and
for 4 of the 5 real border strips (the fifth, `distant_hills`, differs by a
1 px tie-break under the 90° rotation at a few positions). `Prop::boundingRect()`
is therefore always the FULL art rect, not the trimmed pixmap — same contract
as `Character`. Result at 2560×1440 on chapter 1: paint per frame at the dense
spots 23.7 → 15.6 ms (map centre) and 22.8 → 14.7 ms (interior B); mean tick
interval 25–27 ms → 16.0–18.1 ms. Dense areas can still exceed one frame at
that size (map centre 18.1 ms); the next lever would be reducing overdraw in
the mazes themselves. **Testing pitfall:** when rendering a scene to a
`QImage` for pixel comparison, the target must be exactly the integer source
rect size — `QGraphicsScene::render` silently rescales otherwise, and the
resampling puts bands of duplicated/skipped rows in the output (this cost an
hour of chasing a nonexistent paint bug).
Movement-feel note, not
a collision bug: `MainWindow::refreshMoveIntent` does not normalize diagonal
input (diagonals are √2 faster) and axis-separated sliding then drops a
diagonal run along a wall to axis speed (−29%).

## Save/load

Single quicksave slot at `~/.T2gu2/save.json` (F5 saves, F8 loads, F9
kills the controlled character on the spot for a fast respawn/quit).
F5 is ignored while a script (including queued entry points), dialogue,
level transition, or death menu is active: coroutine continuations are
not saved. Do not replace an active dialogue with a save/refusal message
or defer that save to a different scene. F8 and gameplay input are also
ignored during level transitions.
`GameState` (vars/inventory/level/experience/stat bonuses) plus a full
`GameScene::SceneSnapshot` (exact party/enemy/NPC/item positions, HP, and
temporary stat bonuses with remaining simulation durations)
round-trip through JSON — a chapter's own `*_spawned` guard vars alone can
only block re-spawning a whole batch outright, never track which
*individual* members survived, hence the separate snapshot.
World item snapshots use the actual ground anchor after any spawn nudge;
restoration places them exactly and removed props release their occupancy
reservations. Chapter 15 preserves active-wave counters during population
because quickload restores the surviving wave enemies afterward.
Temporary buffs survive quickload but expire on normal chapter transitions.
Maximum-HP boosts refill living members; dead members stay at zero HP.

- Written via `QSaveFile` (atomic: writes to a temp file, replaces the
  real one only on a successful `commit()`) — never regress this back to
  a plain `QFile` that truncates the previous save immediately on open.
- Loaded with an explicit `QJsonParseError` check — a corrupt/truncated
  file must produce a clear "save is corrupt" message, not silently
  become an empty `QJsonObject` that fails confusingly later.
- Carries a `"saveVersion"` field (current: `2`). A missing version is
  treated as `1`; version 1 is rejected because its quest variables were
  not namespaced by chapter. Versions newer than `kCurrentSaveVersion`
  are also rejected. Optional temporary-buff fields default to no bonus,
  so earlier version 2 saves still load. Bump the version when the shape
  changes in a way that needs a migration decision — not for every new field.
  Optional fields retain defaults; provided fields are validated by
  `SaveData`. Saves are capped at 8 MiB. Counts/stats, scalar story variables,
  actor/item references, feet positions, health and buffs must be valid.
  Party composition and maximum health must match the reconstructed chapter.
  Parsing and restoration operate on a candidate, never on live state.
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
cosmetic — the delay itself, not the work that follows: constructing
`GameScene` and populating it can take real time, see below), then swaps
`GameScene` instances. **This delay must never be a nested `QEventLoop`** (a
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

The current shape: `loadLevel()` synchronously pauses the old scene's tick
and suspends its script engine before any delay. A plain
`QTimer::singleShot(1000, ...)` calls `finishLoadingLevel()` through Qt's own
loop, never a second nested loop. `m_levelTransitionPending` prevents
stacked transitions. The old scene and its UI remain intact while a fresh
candidate uses `m_pendingGameState`; save loads also carry `m_pendingSnapshot`.
`m_loadingScene` remains separate from `m_scene` until commit.

The candidate's first `onLevelStart()` step populates before its first yield.
Its `sceneReady` handler restores any snapshot synchronously, then commits
state, rebinds the scene to the persistent `GameState`, swaps the view, retires
the old scene, and hides the overlay. Candidate dialogue/status signals are
buffered until commit. Missing/invalid maps or scripts, first-step exceptions,
and restoration failures discard the candidate and resume the old scene's
coroutine, queued events and tick without counting loading time as simulation.
No partial candidate state may escape into the live game. A failed initial
boot with no previous scene reports failure without starting an empty scene.
Terminal `stopTicking()`/`ScriptEngine::stop()` still cancel all pending work;
reversible transition suspension must not use those terminal methods.

Do not infer readiness from the order of two `singleShot(0)` calls: sprite
loading pumps Qt events and can run the second callback before the first
finishes. Both old and candidate simulation remain stopped through population
and restoration. Later script-driven loads retain tick/execution guards.

**The loading overlay must stay up until the level is actually populated,
not just until `GameScene` exists** (2026-09-27 fix). Constructing
`GameScene` doesn't spawn a chapter's town/maze/hostiles — that's
`onLevelStart`, deferred to the *next* event-loop turn (same
`singleShot(0)` above). Hiding the overlay synchronously right after
`new GameScene(...)`, as it used to, revealed a bare map for a beat before
`onLevelStart` actually populated it. `finishLoadingLevel()` now connects
to `sceneReady`, restores any snapshot synchronously, and only then hides
the overlay and enables input. A first-step script redirect is held until
this readiness boundary, then starts a normal transition.

**A session's first level load can be slow enough to trip the OS's
"Not Responding" state, and there's a narrow, deliberate exception to
the "no event-loop-reentrancy" rule above that fixes it.**
`GameScene::createCharacterAtWorldFeet()` keeps a process-lifetime cache
of decoded `SpriteSheet`s (`spriteSheetCache()`), so only a genuinely new
roster name pays `SpriteSheet::load()`'s real cost (~181 MB PNG decode).
A session's *first* level load can hit a dozen-plus cache misses in a row,
all inside one synchronous `onLevelStart` burst, with no event-loop turn
in between to repaint or answer a window-manager ping - every later
transition mostly hits the warm cache and doesn't show this.
`SpriteSheet::load()` now calls
`QCoreApplication::processEvents(QEventLoop::ExcludeUserInputEvents)`
once per fresh decode. User input is excluded; initial population and
snapshot restoration run before the new scene's timer starts, and the old
scene is suspended until commit (or retired afterward). Later script-driven decoding is protected by
`GameScene`'s tick/execution guards and `ScriptEngine::m_executing` for
ordinary functions as well as generator steps. The former assumption
that no timer ran during population was incorrect: the constructor used
to start it before the deferred `onLevelStart` call. Don't add a bare
`processEvents()` call elsewhere on the strength of this exception alone;
check timers, queued callbacks, and script execution at that call site.

## Known limitation, not yet worth fixing

`GameScene::m_charactersByName` (`QHash<QString, Character*>`) is keyed by
roster name for party/NPC lookups (`giveControl`, `despawnNpc`), where a
name genuinely identifies one entity — but `scriptSpawnEnemy` inserts into
the *same* table, and enemies are explicitly allowed to repeat a name
(`spawnEnemy("goblin")` three times is fine, unlike party/NPC spawns, which
refuse a duplicate). The table is therefore serving two different concepts
(unique entity identity vs. creature archetype) through one keyspace,
where every enemy of the same type overwrites the previous one's entry.
This works today because nothing currently does `giveControl("goblin")` or
otherwise expects a name-based lookup to resolve a *specific* enemy
instance — but if a future feature needs that (a named unique boss
tracked by ID, "target the same goblin I just talked to"), the fix is a
separate `entityId`/`archetype` distinction (e.g. `goblin_0042` as the table
key, `"goblin"` as a separate archetype field), not a workaround bolted onto
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
  code (the chapter scripts), a third one should look exactly like the
  other two, not introduce a stylistic variant.
- Prefer measuring over guessing. Several bugs in this project's history
  were root-caused by directly checking real data (pixel-sampling a
  screenshot to prove a shadow was actually absent, not "looks about the
  same"; diffing a new algorithm's output against an existing verified
  map) rather than trusting a plausible-sounding assumption. When in
  doubt about whether something is actually broken, check the pixels/data
  before writing the fix.
