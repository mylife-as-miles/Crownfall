# Crownfall main game menu

A separate React + TypeScript + Vite app for the supplied menu references, with the five-card row sized to the latest 1280 × 720 screenshot. Run from this folder:

```sh
npm ci
npm run dev
```

Open `http://localhost:5173`. `npm run build` checks TypeScript and produces `dist/`. `npm run preview` serves that build.

The layout targets desktop and landscape phones. The creature sits behind the cards as requested. Five cards (New, Resume, Load Game, Browse, Host), top navigation, keyboard and controller navigation, dialogs, settings, and device-local demo saves work. Arrow keys select cards; Enter activates; Escape goes back; Q/E switches sections. Host and Browse clearly show that online sessions are not available. The original chess game remains in `../web`; this new menu does not yet start that game. Settings persist on this browser. Low quality disables shader particles; ambient motion and the OS reduced motion preference stop animation.

## Environment artwork

All five cards now use separate original generated environment illustrations, inspired by the atmosphere, depth, and environmental themes in [Carla Devèze's portfolio](https://carleaf.artstation.com/). Her portfolio images were studied as references; they are not shipped as card textures.

| Card | Environment direction | Portfolio reference |
| --- | --- | --- |
| New | Mossy sanctuary, spring growth and misty waterfall | [Spring Meadows](https://carleaf.artstation.com/projects/bg3r2v) |
| Resume | Warm manor hall and grand stairway | [The Manor](https://carleaf.artstation.com/projects/vbQLJx) |
| Load Game | Dreamlike submerged garden and turquoise light | [Flying Waters](https://carleaf.artstation.com/projects/wrKlJO) |
| Browse | Sculpted basalt cliffs and a luminous coastal passage | [Stone Wave Cliffs](https://carleaf.artstation.com/projects/DLKBny) |
| Host | Floating fractured monument above a ceremonial valley | [The Monolith](https://carleaf.artstation.com/projects/zxoo46) |

Textures live in `public/assets/environments/` as five optimized portrait WebP files. The reference row spans about 1001 pixels: cards measure 197 × 298 pixels at 1280 × 720, with four-pixel gaps. This expands the original four-card row by 25% while matching the five-card screenshot. Labels and descriptions remain live HTML above the artwork.

## Creature asset

The current creature is **temporary transparent artwork derived from the user-supplied reference**, not a rendered GLB. Fonts are self hosted Barlow under the included SIL Open Font License.

When the character GLB is supplied:

1. Put it in `public/models/creature.glb`.
2. Set `CREATURE_MODEL_URL` to `'/models/creature.glb'` in `src/effects/creature-config.ts`, or preview it using `?model=/models/creature.glb`.
3. Tune framing, rotation, animation choice and lighting in `src/CreatureStage.tsx` for the actual model.

Three.js loads the model with a transparent background, gold and teal lighting, automatic bounds fitting, animation clips and subtle idle movement. The illustration remains visible if loading fails. Draco and KTX2 decoders use their configured CDN paths when compressed assets require them. Final pose and visual parity must be checked against the actual asset; the synthetic loader test cannot verify its appearance.

`src/Atmosphere.tsx` uses custom GLSL shaders for additive teal and gold particles, with CSS wisps and drifting feather SVGs. Effects clean up resources on unmount. Rive is not required for these effects.

## Browser verification

With the dev server running:

```sh
npm test
node scripts/verify-model.mjs
```

Tests use Playwright and `/usr/bin/chromium`; set `CHROMIUM_PATH` for another Chromium installation and `CROWNFALL_TEST_URL` for another server. Screenshots and verification results are saved in `artifacts/`. The visual critic evaluates actual browser screenshots against the reference; visual scores are subjective and distinct from automated functionality checks.
