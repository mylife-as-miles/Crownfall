# Chronicles — work status

*The Archive of Ash & Aether (working presentation title). Lead architect, end of M0, 29 October 2026.*

Read this file first after any context loss or in a new session, then
[`ARCHITECTURE.md`](ARCHITECTURE.md). Update it after every meaningful iteration. The creator's
directive and the approved content pack are supplied to agents outside version control; never copy
private briefs into this repository.

## 1. Current implementation status

**Milestone:** M0 (resume and architecture audit) is complete. M1 has not started.

**What selecting Chronicles does today.** The Home tile no longer opens an unavailable-information
dialog on either platform.

- **Desktop:** Home → Chronicles opens a full-screen `chronicles` menu screen with three exhibit
  tabs. *The Atlas* is a real-time 3D relief of the painted map on a dark table, with four nation
  rings, camera flights to each nation and a record panel. *The Interregnum* is a 2D timeline of
  four stops. *The Laws of the Gambit* shows three 2D articles. Back closes an open record, then
  returns Home with the Chronicles tile selected and focused.
- **Quest:** Home → Chronicles shows `View_Chronicles` in the world-space menu panel, with exhibit
  tabs and one button per nation, stop and article. The Atlas relief diorama sits on a table below
  the panel. Records open in the panel. Back, Pause and Resume keep the exhibit and record.

This is the Brief E archive, upgraded with a 3D relief. It is a menu screen with a 3D backdrop, not
yet the directive's archive environment.

### Component classification

Status values: **complete** (meets its current scope and is verified), **partial**, **placeholder**
(stands in for a required directive feature), **broken** (its last verification failed or it
breaks an existing check) and **missing**.

| Area | Component | Path | Status | Evidence and notes |
| --- | --- | --- | --- | --- |
| Shared | Approved archive copy: 11 records, 3 exhibits, 4 labels, map metadata | `shared/chronicles/content.ts` | complete | Verbatim. Private verifier 283 passed, 0 failed. Exports are frozen. |
| Shared | Navigation helpers (hotspots, timeline stops, articles, map hit test) | `shared/chronicles/content.ts` | complete | Covered by `content.test.ts` (9 tests, including the guard) |
| Shared | Domain types | `shared/chronicles/types.ts` | partial | Record, exhibit, label and map only. No canon status, events, sources, perspectives, artifacts, discovery or scene state. |
| Shared | Content-status layer: canon status, "Working proposal" marker, one visibility switch with a test | — | missing | Specified in ARCHITECTURE §7 |
| Shared | New text modules (exhibit captions, the Debt of Blackmere example, piece battlefield roles, short accounts) | — | missing | None written and none approved |
| Shared | Hashed guarded-phrase test | `shared/chronicles/content.test.ts` | complete | In M0 it was extended to every module under `shared/chronicles`. A negative control in a scratch copy catches a phrase planted in a nested module. |
| Shared | Living Atlas relief: heightfield, landforms, views, camera limits, markers, ray hits, living details | `shared/chronicles/archive/relief.ts` (+ test) | complete | 15 tests. Deterministic and pure. Reusable as the core of the central monument. |
| Shared | Scene-state reducer used by both platforms | — | missing | Quest keeps its own exhibit and record state in `quest-state.ts`. Desktop keeps its state in React. |
| Shared | Future War Record interface | — | missing | Types only, in ARCHITECTURE §8 |
| Desktop | Home → Chronicles routing, Back, Q/E, return from Settings and Showcase | `main game/src/App.tsx` | complete (Brief E) | M0 capture: Back returns Home with the tile selected |
| Desktop | Pausing the menu loops while Chronicles is open | `main game/src/App.tsx` | partial | Atmosphere is forced to quality `low` (its WebGL context is destroyed and rebuilt on exit). The sorcerer is frozen through `reducedMotion`, but its canvas and context stay alive. |
| Desktop | Chronicles screen: tabs, record panel, labels, footer, keyboard, gamepad, mouse | `main game/src/Chronicles.tsx`, `.css` | partial | No loading indicator: the stage stays hidden until it is ready. Without WebGL it falls back to the flat painting. |
| Desktop | Interregnum and Laws presentation | `main game/src/Chronicles.tsx` | placeholder | 2D DOM panels stand in for the Annals mechanism and the Gambit exhibit |
| Desktop | Relief renderer: its own `WebGLRenderer`, sliced build, camera flights, orbit/zoom/pan limits, pointer, gamepad, labels, disposal | `main game/src/chronicles/scene/AtlasScene.ts` | complete (Brief E) | M0: 19 draw calls and 306k triangles at high, 19 and 227k at medium. Canvas released on exit. |
| Desktop | Table, lights and bronze frame | `main game/src/chronicles/scene/atlas-set.ts` | partial | The table is replaced by the archive plinth in M1 |
| Desktop | Living details (sea, mist, eclipse, embers, falls, rivers, dust) | `main game/src/chronicles/scene/atlas-details.ts` | complete | Reusable |
| Desktop | Relief markers | `main game/src/chronicles/scene/atlas-markers.ts` | complete | Reusable |
| Desktop | Map preload during boot | `main game/src/useBootLoading.ts` | complete | |
| Desktop | Chronicles verification suite | `main game/scripts/verify-chronicles.mjs` | broken | Last run (15:48) failed at 1280×720: "another ring is in view beside the open record". It also recorded a 4.3 s long task on open. |
| Desktop | Home artwork hash manifests | `main game/artifacts/home-artwork.json`, `visual-review.json` | broken | `deliveryPath` points at the cleaned map, but `deliveryBytes` and `deliverySha256` still describe the original painting (615 504 B, `2b9efe06…`). The delivered file is 537 628 B, `d9f143ad…`, so the hash assertion in `verify-home.mjs` would fail. Not run in M0. |
| Quest | Chronicles state: screen, exhibit, record, map hit, Back, pause and resume | `main-game-vr/src/quest-state.ts` (+ tests) | complete (Brief E) | 7 Chronicles tests and 1 adjusted Home test |
| Quest | Generated `View_Chronicles` (tabs, nation/stop/article buttons, record panel) | `scripts/generate-quest-ui.ts` → `public/ui/menu.uikitml` | complete (Brief E) | 299 elements, in sync. 2D panel layout. |
| Quest | Runtime wiring: diorama lifecycle, atmosphere hold, hidden sorcerer, browser-preview framing, selected-control reporting | `main-game-vr/src/crownfall-system.ts` | complete (Brief E) | |
| Quest | Atlas diorama: sliced build, baked vertex light, unlit materials, Ray and Poke markers, posture placement | `main-game-vr/src/chronicles/scene/atlas-diorama.ts` | complete (Brief E) | Brief E capture: 19 draw calls and 50.9k triangles in the browser preview. Reusable as the Quest monument. |
| Quest | Contract ids, layout and `questText` | `main-game-vr/src/ui-contract.ts` | complete | |
| Quest | Map texture in the manifest | `main-game-vr/src/assets.ts` | complete | |
| Quest | Capture script | `main-game-vr/scripts/capture-chronicles.mjs` | broken | Last run (16:07) failed "Bare ground at the map centre takes the pointer and selects nothing". No immersive (XR) capture or hand-input evidence was recorded. |
| Quest | Hands-first immersive interaction | — | unverified | No XR evidence and no physical headset test |
| Sync | Chronicles parity in `check:sync` | `scripts/check-chronicles-sync.ts`, hooked from `scripts/check-menu-sync.ts` | complete | Moved in M0 out of the shared check. Negative controls fail as expected. |
| Assets | Map (central tower removed, working choice), mirrored to Quest | `main game/public/assets/chronicles/chronicles-map.webp` | complete | Byte-identical on Quest. Provenance is recorded only here (§2) until the M1 manifest exists. |
| Collections | Archive environment: architecture, lighting, atmosphere, annotated blueprint | — | missing | M1 |
| Collections | Living Atlas | relief + markers | partial | The relief and per-nation emphasis exist. Missing: the architectural and cultural identity reveal, environmental vignettes and the political-structure presentation. |
| Collections | Annals mechanism | — | placeholder | 2D timeline |
| Collections | Laws of the Gambit exhibit: ceremonial formation and piece inspection | — | placeholder | 2D articles |
| Collections | Contested Record: perspectives, sources, provenance, evidence classes | — | missing | |
| Collections | Occlusion reveal for focused exhibits | — | missing | Needed once architecture can stand between the camera and an exhibit |

## 2. Reusable components

| Component | Reuse in the archive |
| --- | --- |
| `shared/chronicles/content.ts` | The approved layer of the registry, unchanged |
| `shared/chronicles/archive/relief.ts` | The heightfield, ray hits, markers, views and living details of the central Living Atlas monument on both platforms |
| `scene/AtlasScene.ts` | Its camera rig, picking, sliced build and texture path become the Atlas focus mode and monument module of the single desktop archive renderer |
| `scene/atlas-details.ts`, `scene/atlas-markers.ts` | Kept as monument modules |
| `scene/atlas-set.ts` | Its lighting values seed the archive's key light. The table is retired. |
| `scene/atlas-diorama.ts` | Becomes the Quest monument: same build, baking and markers, scaled to the archive station |
| `quest-state.ts` Chronicles events and tests | Migrate into the shared scene-state reducer (ARCHITECTURE §4.7) |
| `generate-quest-ui.ts` Chronicles view and `ui-contract.ts` ids | The control surface for Quest collections. `View_Chronicles` keeps its id. |
| `check-chronicles-sync.ts` | Extended with every new collection |
| Verification scripts | Their harnesses (instrumented page, controller mock, long-task capture, runtime CLI driver) are reused once they write to milestone folders |
| Map asset, `sync-menu-assets.mjs` directory sync | Any file added under `main game/public/assets/chronicles/` mirrors to Quest and is hash-checked |

Map provenance: supplied creator painting, 2048 × 1529, first delivered as
`main game/public/assets/home/chronicles.webp` (`2b9efe06…`). The orchestrator removed the central
tower by inpainting (creator decision, 29 October; working choice) and delivered
`chronicles-map.webp` (`d9f143ad…`). Agents never redraw or edit it.

## 3. Outstanding problems

| # | Severity | Problem | Owner | Next action |
| --- | --- | --- | --- | --- |
| 1 | Major | No archive environment. Chronicles is still a menu screen. | B, C, D | M1 |
| 2 | Major | Long main-thread tasks. M0 on this loaded software-rendered host: opening the Atlas at high produced a 12.1 s task; the record and exhibit interactions afterwards (open, close, tab switches) produced 396 ms and 585 ms; medium produced 5.7 s and 5.6 s while building. No loading indicator is shown meanwhile. The budget allows no long task over 50 ms once the archive is interactive. | C, B | Compile shaders and upload textures behind a visible loading state (no parallel compile under SwiftShader); profile the tab switch (React re-render, panel compositing); measure again |
| 3 | Major | The menu loops are rested through quality and motion overrides instead of being paused: Atmosphere's renderer is rebuilt on every exit and the sorcerer's context stays alive | C | Adopt the `suspended` prop exactly as `feat/my-legacy` implements it in `Atmosphere.tsx` and `CreatureStage.tsx`, once the orchestrator approves touching those files (they are not on the Chronicles shared-file list); otherwise wait for the Legacy merge |
| 4 | Major | Desktop `verify-chronicles.mjs` fails one framing assertion. The Quest capture fails the bare-ground hover check. No immersive XR evidence exists. | C, D | Decide whether other rings may stay visible behind the record panel; diagnose the ground proxy; record hand-ray and pinch evidence in an XR session |
| 5 | Major | No content-status layer, visibility switch or "Working proposal" marker | E | M1, before any proposal text ships |
| 6 | Minor | Stale delivery hashes in `home-artwork.json` and `visual-review.json` | C | Update them to the delivered map and prove it with a `verify-home.mjs` run |
| 7 | Minor | The verification scripts write to `artifacts/chronicles/` instead of milestone folders | C, D | Add a milestone argument |
| 8 | Minor | Quest shows typographic dashes as hyphens (UIKit's ASCII glyph atlas) | D | A documented platform adaptation; ask the creator to confirm |
| 9 | Minor | `main game/README.md` still says every Home tile opens an unavailable dialog | C | M6, coordinated with the Legacy README edits |
| 10 | Process | Orphaned Chronicles processes from earlier sessions are still running: an IWSDK runtime for a scratch workspace symlinked to this checkout (port 8089, its managed Chromium using about one CPU) and a desktop vite on port 5191. M0 could not stop them, because the permission system refuses to stop processes this agent did not start. | Orchestrator | Stop them. Until then, do not start a second IWSDK runtime for this checkout. |
| 11 | Info | The Brief E desktop captures (`main game/artifacts/chronicles/brief-e/`) predate the cleaned map and show the central tower. The Quest Brief E captures show the current map. | — | — |
| 12 | Info | Bundle sizes: the desktop main chunk is 1.03 MB (the relief is a lazy 48 kB chunk); the Quest main chunk is 2.5 MB | C, D | Keep all archive code in lazy chunks |

## 4. Current branch and commit

- Checkout: worktree `/home/user/crownfall-chronicles`, branch `feat/chronicles-archive` (renamed
  from `feat/chronicles`).
- Base: `feat/main-game-menu` at `29343c1`, the head of draft PR #1 (open, into `main`).
- Checkpoint: "chore(chronicles): resume Chronicles archive workflow with audit and architecture".
  This is the first commit on the branch, and it contains all earlier Brief E and Atlas work. Its SHA
  is in the workflow result and goes into this section at the next update. It is pushed to
  `origin/feat/chronicles-archive`.
- Remote branches seen in M0: `main` `6bc3a58`, `feat/main-game-menu` `29343c1`, `feat/my-legacy`
  `84ffcfc`, `feat/legacy-world-environment` `d568976`, and four `codex/*` branches. PR #1 is the
  only pull request.
- Other worktrees: `/home/user/crownfall` (`feat/my-legacy`, large uncommitted work in progress) and
  `/home/user/crownfall-env` (`feat/legacy-world-environment`, uncommitted work in progress). Read
  them only.

## 5. Proposed next increment — M1, Archive Environment (P0)

Goal: Home → Chronicles enters a real 3D archive on desktop and in the Quest emulator, with a strong
first impression and the existing relief as the central monument. One full visual-critic round
follows before M2.

| Role | Tasks |
| --- | --- |
| B, environment | (1) An annotated spatial blueprint as data in `shared/chronicles/archive/blueprint.ts`, with dimensions, exhibit positions, desktop framings, the Quest station, light sources, interaction zones, navigation paths and expansion points, and a generated plan render. Draft `docs/chronicles/BLUEPRINT.md` for architect acceptance. (2) An archive geometry kernel (profiles, bevels, mouldings, arches, columns, vault ribs) in `shared/chronicles/archive/kernel/`, deterministic and ES2020-pure, with tests and budgets. (3) Material descriptors and texture generators run from committed scripts, plus a provenance manifest. (4) A desktop archive renderer with one `WebGLRenderer` and the relief as monument. (5) A Quest archive room: baked vertex light, instancing, quality presets, monument at the station. (6) Renders for Critic 1. |
| C, desktop | Mount the archive in `Chronicles.tsx`: entrance transition, visible loading progress, error recovery, authored framings, mouse/keyboard/gamepad. Full-stage layer with the main navigation inert. Pause the menu loops properly (problem 3). Fix problems 2, 4 (desktop half), 6 and 7. M1 captures and measurements. |
| D, Quest | Enter the archive in the emulator with the menu panel as the control surface. Stationary viewer, recenter and pause. Fix the bare-ground check. XR captures driven by hand ray and pinch. Render stats and a check that `update()` does not allocate. |
| E, content | `CanonStatus`, the registry entry for approved records, the one visibility switch with its test, and the marker string. No new prose in M1. |
| A, architect | Review the blueprint before construction, run the critic round and update this file |

M1 exit criteria: both builds, `test:quest`, `check:sync` and the private verifier pass. Home →
Chronicles renders the archive on both platforms, with captures in the `m1/` folders. Budgets are
measured: desktop medium ≤ 250 draw calls and ≤ 1.0M triangles; Quest ≤ 120 draw calls, ≤ 250k
triangles and ≤ 64 MB of textures; no long task over 50 ms once interactive. No unresolved Blocker or
Major critic finding remains.

## 6. Dependencies on other workflows

| Workflow | Dependency |
| --- | --- |
| My Legacy gameplay (`feat/my-legacy`, `/home/user/crownfall`) | Overlapping shared files (§ register), the menu-loop `suspended` props, the War Record data shape (its finalised match record) for the M5 adapter, the merge order and the README edits. Chronicles never imports unmerged Legacy modules. |
| Bannerhold environment (`feat/legacy-world-environment`) | No code dependency. Ideas reused, never imported: the pure geometry kernel pattern and the occlusion reveal technique. Shares the machine (ports, CPU, the one-runtime rule). |
| Chess in VR (Brief A) | No edits to `web/`, the chess core, the Play screens or `main-game-vr/src/chess/`. The Laws exhibit never duplicates the move engine. An authored Battle Record may be validated read-only against the game's rules engine in a test. |
| Menu (`feat/main-game-menu`, PR #1) | Base branch. A change there means rebasing this branch. |
| Creator | Approval of every proposal text, the rows held for review, nation geography (no borders or capitals), the status of Muster rules, the dash adaptation on Quest, and physical Quest validation |
| Orchestrator | Stopping the orphaned processes (problem 10), approval to touch `Atmosphere.tsx` and `CreatureStage.tsx`, merge authorisation |

## 7. Last successful verification

Final M0 run on 29 October 2026, 16:43–16:45 UTC, from `/home/user/crownfall-chronicles`, after the M0 reorganisation and with these documents in place:

| Command | Result |
| --- | --- |
| `npm run build` | pass (exit 0). Desktop `tsc -b` + vite and Quest `tsc --noEmit` + vite. Quest UI regenerated with 299 elements. |
| `npm run test:quest` | pass: 40 tests, 0 failures |
| `npm run check:sync` | pass: "Chronicles: 24 Quest UI ids, the Home tile and the shared Atlas map"; 21 byte-identical assets, 31 UI resources |
| Private content verifier (`cd main-game-vr && npx tsx <verify-content.ts> /home/user/crownfall-chronicles`) | pass: 315 passed, 0 failed. It scans more files now that the documents exist. Before M0 it was 282 passed, 1 failed, because of one comment in `verify-chronicles.mjs`, fixed in M0. |
| M0 desktop baseline, 16:23–16:28 UTC (production build on vite preview, port 5192, stopped afterwards; Playwright with SwiftShader; host load about 17–20) | Home → Chronicles works; the record opens; both exhibit tabs switch; Back returns Home with the tile selected; the relief canvas is released on exit; no page errors. Captures and numbers in `main game/artifacts/chronicles/m0/`. |

Quest evidence is the Brief E browser-preview capture set (`main-game-vr/artifacts/chronicles/brief-e/`,
16:04–16:07, current map). No Quest runtime was started in M0 because of problem 10. Nothing here is
physical-headset evidence.

## Milestones

| Milestone | Scope | Status | Evidence |
| --- | --- | --- | --- |
| M0 | Resume and architecture audit | complete | This file, `ARCHITECTURE.md`, M0 captures, checkpoint commit |
| M1 | Archive environment and central monument, rendering on desktop and Quest, visual-critic round | not started | — |
| M2 | Living Atlas: four nations, interactive selection, vignettes | partial | Relief, rings, nation framings and records exist on both platforms. Vignettes and the identity reveal are missing. |
| M3 | Annals: timeline mechanism and the foundational anchors | placeholder | Approved records for Year 0, Years 1–12, Year 19 and Year 33, shown in a 2D timeline |
| M4 | Laws of the Gambit | placeholder | Three approved articles in 2D. No formation and no piece inspection. |
| M5 | Contested Record, authored example first | not started | — |
| M6 | Full integration on both platforms | partial | Home → Chronicles is routed on both platforms; it opens the Brief E screen |
| M7 | Visual polish and release verification | not started | — |

## Shared-file change register

The changes are relative to `29343c1`. "Legacy conflict" is a read-only trial merge (`git merge-tree`)
of this work against committed `feat/my-legacy` (`84ffcfc`), plus inspection of its uncommitted
worktree. A trial against `feat/legacy-world-environment` conflicts only in the two `shared/menu`
files.

| File | Chronicles change | Legacy conflict | Resolution at merge |
| --- | --- | --- | --- |
| `shared/menu/types.ts` | `MenuScreen` gains `"chronicles"`; `HomeTileContent.destination?: "chronicles"` | **conflict** (Legacy adds `destination?: "legacy"` on the same line) | `destination?: "legacy" \| "chronicles"` |
| `shared/menu/content.ts` | Imports `CHRONICLES_MAP`; the Chronicles tile uses the map and `destination: "chronicles"`; `getModalContent` returns no unavailable text for tiles with a destination; comment updated | **conflict** in the comment only | Keep both destinations; merge the comment |
| `main-game-vr/package.json` (`test` script) | Adds the Chronicles content and relief tests | **conflict** (Legacy adds its tests on the same line) | Union of both test lists |
| `main game/src/App.tsx` | `chronicles` screen routing: ref, origins, activate, Back, focus, keyboard and gamepad moves, footer, and the `stageResting` overrides for Atmosphere and the sorcerer | Legacy's uncommitted worktree edits the same hunks | Union. Replace `stageResting` with Legacy's `menuSuspended`, set for `legacy` or `chronicles`. |
| `main-game-vr/src/quest-state.ts` | `chronicles` screen, `exhibit` and `record`, and the `exhibit`, `record`, `map` and `close-record` events; Home destination routing; Back | Legacy's uncommitted worktree adds a `legacy` route in the same places | Union. In M1 the Chronicles fields move into the shared scene state. |
| `main-game-vr/src/quest-state.test.ts` | Chronicles tests; the Home test no longer expects a Chronicles dialog | Legacy edits the same Home test | Union |
| `main-game-vr/src/crownfall-system.ts` | Diorama lifecycle, Chronicles rendering, atmosphere hold, hidden sorcerer, preview framing, `questText` | Legacy's uncommitted worktree changes the same update loop | Union: hold the atmosphere when paused, in Chronicles or in Legacy |
| `main-game-vr/src/assets.ts` | Map texture entry | Legacy adds entries nearby | Union |
| `main-game-vr/src/ui-contract.ts` | `View_Chronicles`, record text ids, `questText`, `QUEST_CHRONICLE_*` | none (Legacy uses its own contract file) | — |
| `main-game-vr/public/ui/menu.uikitml` | Regenerated with `View_Chronicles` | regenerate | Never hand-merge; rerun `npm run generate` after merging |
| `scripts/generate-quest-ui.ts` | Generates `View_Chronicles`; imports `questText` | none (Legacy has its own generator) | — |
| `scripts/generate-quest-decoration.mjs` | Shared modules may require one another | none | — |
| `scripts/check-menu-sync.ts` | M0 reduced it to an import and one call to `checkChroniclesSync` (it was a 120-line restructure) | auto-merges with committed Legacy; Legacy's worktree appends an optional check at the end | Keep both hooks |
| `scripts/sync-menu-assets.mjs` | Home asset list drops `chronicles`; adds the `assets/chronicles` directory | none | — |
| `main game/src/useBootLoading.ts` | Preloads `chronicles-map.webp` | none | — |
| `main game/scripts/verify-loading.mjs` | Expects the map path | none | — |
| `main game/artifacts/home-artwork.json`, `visual-review.json` | `deliveryPath` moved to the map (hashes still stale, problem 6) | none | — |
| `main game/public/assets/home/chronicles.webp` | Deleted (moved to `assets/chronicles/chronicles-map.webp`) | none | — |

Not changed by Chronicles: `main game/src/main.tsx`, `main-game-vr/src/index.ts`,
`main-game-vr/vite.config.ts`, the IWSDK scene JSON, the root `package.json`, `Atmosphere.tsx` and
`CreatureStage.tsx`.
