# King's Gambit — the app

This folder holds the game itself. For the project overview, features, architecture notes and
contribution guide, read the [root README](../README.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

A cinematic 3D chess game: sculpted medieval and Mesoamerican figures fighting on a
marble-and-basalt board. Built with Vite + React + TypeScript + three.js, with chess.js for
the rules and a Web Worker search engine for the computer opponent.

## Setup

```bash
bun install   # or npm install
bun run dev   # or npm run dev  → http://localhost:5173
bun run build # production bundle in dist/
bun run preview
```

## Controls

| Action | Input |
| --- | --- |
| Orbit / zoom | Drag, mouse wheel (pinch on touch) |
| Select a figure | Click it (legal squares glow green, captures red) |
| Move | Click a highlighted square (click the figure again to deselect) |
| Promotion | Pick one of the four rotating figures on pedestals |
| Camera & battleground | Camera icon in the top bar (presets, flip, tactical, the four arenas) |
| What a button does | Hover, focus or tap it — every icon carries a tooltip |
| Skip the intro | Click anywhere during the opening sweep |
| Settings | Gear icon (graphics preset, capture cinematics, board swing, sound) |

There is no drag-and-drop; both selecting and moving resolve on pointer release, and a press
that travels more than 8px counts as a camera swing instead.

| Key | Action |
| --- | --- |
| `F` | Flip the camera to the other side |
| `T` | Toggle the 2D tactical view |
| `H` | Open / fold the chronicle |
| `C` | Cinema mode — hide the whole overlay |
| `Space` | Pause / resume a showcase duel |
| `Esc` | Close the settings panel, camera menu, chronicle or tooltip |

## Overlay

`GameShell.tsx` owns the phases (loading → menu → playing), the settings, attract mode and the
keyboard shortcuts; `Hud.tsx` is everything on screen during a game. The board keeps the
viewport: the turn slate and the icon rail sit in the top corners, the spoils panel is desktop-only,
the move record lives behind a corner sigil (`H`), and the showcase transport is a slim
bottom-right rail that folds down to a single icon.

`Tooltip.tsx` explains the icon-only controls — name, one sentence, and a key cap when there is a
shortcut. It opens after 110 ms, then instantly for the rest of a sweep along the rail, aligns to
whichever screen edge keeps it visible, flashes for 1.8 s on a touch press, and closes on Escape,
blur or scroll. It renders inside its anchor rather than a body portal so it survives fullscreen.

## Architecture

Rendering is fully decoupled from the rules: the chess core emits events and the scene
subscribes to them. Nothing in `src/core` imports three.js.

```
src/
  core/            chess state, no rendering
    gameController.ts  owns chess.js, clocks, undo, AI turns, snapshots
    types.ts           shared game types (MoveEvent, GameSnapshot, …)
    emitter.ts         tiny typed event emitter
  ai/
    engine.worker.ts   negamax + alpha-beta + quiescence + iterative deepening
    aiClient.ts        main-thread handle, cancels stale searches
  scene/             three.js only
    sceneEngine.ts     renderer, camera, interaction, marching, combat choreography
    environment.ts     hall, lighting, torches, particles, PMREM environment
    arena.ts           the four battleground looks
    battlefield.ts     siege props, camps, fires, birds
    jungle.ts          canopy, palms, vines, pollen for the Sun Temple
    board.ts           tiles, base, engraved labels, highlight pool
    pieces.ts          rigged GLB loading, skeletal clips, faction materials, mixers
    weapons.ts         procedural arms, shields and staves per rank
    rankBadges.ts      floating heraldic crests
    effects.ts         particle bursts, flashes, dissolve, camera shake
    strikes.ts         per-rank blow visuals (slash arc, ground wave, pillar)
    spells.ts          fireball orbs, per-army fire, the shared light pool
    postfx.ts          EffectComposer pipeline (bloom, SSAO, DOF, grade, SMAA, clarity)
    textures.ts        procedural marble, basalt, bronze, cloth
    quality.ts         graphics presets + auto-detection
    tween.ts           promise-based tween engine
  ui/                plain React + CSS overlay
    GameShell.tsx      phases, settings, attract mode, shortcuts
    Hud.tsx            top bar, spoils, chronicle sigil, showcase rail
    Tooltip.tsx        themed tooltip for the icon-only controls
    MainMenu.tsx / MoveLedger.tsx / SettingsPanel.tsx / GameOverModal.tsx / Heraldry.tsx
    medieval.css       the whole overlay's look
  audio/             Web Audio mixer with layered score stems
  assets/generated.ts  URLs of the generated models and audio
```

### Move flow

1. The player (or the worker) produces a move → `GameController.tryMove`.
2. chess.js validates it and the controller builds a `MoveEvent` (captures, castling
   rook trip, en passant square, promotion, check flags).
3. The controller awaits the animator the scene registered, so the AI never moves while
   a figure is still gliding.
4. React re-renders from the immutable snapshot published after every change.

### The computer opponent

- **Easy** — random legal move, prefers captures, always takes a mate in one.
- **Medium** — depth 3 negamax with alpha-beta, material + piece-square tables, 0.7s budget.
- **Hard** — depth 5 iterative deepening with alpha-beta, MVV-LVA ordering and quiescence
  on captures, 3.2s budget.

All searches run in `engine.worker.ts`, so the render loop never blocks.

## Graphics presets

| Preset | Post-processing | Shadows | Particles |
| --- | --- | --- | --- |
| Low | none (direct render) | off | none |
| Medium | bloom, grade, SMAA | 1024 | light |
| High | + depth of field in cinematics | 2048 | full |
| Ultra | + SSAO | 4096 | dense |

The preset is auto-detected on first load from the GPU string, core count and memory, and
the engine steps down once automatically if the measured frame rate stays under 40 FPS.
Pixel ratio is capped at 2 (1 on Low), and WebGL context loss shows a reload prompt.

### Black-screen recovery

Drivers that render an all-black scene under a working interface (Mesa's software rasterisers on
Linux above all) are handled in three places:

- `scene/diagnostics.ts` — `probeGpu` names the driver, `reflectionProbeWorks` renders a white
  sphere lit only by the freshly built PMREM probe into an 8×8 buffer and reads it back. Black or
  `NaN` means the probe is unusable, so `SceneEngine.applyEnvironment` drops it and turns up an
  ambient skylight of the same colour instead.
- `SceneEngine.guardAgainstBlackFrames` — samples the frame at five points (centre plus quadrants)
  five times over the first eight seconds. All five points must read black before anything is
  dropped; each failed sample peels off one more layer: composer → reflection probe → safe mode.
- **Settings → Picture** — a brightness slider (exposure ×0.6–1.8) and a `Safe rendering` toggle
  (`SceneEngine.setSafeMode`: no composer, no probe, no shadow maps, +20% exposure). Both are
  persisted in `localStorage` under `kg.render`, and `?safe=1` forces safe rendering from boot.

A showcase duel adds a **clarity grade** on top of the preset (`Postfx.setClarity`): no depth of
field, grain ×0.3, vignette ×0.5 and bloom ×0.62 at a higher threshold, because a duel that is
watched rather than played needs the sculpts and the squares to read.

## Character animation

Every figure is a rigged (skinned) character with up to five skeletal clips, listed per kind in
`PIECE_ANIMATED_MODELS` (`src/assets/generated.ts`):

| Clip | When it plays |
| --- | --- |
| `idle` | Looping combat stance, desynced per figure so the army does not breathe in lockstep |
| `walk` | Looping in-place stride, retimed to the cadence of the move under way |
| `run` | Looping in-place run — the knight charging through its leap (knights only) |
| `attack` | One-shot strike the moment the attacker lands a capture (sparks, shake and clash sound are timed to the hit frame). For the queen and the mage the same clip is the incantation, and its hit frame releases the fire |
| `death` | One-shot fall played by the captured figure before it dissolves into dust |

How it is wired (`src/scene/pieces.ts`):

- The **rigged** GLB is the visual — the plain GLB has no skeleton, so clips bound to it do
  nothing. Each animation GLB contributes one clip, renamed to `idle` / `walk` / `run` /
  `attack` / `death`.
- Every instance is cloned with `SkeletonUtils.clone` (never `Object3D.clone`) and gets its
  own `AnimationMixer`; one-shots use `LoopOnce` + `clampWhenFinished`, and the strike
  crossfades back to the stance on the mixer's `finished` event.
- Clip root motion is stripped on X/Z so a figure never walks off its square; the death clip
  keeps its motion so the fall reads properly. Locomotion clips are **in-place** cycles — board
  travel belongs to the container tween, so a clip carrying root translation would double it.
- The **Low** preset freezes the stance on its first frame (no per-frame mixer cost); strikes,
  deaths and footstep sounds still play, and the figure slides instead of marching.
- **Clips load in waves.** Over seventy GLBs fired at once made the browser drop requests
  (`TypeError: Failed to fetch`), which cost figures their strike — a capture then looked like a
  piece dying untouched. The rig plus its `idle` load first, then `PieceFactory.warmClips()`
  fetches `attack` → `death` → `walk` → `run` two downloads wide and binds each clip onto the
  figures already on the board (`PieceView.installClip`). A capture also calls `ensureClip` for
  the attacker's strike and the victim's death, waiting up to 2.4 s rather than skipping the beat.
- With no strike clip at all, `SceneEngine.lunge()` swings by hand (wind-up, twist, lean back,
  blow over the top); the tilt is held by `PieceView.setStrikeTilt()` so the mixer cannot wipe it.

### Marching and footsteps

`SceneEngine.glide()` runs one stride clock per move. `GAITS[kind]` declares steps per square,
cadence, boot timbre and loudness, so `steps = tiles × stepsPerTile` and the duration is
`steps / cadence` — a longer move takes **more steps**, not a faster slide.
`PieceView.startMarch(clip, stepRate)` retimes the walk cycle so one gait cycle is exactly two
footfalls at that rate, `strideEasing()` gives a push-off, a cruise and a settle (a fully eased
curve would leave the feet skating), and every whole step fires `audio.footstep()` plus a grit
puff at the contact point. The four timbres (`scuff` / `leather` / `plate` / `regal`) are
synthesised in `src/audio/audioManager.ts` — body thump, band-passed sole transient, metallic
afterring — panned by screen position and pitch-jittered.

### Strike weight by rank

The hand-to-hand beat is one piece of choreography, but its weight comes from `STRIKES[kind]`
in `src/scene/sceneEngine.ts`. The pawn's line is the original beat and is unchanged; each rank
above it adds something: the knight a crescent of steel and a dust wake on the charge, the rook a
wave rolling across the stone with a low slam and a long aftershock, the king a column of light
dropped on the condemned, a bell, and a gold arc plus gold ground wave. Ranged captures follow
the same idea — `MAGE_SPELL` throws one bolt, `QUEEN_SPELL` gathers longer and throws a volley of
three that leaves fire burning on the square. Visuals live in `src/scene/strikes.ts`, and the
swing / slam / bell voices are synthesised in the mixer.

### Ranged captures

`RANGED_KINDS` routes the queen (`q`) and the mage (`b`) to `playSpellCinematic()`: both sides turn
to face each other, fire gathers at the staff crystal through the strike clip's wind-up, the bolt
flies to the target's chest and breaks open — and the victim **dies and is cleared away before the
caster takes a single step** onto the square.

The fire's light comes from `SpellLightPool` (`src/scene/spells.ts`): three point lights created
once with the scene and lent out per bolt. A light per fireball crashed the tab — three.js keys
its shader programs on the scene's light counts, so the whole hall recompiled mid-fight. Pooled
lights are never removed *or hidden* (an invisible light leaves the render state, which changes
the count just as removing it would); they are dimmed to zero and handed back, and a fourth
simultaneous bolt simply gets no light.

## Swapping in different character models

The static fallback sculpts are referenced by URL in `src/assets/generated.ts`:

```ts
export const PIECE_MODEL_URLS: Record<PieceKind, string> = {
  k: "…king.glb",
  q: "…queen.glb",
  /* … */
};
```

Drop higher-quality glTF/GLB characters into `public/models/` and point the entries at
`/models/your-king.glb`. Requirements:

- Y-up, facing +Z (or edit `PIECE_MODEL_ORIENTATION` in the same file — the loader derives
  the correction quaternion from the declared front/up axes).
- Any scale: `PieceFactory.normalize()` measures the model and rescales it to the height in
  `PIECE_HEIGHT` (`src/scene/pieces.ts`), then centres it on X/Z and grounds it on Y.
- Materials are cloned per instance and tinted per faction in `applyFactionLook()`.

If a rigged model fails to download the loader falls back to the static sculpt, and if that
fails too, to a procedural primitive figure — the game always stays playable.

To animate your own characters, add a `PIECE_ANIMATED_MODELS` entry with a rigged GLB plus a
GLB per clip; any missing clip is simply skipped, and a clip whose download failed is retried on
demand the next time the game needs it.

For shipping, compress the GLBs instead of streaming them from a remote host:

```bash
bunx @gltf-transform/cli optimize king.glb public/models/king.glb \
  --compress draco --texture-compress webp --texture-size 1024
```

## Audio

Generated MP3s are streamed once and decoded into Web Audio buffers: an ambience bed, a
score bed and a tension stem that crossfades in during check and the endgame, plus piece,
clash, horn and fanfare one-shots. UI blips are synthesised with oscillators. Everything
routes through one master gain for the mute toggle, and playback only starts after the
first user gesture (browser autoplay policy).
