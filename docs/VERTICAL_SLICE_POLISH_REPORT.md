# Crownfall Vertical Slice Polish Report

Date: 2026-08-04

Branch: `codex/crownfall-vertical-slice-polish`

Phase 1 baseline commit: `b853a6c feat: complete Crownfall campaign phase one`

## Approval outcome

The opening vertical slice is visually accepted. The independent critic initially rejected the slice for mobile density, a generic campaign hub, flat/dark battle scenery, and weak microcopy. After remediation, the critic re-reviewed all six menu viewports plus the campaign hub and battle and returned **ACCEPT**. Residual debt is listed below and is not hidden as completed work.

## What changed

### Menu composition and character presence

- Replaced the uncontrolled live-match background with an authored title tableau, fixed camera, dedicated lighting/material profile, and three intentional silhouettes.
- Suppressed menu-only rank badges, legal highlights, selection rings, battle UI, and attract-mode chess logic.
- Rebuilt the campaign panel as a clipped, riveted Chronicle artefact with a chapter spine, seal, difficulty emblems, selected/loading/locked/disabled states, and separate scrolling/actions.
- Added Cael as a persistent visual witness through a generated portrait, title-screen vignette, prologue scene, save dossier, hub dossier, consequence cards, and battle strip.
- Continue Campaign now reports mission, chapter progress, consequence rule, last witnessed time, important character, recent memory, and gambit state.

### Environment, materials, and lighting

- Added deterministic flagstone/marble texture detail, bump response, lower-gloss board trim, stronger grounding, and restrained title materials.
- Replaced the oversized repeating rock placeholder with three smaller procedural rubble silhouettes.
- Reduced the monolithic rear wall, added masonry courses and broken crenellations, and improved battle silhouette scale.
- Added separate title and gameplay light states, controlled bloom/grade, a campaign clarity pass, rim separation, and a modest battle-only exposure/lamp lift.

### Vertical-slice presentation

- Added keyed screen transitions, a shortened skippable intro, Cael-led prologue framing, objective-state feedback, a mission-resolution presentation handshake, restrained promotion scale/fade, and a persistent character battle strip.
- Added scene-aware audio crossfades and campaign cues while deferring noncritical tension and combat sounds.
- Rebuilt the War Table as an in-world routed map with named nodes, mission route, commander context, Cael's barracks dossier, and campaign progress.

### Responsive UX and accessibility

- Verified exact menu captures at 1920×1080, 1440×900, 1366×768, 1024×768, 390×844, and 360×800.
- Mobile uses a 2×2 difficulty grid. The chapter CTA is visible at 360×800; at 390×844 both the CTA and Settings are visible.
- Preserved 44 px minimum targets for primary controls and tightened only secondary copy.
- Added keyboard square exploration, Enter/Space activation, Escape cancellation, Q/R/B/N promotion shortcuts, semantic board announcements, dialog semantics, initial/restore focus, focus trapping, Escape dismissal, and pressed/switch states.
- Real-browser keyboard regression moved Cael from e5 to d6 and announced the selected square and piece state.

## Performance and bundle analysis

### Production JavaScript

| Metric | Phase 1 baseline | Polish build | Change |
|---|---:|---:|---:|
| Eager application chunk, minified | 1,440.63 kB | 329.22 kB | -77.1% |
| Eager application chunk, gzip | 422.73 kB | 103.75 kB | -75.5% |
| Deferred Three.js scene chunk, minified | bundled in entry | 961.95 kB | deferred |
| Deferred Three.js scene chunk, gzip | bundled in entry | 273.62 kB | deferred |
| Campaign UI chunk, gzip | bundled in entry | 6.18 kB | deferred |
| HUD chunk, gzip | bundled in entry | 7.83 kB | deferred |
| Settings chunk, gzip | bundled in entry | 2.25 kB | deferred |
| Game-over chunk, gzip | bundled in entry | 1.33 kB | deferred |

The 1.44 MB eager chunk is resolved through dynamic Three.js loading and lazy campaign/HUD/settings/game-over boundaries. The renderer is still a 961.95 kB deferred chunk and Vite correctly continues to warn that it exceeds 500 kB.

CSS grew from 100.01 kB / 19.91 kB gzip to 121.75 kB / 24.48 kB gzip because the responsive campaign presentation is now loaded eagerly with the title shell.

### Remaining loading bottleneck

The performance audit found that character startup still blocks on 24 rig-and-idle requests totaling about 15.39 MB. The title tableau needs only eight of those requests (about 4.43 MiB), so a staged preload boundary could defer roughly 69.8% of model transfer without reducing initial visual quality. R2 assets currently respond with `Cache-Control: no-cache`. Cael's WebP portrait is 151,984 bytes.

This model-preload/cache work is the primary remaining performance blocker; it was not disguised as solved by the JavaScript split.

## Audit summary

1. Environment art and materials: procedural geometry, bump response, wall/rubble silhouette, grounding, and repetition audited and remediated.
2. Menu composition and UI: dedicated tableau, safe areas, artefact panel, emblems, save states, and premium interaction states implemented.
3. Character presentation: Cael portrait and persistent identity surfaced from title through consequence.
4. Lighting and post-processing: separate title rig, campaign clarity, restrained bloom/vignette, and improved silhouette separation implemented.
5. Animation and cinematography: screen transitions, intro, promotion, capture/resolution timing, and reduced-motion behavior audited.
6. Audio: scene beds, crossfades, campaign cues, and guarded staged loading implemented.
7. Responsive UX and accessibility: six exact viewports plus keyboard, focus, dialog, semantic status, and target-size checks completed.
8. Performance: entry split, lazy boundaries, build metrics, model-transfer audit, and remaining cache/preload debt documented.
9. Independent visual criticism: initial rejection remediated; final verdict ACCEPT. See `docs/VISUAL_CRITIC_REPORT.md`.

## Verification

- TypeScript: passed (`tsc --noEmit -p tsconfig.app.json`)
- ESLint: passed with 0 errors and 8 pre-existing Fast Refresh warnings
- Unit tests: 16/16 passed across 5 files
- Browser tests: 1/1 passed
- Production build: passed; 1,802 modules transformed in 39.89 seconds
- `git diff --check`: passed
- Real-browser console: no Crownfall application errors; captured warnings originated from an installed browser extension
- Real-browser flow: menu → overwrite → prologue → hub → briefing → formation → gambit → battle → consequence → Mission II hub
- Motion evidence: MP4 decoded successfully during the primary QA pass and representative menu/flow/battle frames were visually inspected

## Evidence

- Baseline: `artifacts/phase-1/crownfall-menu-fixed-1440x900.jpg`
- Final menu: `artifacts/polish/menu-final-1920x1080.png`
- Final menu: `artifacts/polish/menu-final-1440x900.png`
- Final menu: `artifacts/polish/menu-final-1366x768.png`
- Final menu: `artifacts/polish/menu-final-1024x768.png`
- Final menu: `artifacts/polish/menu-final-390x844.png`
- Final menu: `artifacts/polish/menu-final-360x800.png`
- Final hub: `artifacts/polish/hub-final-1440x900.png`
- Final battle: `artifacts/polish/battle-final-1440x900.png`
- Prologue: `artifacts/polish/prologue-1440x900.png`
- Consequence: `artifacts/polish/consequence-1440x900.png`
- Recorded flow: `artifacts/polish/crownfall-menu-to-mission.mp4`

## Exact implementation files

- `web/src/App.tsx`
- `web/src/audio/audioManager.ts`
- `web/src/campaign/campaignController.ts`
- `web/src/campaign/menuSummary.ts`
- `web/src/campaign/menuSummary.test.ts`
- `web/src/pages/NotFound.tsx`
- `web/src/scene/board.ts`
- `web/src/scene/environment.ts`
- `web/src/scene/pieces.ts`
- `web/src/scene/postfx.ts`
- `web/src/scene/sceneEngine.ts`
- `web/src/scene/textures.ts`
- `web/src/ui/CampaignExperience.tsx`
- `web/src/ui/CharacterPortrait.tsx`
- `web/src/ui/DifficultyEmblem.tsx`
- `web/src/ui/GameShell.tsx`
- `web/src/ui/MainMenu.tsx`
- `web/src/ui/SettingsPanel.tsx`
- `web/src/ui/crownfall.css`
- `web/public/assets/portraits/cael.webp`

## Remaining blockers and debt

- Blocking for a future performance approval: stage character rig/idle preloads and correct immutable asset caching.
- Non-blocking visual debt: narrow-screen difficulty microcopy remains dense; the horizontal mode rail could use a clearer continuation arrow.
- Non-blocking visual debt: hub map labels are intentionally subtle and could be enlarged one step.
- Non-blocking visual debt: bright battle tiles still dominate the frame, and surrounding stone/loose-rock patterns retain procedural repetition.
- Non-blocking bundle debt: the deferred scene renderer remains 961.95 kB minified.
- Evidence caveat: the independent critic could not decode the MP4 in its environment, although the primary QA pass decoded it and inspected extracted frames.
