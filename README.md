# King's Gambit — Medieval 3D Chess

A cinematic 3D chess game in the browser. Two rival civilisations — a medieval European
**Ivory Kingdom** and a Mesoamerican **Sun Empire** — face each other as sculpted, rigged
characters that glide, strike, scream and burn away into dust on a marble-and-basalt board.

Built with **Vite + React 19 + TypeScript + three.js**, [chess.js](https://github.com/jhlywa/chess.js)
for the rules, and a **Web Worker** search engine for the computer opponent. No backend, no
account, no build-time asset pipeline — it is a static site.

```bash
cd web && bun install && bun run dev
```

---

## Table of contents

- [Features](#features)
- [Quick start](#quick-start)
- [Controls](#controls)
- [Interface](#interface)
- [Game modes](#game-modes)
- [Battlegrounds](#battlegrounds)
- [Project structure](#project-structure)
- [Architecture](#architecture)
- [The computer opponent](#the-computer-opponent)
- [Graphics presets](#graphics-presets)
- [Character animation](#character-animation)
- [Swapping in your own models](#swapping-in-your-own-models)
- [Audio](#audio)
- [Scripts](#scripts)
- [Browser support](#browser-support)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **Full chess rules** — castling, en passant, promotion, check, checkmate, stalemate,
  threefold repetition, the fifty-move rule and insufficient material, all via chess.js.
- **Rigged 3D characters, not chess pieces** — twelve sculpts (six per army), each with
  `idle`, `walk`, `attack` and `death` skeletal clips, plus weapons, shields and a floating
  rank crest.
- **Figures march, they do not slide** — a moved piece turns to face its destination, walks
  the distance on its own legs at the cadence of its rank, and squares up again on arrival.
  Knights keep the leap, running through the air and landing on both feet.
- **Synthesised footsteps on the stride clock** — every footfall is fired by the same clock
  that retimes the walk cycle, so sound, grit puff and foot all land together: scuffs for
  footsoldiers, leather for the clergy, plate for the tower guardians, a slow deliberate
  tread for the crown.
- **Cinematic captures** — the camera punches in, the attacker strikes on the hit frame,
  sparks fly, the screen shakes, and the defender **burns away from the soles upward**
  through a ragged edge of light, shedding motes that drift off (cold soul-light for the
  Kingdom, live embers for the Empire).
- **A blow that scales with rank** — the footsoldier stabs and moves on; the rider cuts on the
  charge and leaves an arc of steel hanging in the air; the tower guardian's hammer sends a
  wave rolling across the stone and the hall keeps shaking afterwards; the crown drops a
  **column of light on the condemned**, rings a bell over it, and executes it in gold. Each
  rank has its own lens punch, hitstop, swing weight and aftershock.
- **Casters kill at range** — the queen and the mage never close the distance. They level the
  staff from their own square, gather fire at the crystal, and throw it down the line: it
  lights the hall as it flies, breaks open on the body, and only once the corpse has burned
  away do they walk the whole distance and take the square. The mage throws **one** bolt; the
  sorceress throws a **volley of three** and leaves a ring of fire burning on the square (cold
  witchfire for the Kingdom, sunfire for the Empire).
- **Twelve death cries** — one recorded voice per rank per army, panned to where the body is
  on screen, ducking the music for a beat and pitch-jittered so no two deaths sound alike.
- **Four battlegrounds** that relight the whole world — sky, haze, stone colour, tile
  contrast, fires, birds, siege engines and the film grade.
- **2D tactical view** — one key lifts the camera straight overhead and flattens every figure
  into a stamped counter, so nothing can hide a square. Selection and moving keep working.
- **Three engine strengths** running off the main thread, so the render loop never blocks.
- **Showcase / attract mode** — let two engines duel on their own with pace control, pause,
  auto-rematch, and a clean capture view with the entire interface hidden. Three camera
  behaviours: hold one angle, follow the figure on the move and close in on the fight, or
  drift slowly around the board. The showcase also renders crisper than a played game —
  no depth of field, softer grain, vignette and bloom.
- **An interface that stays off the board** — icon-only controls with a themed tooltip on every
  one of them (name, one-line explanation, key cap), the move record folded into a corner
  sigil, and a slim showcase rail that collapses to a single icon. One key strips the whole
  overlay for recording.
- **Auto-detected graphics presets** (Low → Ultra) with an automatic step-down if the
  measured frame rate stays low, plus WebGL context-loss recovery.
- **Chess clocks**, undo, resign, flip board, copyable PGN, captured tray with material score.

## Quick start

Requires **Node 20+**. [Bun](https://bun.sh) is recommended; npm/pnpm work too.

```bash
git clone <your-fork-url>
cd <repo>/web

bun install
bun run dev        # http://localhost:5173
bun run build      # production bundle in web/dist/
bun run preview    # serve the built bundle
```

The build output in `web/dist/` is a plain static site — drop it on GitHub Pages, Netlify,
Cloudflare Pages or any static host. No environment variables are required to run the game.

## Controls

| Action | Input |
| --- | --- |
| Orbit / zoom | Drag, mouse wheel (one-finger drag and pinch on touch) |
| Select a figure | Click it — legal squares glow green, captures red |
| Move | Click a highlighted square (click the figure again to deselect) |
| Promotion | Pick one of the four figures rotating on pedestals |
| Camera & battleground | Camera icon in the top bar — Ivory / Obsidian / Overhead / Cinematic, flip, tactical, and the four arenas |
| What a button does | Hover or focus it (tap it on touch) — every icon carries a tooltip |
| Skip the intro | Click anywhere during the opening sweep |
| Settings | Gear icon — battleground, graphics preset, capture cinematics, board swing, sound |

There is no drag-and-drop: a press that travels more than 8px is read as a camera swing, so
orbiting from a figure never moves it. Selection and moves both resolve on release.

Keyboard shortcuts (ignored while typing in a field):

| Key | Action |
| --- | --- |
| `F` | Flip the camera to the other side |
| `T` | Toggle the 2D tactical view |
| `H` | Open / fold the chronicle (move record and spoils) |
| `C` | Toggle cinema mode (hide the entire interface) |
| `Space` | Pause / resume playback in showcase mode |
| `Esc` | Close the settings panel, camera menu, chronicle or an open tooltip |

## Interface

The board owns the screen; every panel is either short, in a corner, or foldable.

| Region | What lives there |
| --- | --- |
| Top left | Whose turn it is, the thinking pulse, the check banner, the showcase duel counter |
| Top right | Clocks, then the icon rail — take back, resign, new duel, sound, fullscreen, flip, tactical, camera menu, settings |
| Right, under the bar | Spoils: both captured trays and the material score (desktop only; it folds into the chronicle on narrow screens) |
| Bottom left | The chronicle sigil — a corner button with a move counter that unfurls the record on demand (`H`) |
| Bottom right | The showcase rail, only during a showcase duel |

- **Tooltips** (`src/ui/Tooltip.tsx`) replace the browser's native `title`, which appears too
  late to explain an icon. Each bubble carries the control's name, one sentence of
  explanation and a key cap when there is a shortcut. It opens after 110 ms, then **instantly**
  for the rest of a sweep along the rail, picks the screen edge that keeps it in view, flashes
  for 1.8 s on a touch press (touch has no hover), and closes on Escape, blur or scroll. The
  bubble is rendered inside its anchor rather than through a body portal, so it survives
  fullscreen.
- **The showcase rail** is a single 26px row of icons — play/pause, 0.5×–4× pace, the three
  camera behaviours, loop, restart — held at 74% opacity until hovered, and foldable down to
  one clapperboard icon. Pause is shown by a breathing play button instead of a large label.
- **Cinema mode** (`C`) removes the overlay completely and leaves one small restore button, so
  a screen capture is board-only.

## Game modes

| Mode | What it is |
| --- | --- |
| **Player vs Computer** | Pick your colour, an engine strength and an optional clock |
| **Two players** | Hotseat on one screen; the camera swings round between turns (switchable) |
| **Showcase** | Two engines duel on their own — per-side strength, 0.5×–4× pace, auto-rematch, still / follow / orbit camera, foldable rail |
| **Attract** | Leave the menu alone for 30 seconds and a showcase duel starts behind it |

Clocks: none, 5, 10 or 15 minutes, drawn as draining hourglasses.

## Battlegrounds

Switchable at any time from the camera menu or Settings; each one is a complete relight.

| Id | Name | Look |
| --- | --- | --- |
| `jungle` | **Sun Temple** (default) | Rainforest clearing, jade canopy, drifting pollen, two gold-crowned step pyramids |
| `dawn` | **Dawn Court** | Golden morning light, pale sky, warm stone — highest legibility |
| `frost` | **Frostfall** | Overcast snowfield, cold flat light, hardest contrast on the sculpts |
| `dusk` | **Siege at Dusk** | The original torch-lit siege — moodiest, heaviest bloom |

## Project structure

```
.
├── rork.json               workspace manifest (one app: web/)
├── scripts/
│   └── rewrite-commit-messages.sh
└── web/
    ├── index.html
    ├── public/             icon, favicon, robots.txt (drop local .glb models here)
    └── src/
        ├── core/           chess state — never imports three.js
        │   ├── gameController.ts   owns chess.js, clocks, undo, AI turns, snapshots
        │   ├── types.ts            MoveEvent, GameSnapshot, LedgerMove, …
        │   └── emitter.ts          tiny typed event emitter
        ├── ai/
        │   ├── engine.worker.ts    negamax + alpha-beta + quiescence + iterative deepening
        │   └── aiClient.ts         main-thread handle, cancels stale searches
        ├── scene/          three.js only
        │   ├── sceneEngine.ts      renderer, camera, interaction, move animation, cinematics
        │   ├── environment.ts      hall, lighting, torches, particles, PMREM environment
        │   ├── arena.ts            the four battleground looks and their ordering
        │   ├── battlefield.ts      siege props, camps, fires, birds
        │   ├── jungle.ts           canopy, palms, vines, pollen for the Sun Temple
        │   ├── board.ts            tiles, base, engraved labels, highlight pool
        │   ├── pieces.ts           rigged GLB loading, clips, faction materials, mixers
        │   ├── weapons.ts          procedural arms, shields and staves per rank
        │   ├── rankBadges.ts       floating heraldic crests
        │   ├── effects.ts          particle bursts, flashes, dissolve, camera shake
        │   ├── strikes.ts          per-rank blow visuals (slash arc, ground wave, pillar)
        │   ├── spells.ts           fireball orbs, per-army fire, the shared light pool
        │   ├── postfx.ts           EffectComposer pipeline (bloom, SSAO, DOF, grade, SMAA, clarity)
        │   ├── textures.ts         procedural marble, basalt, bronze, cloth
        │   ├── quality.ts          graphics presets + auto-detection
        │   └── tween.ts            promise-based tween engine
        ├── ui/             React + CSS overlay
        │   ├── GameShell.tsx       phases, settings, attract mode, keyboard shortcuts
        │   ├── MainMenu.tsx        mode / colour / strength / clock selection
        │   ├── Hud.tsx             top bar, spoils, chronicle sigil, showcase rail
        │   ├── Tooltip.tsx         themed tooltip for the icon-only controls
        │   ├── MoveLedger.tsx      the chronicle: move list, PGN, hover preview
        │   ├── SettingsPanel.tsx   graphics, arena, cinematics, sound
        │   ├── Heraldry.tsx        crests, hourglasses, piece glyphs
        │   └── medieval.css        the whole overlay's look
        ├── audio/          Web Audio mixer with layered score stems
        ├── assets/         URLs of the generated models and audio
        └── components/ui/  shadcn/ui primitives
```

## Architecture

Rendering is fully decoupled from the rules: **the chess core emits events and the scene
subscribes to them.** Nothing in `src/core` imports three.js, so the game logic is testable
headlessly and the renderer is replaceable.

### Move flow

1. The player (or the worker) produces a move → `GameController.tryMove`.
2. chess.js validates it and the controller builds a `MoveEvent` — captures, the castling
   rook trip, the en passant square, promotion and check flags.
3. The controller **awaits the animator the scene registered**, so the engine never moves
   while a figure is still gliding.
4. React re-renders from the immutable `GameSnapshot` published after every change.

### State

There is exactly one source of truth (`GameController`). React reads it through the
`useGameSnapshot` hook, which subscribes to the emitter and returns the latest snapshot —
no global store, no prop drilling of game state into the scene.

## The computer opponent

| Difficulty | Search | Budget |
| --- | --- | --- |
| **Easy** — *Squire* | Random legal move, prefers captures, always takes a mate in one | instant |
| **Medium** — *Knight* | Depth 3 negamax + alpha-beta, material + piece-square tables | 0.7 s |
| **Hard** — *Warlord* | Depth 5 iterative deepening, MVV-LVA ordering, quiescence on captures | 3.2 s |

All searches run inside `engine.worker.ts`. `aiClient.ts` cancels a stale search whenever the
position changes, so undo and resign are instant.

## Graphics presets

| Preset | Post-processing | Shadow map | Particles |
| --- | --- | --- | --- |
| Low | none (direct render) | off | none |
| Medium | bloom, grade, SMAA | 1024 | light |
| High | + depth of field in cinematics | 2048 | full |
| Ultra | + SSAO | 4096 | dense |

The preset is auto-detected on first load from the GPU string, core count and device memory.
The engine steps down one level automatically if the measured frame rate stays under 40 FPS.
Pixel ratio is capped at 2 (1 on Low), and a lost WebGL context shows a reload prompt instead
of a black screen.

### Black-screen recovery

Some drivers — Mesa's software rasterisers above all, which is what a Linux box without working
hardware acceleration falls back to — draw an all-black scene under a perfectly fine interface.
Three independent causes have been seen: the post-processing composer returning an empty buffer,
the PMREM reflection probe sampling as `NaN` (which poisons every lit surface while emissive
sprites keep drawing), and the shadow maps.

The engine handles all three without being asked:

- **Probe self-test** (`scene/diagnostics.ts`) — at boot, a white sphere lit *only* by the freshly
  built probe is rendered into an 8×8 buffer and read back. Black means the probe is unusable, so
  it is dropped and an ambient skylight of the same colour takes over.
- **Frame watchdog** — the frame is sampled five times over the first eight seconds at five points
  (centre plus quadrants). All five have to come back black before anything is dropped, then each
  failed sample peels off one more layer: post-processing → reflection probe → safe rendering.
- **A notice explains what happened**, and once it falls all the way back to safe rendering the
  choice is remembered in `localStorage` so the next visit starts with a picture.

Manual controls in **Settings → Picture**:

| Control | Effect |
| --- | --- |
| Brightness | Tone-mapping exposure multiplier, 60–180% |
| Safe rendering | No composer, no reflection probe, no shadow maps, +20% exposure |

`?safe=1` in the URL forces safe rendering on from the first frame, and the driver string is
printed to the console (`[scene] gpu: …`) and shown under the graphics presets.

## Character animation

Every figure is a rigged (skinned) character with up to five skeletal clips, declared per rank
in `PIECE_ANIMATED_MODELS` (`src/assets/generated.ts`):

| Clip | When it plays |
| --- | --- |
| `idle` | Looping combat stance, desynced per figure so the army does not breathe in lockstep |
| `walk` | Looping in-place stride, retimed to the cadence of the move that is under way |
| `run` | Looping in-place run — the knight charging through its leap (knights only) |
| `attack` | One-shot strike the moment a capture lands — sparks, shake and clash are timed to the hit frame. For the queen and the mage the same clip is the incantation, and its hit frame is the moment the fireball is released |
| `death` | One-shot fall played by the captured figure before it dissolves into dust |

How it is wired (`src/scene/pieces.ts`):

- The **rigged** GLB is the visual — the plain GLB has no skeleton, so clips bound to it do
  nothing. Each animation GLB contributes one clip, renamed to `idle` / `walk` / `run` /
  `attack` / `death`.
- Every instance is cloned with `SkeletonUtils.clone` (never `Object3D.clone`) and gets its
  own `AnimationMixer`. One-shots use `LoopOnce` + `clampWhenFinished`, and the strike
  crossfades back to the stance on the mixer's `finished` event.
- Clip root motion is stripped on X/Z so a figure never walks off its square; the death clip
  keeps its motion so the fall reads properly. The locomotion clips are **in-place** cycles for
  the same reason — board travel is owned by the container tween, so a clip carrying root
  translation would double the distance.
- The **Low** preset freezes the stance on its first frame (no per-frame mixer cost) — strikes
  and deaths still play, and the figure slides instead of marching (footsteps still sound).
- **Clips load in waves, not in one burst.** Twelve rigs × five clips is over seventy GLBs;
  firing them at once made the browser drop requests (`TypeError: Failed to fetch`) and figures
  silently lost their strike, so a capture looked like a piece dying untouched. The rig plus its
  `idle` load first, then `PieceFactory.warmClips()` pulls `attack` → `death` → `walk` → `run`
  two downloads wide, and every clip that lands is bound onto the figures already on the board
  (`PieceView.installClip`). A capture additionally calls `ensureClip` for the attacker's strike
  and the victim's death, so the beat waits (max 2.4 s) for its animation instead of skipping it.
- If a strike clip is genuinely unavailable, `SceneEngine.lunge()` performs the swing by hand —
  wind-up, twist, lean back, then the blow over the top. The tilt is held through
  `PieceView.setStrikeTilt()` and re-applied after the mixer, which otherwise owns the pose.

### Marching and footsteps

`SceneEngine.glide()` owns one stride clock per move (`src/scene/sceneEngine.ts`):

1. `GAITS[kind]` declares steps per square, cadence, boot timbre and loudness for the rank.
2. `steps = tiles × stepsPerTile`, and the move's duration is `steps / cadence` — a longer
   move takes **more steps**, not a faster slide.
3. `PieceView.startMarch(clip, stepRate)` retimes the walk cycle so one gait cycle equals two
   footfalls at exactly that rate, so the skeleton cannot drift out of the clock.
4. `strideEasing()` gives the move a push-off, a constant-speed cruise and a settle. A fully
   eased curve would leave the feet skating at both ends against a fixed cadence.
5. Each whole step crossing fires `audio.footstep()` (panned by screen position, alternating
   feet, pitch-jittered) plus a small grit puff at the contact point.

Footsteps are fully synthesised in `src/audio/audioManager.ts` — a low body thump for the
weight, a band-passed noise transient for the sole, and a metallic afterring for armour, one
voice per `FootstepTimbre` (`scuff` / `leather` / `plate` / `regal`). No asset, no latency.

### Strikes by rank

The hand-to-hand beat is one piece of choreography — charge, square up, strike, crumble — but
its weight is read out of `STRIKES[kind]` in `src/scene/sceneEngine.ts`, so the same code carries
a footsoldier's stab and a royal execution. The pawn's line is the original beat and is left
exactly as it was; everything above it is measured against it:

| Rank | What is added on top of the pawn's beat |
| --- | --- |
| Pawn (`p`) | The baseline: 5.5° lens punch, sparks, one camera kick |
| Knight (`n`) | Fastest charge, a crescent of steel through the body (`spawnSlash`), dust torn up along the line of the charge, a light aftershock |
| Bishop (`b`) | Safety net only — the mage fights at range |
| Rook (`r`) | Slowest wind-up, heaviest swing in the mix, a wave rolling out across the stone (`spawnGroundWave`) with a second echo, low-frequency slam, long aftershock |
| Queen (`q`) | Safety net only — the sorceress fights at range |
| King (`k`) | A column of light dropped on the condemned before the blow (`spawnPillar` + `judgementToll`), 11° lens punch, gold arc **and** gold ground wave, the longest hitstop and aftershock |

The supporting visuals live in `src/scene/strikes.ts` (`spawnSlash`, `spawnGroundWave`,
`spawnPillar`). Each one builds a throwaway object, animates it off the caller's tween clock and
disposes itself, so none of them needs a slot in the frame loop; the textures and geometry are
shared module singletons freed by `disposeStrikeAssets()`. The swing, the slam and the bell
(`bladeWhoosh`, `groundSlam`, `judgementToll`) are synthesised in the mixer alongside the
footsteps — no assets.

### Ranged combat (queen and mage)

`RANGED_KINDS` in `src/scene/sceneEngine.ts` routes captures by the queen (`q`) and the mage
(`b`) to `playSpellCinematic()` instead of the melee beat, in this order:

1. Caster and target turn to face each other; the caster does not move off its square.
2. `gatherSpell()` grows a `SpellOrb` (`src/scene/spells.ts`) at the weapon's casting point
   for the length of the strike clip's wind-up, pulling embers inward over a rising charge.
3. `throwFireball()` flies the orb to the target's chest on a flat arc, shedding embers and
   smoke; flight time scales with the distance actually crossed.
4. `spellBurst()` lands it — flash, fire shell, ember cloud, square impact and camera kick.
5. `slay()` then `banish()` run to completion, so the target is **dead and gone** before the
   caster takes a step, and only then does `glide()` march it onto the cleared square.

How much fire is thrown is a profile too — `MAGE_SPELL` versus `QUEEN_SPELL`. The mage holds a
small orb and throws a single bolt. The sorceress gathers roughly half again as long, holds a
much larger ball, and throws a **volley of three**: two smaller leaders that come in off the
shoulder and clap on the body first, then the killing bolt behind them, whose blast is 1.75× the
mage's and rolls a ring of fire out across the square.

The casting point is a marker parented at the head of the main weapon (`focus` in
`src/scene/weapons.ts`), read out of the live pose each frame, so the fire hangs off the
crystal wherever the casting arm swings it. `SPELL_LOOK` gives each army its own fire. The three
spell voices (charge, cast, impact) are synthesised alongside the footsteps — no assets.

**The fire's light comes from a fixed pool.** `SpellLightPool` (`src/scene/spells.ts`) creates
three point lights once with the scene and lends them out per bolt. A light created per fireball
crashed the tab: three.js keys its shader programs on the scene's light counts, so every material
in the hall recompiled mid-fight. Pooled lights are never removed *or hidden* — an invisible
light is dropped from the render state, which changes the count exactly as removing it would —
they are only dimmed to zero and handed back. A fourth simultaneous bolt simply gets no light
instead of a recompile, and the pool is empty on presets without post-processing.

The capture dissolve is a shader injection: a noise field eats the body from the soles up with
a glowing burn edge, while the whole mesh fades and sheds upward-drifting motes.

## Swapping in your own models

The sculpts are referenced by URL in `src/assets/generated.ts`:

```ts
export const PIECE_MODEL_URLS: Record<Faction, Roster<string>> = {
  w: { k: "…king.glb", q: "…queen.glb", /* … */ },
  b: { /* … */ },
};
```

Drop glTF/GLB characters into `web/public/models/` and point the entries at
`/models/your-king.glb`. Requirements:

- **Orientation** — Y-up, facing +Z, or edit `PIECE_MODEL_ORIENTATION` in the same file; the
  loader derives the correction quaternion from the declared front/up axes.
- **Scale** — any. `PieceFactory.normalize()` measures the model, rescales it to the height in
  `PIECE_HEIGHT` (`src/scene/pieces.ts`), centres it on X/Z and grounds it on Y.
- **Materials** are cloned per instance and tinted per faction in `applyFactionLook()`.

If a rigged model fails to download the loader falls back to the static sculpt, and if that
fails too, to a procedural primitive figure — **the game always stays playable**.

To animate your own characters, add a `PIECE_ANIMATED_MODELS` entry with a rigged GLB plus one
GLB per clip; any missing clip is simply skipped (no `walk` clip just means that rank slides),
and a clip that fails to download is retried on demand the next time the game needs it.

For shipping, compress the GLBs instead of streaming them from a remote host:

```bash
bunx @gltf-transform/cli optimize king.glb public/models/king.glb \
  --compress draco --texture-compress webp --texture-size 1024
```

## Audio

MP3s are streamed once and decoded into Web Audio buffers: an ambience bed, a score bed and a
tension stem that crossfades in during check and the endgame, plus place, capture, check-horn
and fanfare one-shots. The twelve death cries in `DEATH_CRY_URLS` are lazily loaded after the
mixer unlocks, since they are only needed on a capture; each is a real one-second take, panned
by the dying figure's screen position and pitch-jittered per playback.

Footsteps, the wooden set-down knock, body falls and UI blips are synthesised with oscillators
and noise buffers — no files. Everything routes through one master gain
for the mute toggle, and playback only starts after the first user gesture (browser autoplay
policy).

> **Note on hosted assets.** Out of the box, the models and audio are streamed from remote
> URLs listed in `src/assets/generated.ts`. If you fork this for production, mirror them into
> `web/public/` and update those constants so your build does not depend on someone else's CDN.

## Scripts

Run from `web/`:

| Script | What it does |
| --- | --- |
| `bun run dev` | Vite dev server with HMR |
| `bun run build` | Type-checked production build into `dist/` |
| `bun run preview` | Serve the production build locally |
| `bun run lint` | ESLint over the whole project |
| `bun run test` | Node unit tests **and** the Playwright-backed browser tests |
| `bun run test:watch` | Vitest in watch mode |
| `bun run test:browser` | Browser-mode Vitest only |

## Browser support

Any browser with **WebGL 2** and **Web Audio**: current Chrome, Edge, Firefox and Safari 16+,
on desktop and tablet. Touch orbit, pinch zoom and tap-to-move are supported; on narrow
screens the move ledger folds into a corner button so the board keeps the whole viewport.

On Linux, check `chrome://gpu` / `about:support` first: without hardware acceleration the browser
falls back to llvmpipe, and the scene is then rendered by the CPU. The game still runs — see
[Black-screen recovery](#black-screen-recovery) — but expect Low preset frame rates.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the
workflow, coding conventions and the **English Conventional Commits** message format used in
this repository.

## License

[MIT](LICENSE) © the King's Gambit contributors.

Bundled dependencies keep their own licences: three.js (MIT), chess.js (BSD-2-Clause),
React (MIT), Tailwind CSS (MIT), Radix UI / shadcn/ui (MIT), lucide (ISC).

The 3D characters and audio shipped with the project were generated for it and may be reused
under the same terms; if you replace them, credit the new authors here.
