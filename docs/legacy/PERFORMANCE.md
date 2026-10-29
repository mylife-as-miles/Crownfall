# My Legacy — browser performance standard

My Legacy must run smoothly in the browser, without lag or hitches, on typical hardware: current
Chrome, Edge, Firefox and Safari on a mid-range laptop with an integrated GPU, and the Meta Quest
Browser. This standard applies to both workflows, every evidence round and every critic.

## Targets

| | Desktop | Quest |
| --- | --- | --- |
| Frame rate | 60 fps at the default preset on a mid-range integrated GPU; Low must stay smooth on weak integrated GPUs | 72 Hz (13.9 ms) |
| Our main-thread script per frame (scene update, render submission, UI) | ≤ 4 ms average, ≤ 8 ms p95 | ≤ 5 ms, no per-frame allocation |
| Draw calls | Low ≤ 120, Medium ≤ 200, High ≤ 400 | ≤ 120 |
| Triangles in view | Low ≤ 300k, Medium ≤ 800k, High ≤ 1.5M | ≤ 250k |
| Long tasks (> 50 ms) during interaction | none | none |

Interaction covers hover, orbit and zoom, landmark transitions, panel open/close, typing in the
founding ceremony and Back. Entering My Legacy may show a short loading state, but the tab must
never freeze for more than 200 ms without visual feedback.

## Rules

- **One render loop at a time.** Pause the menu sorcerer and atmosphere while My Legacy is open, and
  the Legacy renderer while the menu is shown. Stop rendering when the tab is hidden. Honour the
  frame limit.
- **Off the critical path.** Chunk heavy environment building across frames or run the pure shared
  builders in a Web Worker. Decode textures asynchronously (`createImageBitmap` or the platform
  loader). Precompile shaders before the reveal (`renderer.compileAsync` or the IWSDK equivalent) so
  the first camera move does not stutter.
- **Cheap frames.** No allocations or React state updates per frame: position labels through refs or
  direct DOM writes. Raycast simplified proxies only on pointer move. Use time-based easing.
  Instance and merge to hold the draw-call budgets. Size textures per preset with mipmaps. Cap
  `devicePixelRatio` (≤ 2; lower on Low). Use one bounded shadow map from the key light only. Post-
  processing is optional and off on Low.
- **Adaptive quality.** Step down automatically when sustained frame time exceeds the budget, as the
  existing `web/` game does, and tell the player once.
- **No leaks.** JS heap and `renderer.info.memory` (geometries, textures, programs) stay flat across
  at least five Home ↔ My Legacy round trips and nation switches. Everything is disposed.
- **No regressions.** The existing menu, sorcerer and transitions keep their current smoothness.

## Measurement protocol (every evidence round)

The development host has no GPU: WebGL is software-rendered (SwiftShader). Absolute FPS measured
here understates real hardware and never proves smoothness. CPU cost, long tasks, hitches,
allocations, leaks, draw calls, triangles and memory are hardware-independent and must be measured.

1. Desktop, with Playwright and CDP (`Performance.getMetrics`, a `PerformanceObserver` for
   `longtask`, `performance.mark` around update and render submission), measure these scenarios:
   Home → My Legacy entry; 10 s idle; 5 s orbit drag; cycling every landmark framing; founding with
   typing; five Back-to-Home / re-enter round trips; a nation switch. Record:
   - long tasks (count, max duration);
   - script time per frame (p50/p95/p99);
   - frame-time distribution at reduced render scale;
   - JS heap and `renderer.info` before and after the round trips;
   - draw calls, triangles and programs per preset.
2. Repeat entry, orbit and landmark cycling with CDP CPU throttling at 4× as a low-end CPU proxy.
3. Quest emulator: `renderStats` triangles and draw calls; per-frame system time samples;
   verification that `update()` paths do not allocate.
4. Write the numbers to the round's evidence index with the software-rendering caveat. Critics treat
   any budget violation, long task during interaction, leak or regression as a blocker.

Smoothness on real GPUs and on a physical Quest must be confirmed by a person on that hardware.
Never claim it from this environment.
