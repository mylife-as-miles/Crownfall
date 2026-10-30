# My Legacy desktop evidence

Actual Chromium/SwiftShader verification on the current feature branch. These captures do not establish real GPU performance.

- `verification.json`: 30 full browser groups, including lazy entry, founding, saves/recovery, controls and desktop/landscape layouts.
- `chess-first.json`: eight launches with/without a saved banner and counted routes to Play. The first legal move is explicitly unmeasurable in this unconnected menu.
- `captures.json` and the eight PNGs: actual production captures at 1280×720, 1920×1080 and 844×390.
- `frame-reuse-regression/`: 16 focused state, focus, scroll, retained-frame and layout groups.
- `frame-reuse-motion/`: two actual CSS-animation groups; the initial missing-directory harness failure is retained separately.
- `frame-reuse/performance-focus.json`: latest quiet measurement for the retained inspector frame. Repeated mean/p95 3.76/10.14 ms and cold 5.65/23.65 ms remain outside the full budget. Neither has unthrottled page long tasks; 4× CPU remains over budget with long tasks.
- Earlier `performance.json`, `performance-focus.json`, `paint-focus/` and `path-cache/` preserve prior probes, including the explicitly contended run. Do not substitute these for final-state acceptance.
- `vector-image/`: a reverted follow-up experiment, including its reproducible patch. Rendering/readiness/layout/accessibility passed (144 pixel comparisons), but repeated performance regressed to 5.03/21.60 ms mean/p95. None of that experimental source is retained; both builds passed after rollback.

The scripts retain raw top-level input events, thread time and nested layout attribution. Sparse frame buckets can aggregate separate tasks; some raw events nevertheless exceed the budget. No numerical quality pass is claimed.
