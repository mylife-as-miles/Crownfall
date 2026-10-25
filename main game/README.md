# Crownfall main game menu

A separate React + TypeScript + Vite app for the supplied menu references, with a four-card row at 1280 × 720. Run from this folder:

```sh
npm ci
npm run dev
```

Open `http://localhost:5173`. `npm run build` checks TypeScript and produces `dist/`. `npm run preview` serves that build.

The layout targets desktop and landscape phones. The creature sits behind the cards as requested. Four cards (New, Resume, Load Game, Browse), top navigation, keyboard and controller navigation, dialogs, settings, and device-local demo saves work. Arrow keys select cards; Enter activates; Escape goes back; Q/E switches sections. Browse clearly shows that online sessions are not available. The original chess game remains in `../web`; this new menu does not yet start that game. Settings persist on this browser. Low quality disables shader particles; ambient motion and the OS reduced motion preference stop animation.

## Environment artwork

The four cards use the user's supplied JPEGs in attachment order. The originals were retrieved from the private ChatGPT Page through authorized file reads, materialized under `/workspace/crownfall-card-originals/`, and verified against the supplied byte counts and source SHA-256 values before conversion. Originals are preserved outside the Git checkout; only separate optimized WebP delivery copies are used by the app. The private Page and its sharing settings are unchanged.

| Card | Supplied original | Crop focus |
| --- | --- | --- |
| New | `288933.jpg` | Ferris wheel and luminous ruined landscape |
| Resume | `288939.jpg` | Blue gateway and floating architecture |
| Load Game | `288943.jpg` | Timber bridges and distant arches |
| Browse | `289365.jpg` | Crystal cliffs, dragons, and towers |

All four source images are 2048 × 1143. Delivery copies retain those dimensions and are stored at `public/assets/environments/card-{new,resume,load,browse}.webp`. The images are cropped by CSS to their focal points; no regenerated artwork is substituted. `artifacts/card-artwork.json` records the mapping, source/delivery checksums and focal positions. Library identifiers and the private Page references remain in the executor-local originals' provenance file rather than the public repository.

The enlarged row contains exactly four cards and spans 1003 pixels: cards measure 247 × 373 pixels at 1280 × 720, with five-pixel gaps. This is about 25% larger in each dimension than the previous 197 × 298 cards. Titles, supporting text and spacing are enlarged while remaining live HTML above the image layer.

## Creature asset

The default creature is the actual user-supplied **`Crownfall_Sorcerer_Digits_v3_1(1).glb`**, delivered as `public/models/crownfall-sorcerer.glb`. Its PBR material retains the supplied aged-gold and emerald textures. The menu selects the named **Idle** clip; Attack and Threat_Cast are retained in the file but do not play in the menu. The creature renders behind the cards with warm directional lighting, a teal rim, and a slightly angled camera-facing pose.

The supplied 19,382,272-byte file was optimized to 4,217,336 bytes using 2048px WebP textures and Draco geometry compression. All 80,910 triangles, 142 joints and three clips are preserved; no simplification or animation resampling was applied. The original upload is not overwritten. Required Draco decoders are self hosted in `public/decoders/draco/`, so this model needs no external decoder service.

`src/effects/creature-config.ts` controls the default model URL. `?model=/models/alternate.glb` previews another asset and `?model=none` previews the illustration fallback. Framing and lighting are in `src/CreatureStage.tsx`. Switching motion preferences pauses or resumes the existing renderer without downloading or decoding the model again. OS reduced motion is honored. A temporary reference-derived illustration remains visible while the model loads, or if model loading or WebGL fails.

Fonts are self hosted Barlow under the included SIL Open Font License. The bundled Draco distribution includes its Apache license.

`src/Atmosphere.tsx` uses custom GLSL shaders for additive teal and gold particles, with CSS wisps and drifting feather SVGs. Effects clean up resources on unmount. Rive is not required for these effects.

## Browser verification

With the dev server running:

```sh
npm test
node scripts/verify-model.mjs
```

Tests use Playwright and `/usr/bin/chromium`; set `CHROMIUM_PATH` for another Chromium installation and `CROWNFALL_TEST_URL` for another server. Screenshots and verification results are saved in `artifacts/`. The visual critic evaluates actual browser screenshots against the reference; visual scores are subjective and distinct from automated functionality checks.
