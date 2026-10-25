# Crownfall main game menu

A separate React + TypeScript + Vite app for the supplied menu references, with a three-tile Home screen and four-card Play screen. Run from this folder:

```sh
npm ci
npm run dev
```

Open `http://localhost:5173`. `npm run build` checks TypeScript and produces `dist/`. `npm run preview` serves that build.

The layout targets desktop and landscape phones. The creature sits behind the menu as requested. Play offers CLASSIC, LOCAL DUEL, CHAPTERS and ONLINE DUEL in the supplied artwork order. Each card opens a matching mode preview, with integration limits stated inside the dialog. No gameplay or matchmaking launches here, and the former demo-save creation/resume UI is removed; existing browser data is left untouched. Home, Play, Showcase and Settings form the top navigation. Showcase opens a mode-preview state; Home/Play context and selection are preserved. Arrow keys select Play cards and wrap; Home/End chooses the first/last card. Enter activates, Escape goes back, and Q/E switches sections. Settings persist on this browser. Low quality disables shader particles; ambient motion and OS reduced motion stop animation.

## Home screen

Home uses one 298 × 434 tile on the left and two 298 × 215 tiles stacked on the right, with four-pixel gaps, at 1280 × 720. The full grid is 600 × 434 pixels. My Legacy is the tall tile, Chronicles is upper right, and Herald Board is lower right. The supplied king and portal images use centered cover crops; Chronicles contains the complete four-region map, retaining its context. Only the exact supplied titles appear on the tiles. There are no invented descriptions, statistics, story entries or news feeds.

Each tile opens a clear unavailable-state dialog. The menu does not implement legacy profiles, chronicles or a herald feed. Home selection and the last right-hand row are remembered across navigation. Left/right moves between columns; up/down moves between the stacked tiles. Home/End selects the first/last tile. Keyboard, pointer and controller selection keep focus aligned. Settings returns to its originating screen. Back from Home returns to Play; Back from Play retains the Home confirmation.

`src/home-content.ts` configures the three content slots, image fit and supported actions. The original JPEGs are preserved byte-for-byte outside Git under `/workspace/crownfall-home-originals/`. Separate full-resolution WebP delivery copies are in `public/assets/home/`; mapping, hashes and display fits are in `artifacts/home-artwork.json`. The private Page and reference image remain unchanged and outside the repository.

## Environment artwork

The four cards use the user's supplied JPEGs in attachment order. The originals were retrieved from the private ChatGPT Page through authorized file reads, materialized under `/workspace/crownfall-card-originals/`, and verified against the supplied byte counts and source SHA-256 values before conversion. Originals are preserved outside the Git checkout; only separate optimized WebP delivery copies are used by the app. The private Page and its sharing settings are unchanged.

| Card | Supplied original | Crop focus |
| --- | --- | --- |
| Classic | `288933.jpg` | Ferris wheel and luminous ruined landscape |
| Local Duel | `288939.jpg` | Blue gateway and floating architecture |
| Chapters | `288943.jpg` | Timber bridges and distant arches |
| Online Duel | `289365.jpg` | Crystal cliffs, dragons, and towers |

All four source images are 2048 × 1143. Delivery copies retain those dimensions and are stored at `public/assets/environments/card-{new,resume,load,browse}.webp`. The images are cropped by CSS to their focal points; no regenerated artwork is substituted. `artifacts/card-artwork.json` records the mapping, source/delivery checksums and focal positions. Library identifiers and the private Page references remain in the executor-local originals' provenance file rather than the public repository.

All four cards (CLASSIC / LOCAL DUEL / CHAPTERS / ONLINE DUEL) are visible together in one fixed row. Original card dimensions are restored to 197 × 298 pixels at 1280 × 720, with four-pixel gaps and an 800-pixel row. Titles and supporting text remain live HTML above the image layer. Headings use self-hosted Barlow at weight 600: about 18.67px at 1280px, 14px at 960px, with an 11px landscape floor. Selected titles share the amber border accent; inactive titles use muted gray. The typography reference was inspected from the supplied image and preserved outside Git. Cards identify intended chess modes; activation dialogs disclose that this standalone menu is not connected to gameplay or online services. Exact UI copy and typography evidence are in `artifacts/menu-copy.json` and `artifacts/card-typography.json`. The row has no carousel controls, scroll snapping, drag or wheel handlers. Keyboard and controller navigation move focus between the four cards without scrolling.

## Creature asset

The default creature is the actual user-supplied **`Crownfall_Sorcerer_Digits_v3_1(1).glb`**, delivered as `public/models/crownfall-sorcerer.glb`. Its PBR material retains the supplied aged-gold and emerald textures. The menu selects the named **Idle** clip; Attack and Threat_Cast are retained in the file but do not play in the menu. The creature renders behind the cards with warm directional lighting and a teal rim. Its final presentation is another 5% larger than the approved tilted pose (9.2% above the original size), with the same 7.45° turn toward the cards and 2.58° left lean. The whole rig, including all four arms, follows this parent transform; the bone animation is unchanged. The model-center offset keeps the crown inside the frame. A final +0.055-world-unit parent lift exposes more of the face above the cards; the existing ±0.012 idle sway adds to that anchor. Matched direction captures are in `artifacts/creature-direction/`; the size comparison is in `artifacts/creature-size/`. The final upward adjustment, sampled Idle bounds and calibration captures are in `artifacts/creature-height/`.

The supplied 19,382,272-byte file was optimized to 4,217,336 bytes using 2048px WebP textures and Draco geometry compression. All 80,910 triangles, 142 joints and three clips are preserved; no simplification or animation resampling was applied. The original upload is not overwritten. Required Draco decoders are self hosted in `public/decoders/draco/`, so this model needs no external decoder service.

`src/effects/creature-config.ts` controls the default model URL. `?model=/models/alternate.glb` previews another asset and `?model=none` previews the illustration fallback. Framing and lighting are in `src/CreatureStage.tsx`. Switching motion preferences pauses or resumes the existing renderer without downloading or decoding the model again. OS reduced motion is honored. A temporary reference-derived illustration remains visible while the model loads, or if model loading or WebGL fails.

Fonts are self hosted Barlow under the included SIL Open Font License. The bundled Draco distribution includes its Apache license.

`src/Atmosphere.tsx` uses custom GLSL shaders for additive teal and gold particles, with CSS wisps and drifting feather SVGs. Effects clean up resources on unmount. Rive is not required for these effects.

## Browser verification

With the dev server running:

```sh
npm test
node scripts/verify-layout.mjs
node scripts/verify-home.mjs
node scripts/verify-copy.mjs
node scripts/verify-model.mjs
node scripts/verify-framing.mjs
```

Tests use Playwright and `/usr/bin/chromium`; set `CHROMIUM_PATH` for another Chromium installation and `CROWNFALL_TEST_URL` for another server. Current screenshots and verification results are saved in `artifacts/`. Copy checks cover 20 modal states at desktop and landscape sizes, including all four mode previews, without horizontal clipping. The visual critic reviews actual browser screenshots; scores are subjective and distinct from automated functionality checks. The current layout is the restored four-visible-card row. Files in `artifacts/carousel/` and archived visual reviews document the superseded carousel iteration; its recording predates the final creature transform. Software WebGL verification does not establish physical-device GPU performance.

`verify-framing.mjs` requires the Vite development server (`CROWNFALL_FRAMING_URL`, default `http://localhost:5173`). It intercepts the development module only inside its Playwright session to seek exact Idle poses and project actual skinned vertices. It writes no production debug hooks. The probe checks authored Idle key times and midpoints against independent ambient sway/yaw extremes, with geometric crown/face/eye proxies and calibration images. Dense sampled bounds are supporting evidence rather than a continuous mathematical guarantee or semantic face detection.
