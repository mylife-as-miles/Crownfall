# My Legacy — focus restoration and performance, round 3

Continues `feat/my-legacy` from `1a4d8dbc75e7fa35832543f542b35b51cb1cacce`. The retained runtime change is limited to releasing focused overview controls **before** their layer hides on inspector entry. Existing primary-action focus, delayed restoration, Back, inspector state resets, motion, copy and desktop/Quest visuals remain unchanged. No protected Play, chess or shared domain source was changed.

**Performance acceptance remains open. No 9/10 or hardware pass is claimed.** These production Chromium captures use SwiftShader in a container with no GPU. The gameplay stand-in is still the environment. No physical Quest was tested in this round.

Large JSON evidence is losslessly gzip-compressed after verification; `archive-manifest.json` records the original byte counts and SHA-256 hashes, and decompression was checked byte for byte. The scripts produce ordinary JSON for local iteration. Decompress an archived geometry baseline before passing it to `CROWNFALL_LEGACY_GEOMETRY_BASELINE`.

## Diagnosis and retained correction

The old overview label remains mounted when the inspector hides its layer. During rapid entry/cycling, React could attempt to restore that hidden label and read/write the scroll positions of ten ancestors. The positive diagnostic in `focus-probe/performance-focus.json.gz` records that React `rf` call stack, the hidden `.legacy-labels` ancestor, and the focused Banner Hall label at the affected transitions. The repeated unthrottled probe records 20 calls each to `scrollLeft` get/set and `scrollTop` set. This is instrumentation evidence; **its instrumented timings are not budget evidence**.

`LegacyScreen.openLandmark` now blurs only an active descendant of the outgoing overview before changing the view. It adds no intermediate focus target. The existing double-animation-frame request still focuses the inspector primary action. Landmark labels have no blur side effects.

Fresh same-scenario observations with identical Low preset, 1280×720 and reduced motion:

| Unthrottled navigation | Baseline B mean / p95 | Retained fix A mean / p95 |
| --- | ---: | ---: |
| Cold | 6.36 / 16.63 ms | 6.39 / 27.57 ms |
| Repeated | 4.77 / 19.83 ms | 4.15 / 17.79 ms |

For repeated navigation, maximum raw input thread time changed from **9.72 to 3.90 ms**; summed Layout thread time nested in the inputs changed from **11.11 to 0 ms**. Both runs had zero unthrottled page long tasks. This supports the specific focus-race correction, while cold results and frame-level budgets remain failing. The independent reviewer found the change safe to retain without calling the full performance gate passed.

`baseline-a/` preserves an earlier fresh baseline (repeated mean/p95 6.08/23.85 ms), illustrating variability. `baseline-b/`, `containment/` and `focus-release-a/` retain raw compressed Chromium traces and CPU profiles, all input wall/thread/layout durations, frame starts, frame script buckets and script work before the first recorded frame. The original budget metric and scenarios were not changed. Sparse frame buckets can aggregate separate tasks; raw input and on-thread work are retained so that limitation is inspectable.

## Rejected experiment

`containment/` tested inspector-body `contain: layout style` only. Every descendant rectangle and scroll extent matched baseline B exactly; layout, scrolling, state/reset and motion checks passed. Repeated raw input Layout remained 11.56 ms and the unthrottled p95 was 21.86 ms. No material gain was established, so the CSS change was reverted. No containment or image-isolation experiment is part of the final app.

## Final full protocol

`final/performance.json.gz` repeats the full entry, idle, orbit, inspector, nation, typing, preset and 4× CPU protocol. It adds post-GC checkpoints over 15 identical Home/Legacy round trips, opening every inspector on each trip.

| Unthrottled scenario | Script mean | Script p95 | Page long tasks |
| --- | ---: | ---: | ---: |
| Idle 10 seconds | 0.11 ms | 0.20 ms | 0 |
| Orbit drag 5 seconds | 1.86 ms | 5.62 ms | 0 |
| Inspector cycling | 7.72 ms | 34.39 ms | 0 |
| Nation changes | 2.50 ms | 8.82 ms | 0 |
| Founding typing | 2.80 ms | 4.06 ms | 0 |

Entry had two page long tasks (maximum 995 ms), with **zero long tasks before loading feedback had rendered**. Trace anatomy retains substantial software-WebGL/GPU-process waits; the entry numbers are not a hardware cold-start claim. Four-times CPU orbit and navigation remain over budget with long tasks. Low/Medium/High stand-in captures report 36 draws, 4,306 triangles, 31 geometries, one texture and six programs; they do not describe the separate Bannerhold environment.

| Completed trips | Post-GC heap | DOM nodes | Listeners | Renderer resources |
| --- | ---: | ---: | ---: | --- |
| 0 | 7,226,852 bytes | 246 | 217 | 31 geometries / 1 texture / 6 programs |
| 5 | 7,657,924 bytes | 246 | 217 | unchanged |
| 10 | 7,797,380 bytes | 246 | 217 | unchanged |
| 15 | 7,898,428 bytes | 246 | 217 | unchanged |

The declining heap growth still does **not** establish a plateau or leak freedom. `retention/` is a separate bounded live-heap investigation after warmup; its snapshot/type evidence is distinct from frame-budget measurements.

`retention/retention.json.gz` measures another 15 identical trips after 15 warmup trips in a separate browser context. Its post-GC samples are 7,123,076 / 7,238,744 / 7,340,236 / 7,404,724 bytes at trips 15/20/25/30. Its own 266 DOM nodes, 213 listeners and renderer resources stay constant; do not compare absolute counts between different harness contexts. The two live-heap snapshots change by 273,144 self-size bytes: 205,780 compiled-code bytes, 66,816 native bytes, 420 object-shape bytes, and only 156 ordinary object/array bytes net. Most native growth is browser timing/paint/layout records and associated structures. This narrows the observed growth; it is not a flat-heap or universal leak claim. In particular, compiled-code growth must not be attributed wholesale to Playwright.

Raw snapshots are intentionally local in `/tmp/crownfall-legacy-heap-LSktK3/`; their SHA-256 hashes and portable type/constructor totals are recorded in `retention/retention.json.gz`. The reproducible script is `scripts/verify-legacy-retention.mjs`. It opens the real UI, records no frame-budget claim, and never commits full heap contents.

The independent retainer review found that all 86 closure owners of 84 new instruction streams already existed in the earlier snapshot. These gross node counts are separate from net code-byte growth. The largest new stream belongs to the existing `createMusterFormation` function; others include existing React traversal functions. Added deoptimization metadata also references existing functions. Browser native layout/paint timing records are rooted through `Performance` entry vectors, rather than application arrays. This supports code warming and browser-owned timing retention; exact ownership of every net code byte and universal leak freedom remain unresolved. No speculative runtime memory change was made.

## Functional and visual checks

- `focus-release-a/verification.json`: 11 groups covering controller founding/navigation, keyboard remapping, all viewport layouts, real wheel scrolling, retained frame/keyed-body resets, exact geometry, focus and native 280 ms motion/reduced motion.
- `final/inspector-geometry.json.gz`: exact comparison of every descendant box and scroll extent in all four inspectors at 1280×720, 1920×1080 and 844×390 against baseline B.
- `final/verification.json`: final geometry and focus checks plus full performance collection; no JavaScript/console errors.
- `tab-regression/verification.json`: the tightened native Tab test also excludes `document.body` and requires a connected, focusable element inside the visible Legacy screen. Rapid E/E/Back/re-entry, keyboard and pointer entry pass.
- `final/1280x720-muster-grounds.png` and `final/844x390-muster-grounds.png`: fresh unmodified production screenshots. `final/layout-review.jpg` is a compact review sheet of those captures. The independent visual critic viewed only that sheet once and found no definite overlap, clipping, page overflow or theme defect. Fine text, motion, focus and headset comfort cannot be certified from the sheet.
- Both production builds, two desktop exact-path cache tests, `check:sync` and `check:legacy:lazy` passed. Existing bundle-size/third-party annotation advisories remain.

Quest runtime and assets are unchanged by this desktop browser-focus correction. Prior hands-only emulator evidence remains in round 2; it was not represented as a fresh hardware or hand test here. The first legal chess move remains unavailable until the creator's chess port is connected.

## Reproduction

Run a production preview at port 5180 from `main game/`. All browser jobs must run sequentially without a Quest runtime or build contending for CPU.

```sh
CHROMIUM_PATH=/usr/bin/chromium CROWNFALL_TEST_URL=http://localhost:5180 CROWNFALL_LEGACY_ONLY=perf CROWNFALL_LEGACY_PERF_ONLY=landmarks CROWNFALL_LEGACY_RAW_TRACE=1 CROWNFALL_LEGACY_ARTIFACTS=artifacts/legacy/local-focus node scripts/verify-legacy.mjs

CHROMIUM_PATH=/usr/bin/chromium CROWNFALL_TEST_URL=http://localhost:5180 CROWNFALL_LEGACY_ONLY=perf CROWNFALL_LEGACY_RAW_TRACE=1 CROWNFALL_LEGACY_LEAK_SLOPE=1 CROWNFALL_LEGACY_ARTIFACTS=artifacts/legacy/local-full node scripts/verify-legacy.mjs

CHROMIUM_PATH=/usr/bin/chromium CROWNFALL_TEST_URL=http://localhost:5180 CROWNFALL_LEGACY_ARTIFACTS=artifacts/legacy/local-retention node scripts/verify-legacy-retention.mjs
```

`CROWNFALL_LEGACY_FOCUS_PROBE=1` enables the separately labelled focus/scroll diagnostic. Do not use instrumented timings as acceptance evidence. Geometry comparison is opt-in through `CROWNFALL_LEGACY_ONLY=inspectorgeometry` and `CROWNFALL_LEGACY_GEOMETRY_BASELINE=<path>`. `CROWNFALL_LEGACY_CAPTURE_INSPECTORS=1` adds the two screenshot captures.
