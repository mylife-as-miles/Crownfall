# Crownfall Quest

The hands-first Meta Quest version of the approved Crownfall menu. It was created with `npm create @iwsdk@latest` and currently pins IWSDK `1.1.0-rc.2`. Node 24 is recommended; the package declares the SDK-supported Node ranges, starting at 20.19.

From the repository root:

```sh
npm run setup
npm run dev:quest
npm run build
npm run test:quest
npm run check:sync
```

`dev:quest` uses the IWSDK-managed server and browser. Its HTTPS endpoint is normally `https://localhost:8081/`; the CLI also reports network addresses for a headset on the same network. Use an HTTPS host for a production WebXR experience. No production deployment is performed by these scripts.

The setup helper skips the optional CUDA download used by IWSDK's development-reference helper; both app runtimes and CPU reference tooling remain available. Direct installation on Linux can use `ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci`.

## The hand-only visit

Open the page in a Quest browser, enable hand tracking and select Enter VR with the browser's hand pointer. No controller pairing is required. The immersive session requests hand tracking as a required feature; unsupported or denied entry leaves the browser preview and a retryable explanation.

The first visit explains pointing and pinching, and direct fingertip presses on nearby controls. Start a short three-arena visit or skip to the menu. Next and Previous are hand buttons; Finish creates a visibly distinct completion state. Home also offers Short visit so the moment can be replayed. Back returns to the menu, and Exit VR returns to the browser. There are no timed gates or artificial waiting periods, and the visit can finish well within ten minutes. This is an artwork/menu experience: chess, campaign progression, online duels and replay playback are not connected.

All Home, Play, Showcase, chapter, settings and modal controls are native spatial UIKitML buttons. Their design follows the desktop1280×720 canvas: full artwork with the same focal crops, overlaid Barlow headings, original card/grid proportions, unboxed navigation, patterned settings tiles and borderless dialogs. The whole canvas scales uniformly in world space so compact35-unit rows remain hand-sized; controls do not become a different dashboard. Both `RayInteractable` and `PokeInteractable` are authored on the panel. Back, Pause, Recenter and Exit VR remain discoverable without a keyboard or controller. Covered actions are blocked while outgoing views briefly fade.

The menu stays in world space, rather than following every head movement. Recenter places the room in front of the current view without moving or tilting the viewer. Either hand works; the other hand may remain out of view. Losing both tracked hands or backgrounding the immersive session pauses and retains the current menu, dialog and visit step. Bring a hand back and select Resume. Explicit Exit and re-entry retain the in-memory place; completed onboarding and comfort preferences persist on this browser.

## Quest settings

The six categories retain Crownfall's labels but use headset-appropriate controls. General contains ambient motion, hand hints and contrast. Controls explains pointing/pinching, touch, Back, Pause, Recenter and Exit; Input reports actual current wrist tracking. Video offers render quality, larger menu/text sizes, menu distance and seated/standing placement. Headset resolution and frame timing stay managed by the immersive session; desktop frame caps and fullscreen controls are not applied to VR. Render quality adjusts preview resolution and headset foveation where supported. Audio volume is a saved preference with its currently absent playback disclosed. Credits identifies the supplied assets and SDK.

The real sorcerer loads lazily through IWSDK's `AssetManager`, after the menu is usable. Its named Idle loops at authored speed. The warm background wash, teal/gold shader motes, aura and light palette follow desktop. Quality changes particle density; pausing/reduced motion freeze their clock and the rig. Model failure leaves the menu operational and exposes Retry creature. The existing local Draco decoders are remapped through the public loading manager.

## My Legacy

Home → My Legacy opens the immersive Legacy destination as its own place (the `legacy` route), not an information dialog. While it is shown the menu panel, the sorcerer and the menu atmosphere are hidden and stop updating; Return to Home restores them. Chess matches are not connected to My Legacy in this build: accepting a challenge records the acceptance and shows "Awaiting the board", and no match result is ever invented.

**Staging.** The scene-authored `legacy-anchor` is placed at the viewer's eye, facing where the menu faces. Recenter repositions it, and the menu, in front of the current view; the viewer is never moved or rotated. The environment is created on first entry and parented under that anchor. Gameplay places the primary panel and the dock at the anchors the environment publishes (`getStaging().panelAnchors`), turned to face the viewer. Seated or standing posture, text size, render quality (including foveation) and reduced motion follow the existing Quest preferences.

**Environment seam.** `src/legacy/environment-provider.ts` discovers the environment workflow's `src/legacy/environment/createLegacyEnvironment.ts` with a lazy `import.meta.glob`. Until that module exists, or if it fails, gameplay's stand-in in `src/legacy/standin/` is used. The stand-in is a small, neutral diorama with four labelled landmark markers in one shallow arc (so a hand ray from either side reaches each without crossing another's pick volume) and a visible "Environment stand-in" caption. It is not the authored Bannerhold.

**Panels.** `scripts/generate-quest-legacy-ui.ts` builds `public/ui/legacy.uikitml` (the primary panel) and `public/ui/legacy-dock.uikitml` (Return to Home, Recenter, Pause, Exit VR) from shared Legacy content and copy. Do not hand-edit them; Vite regenerates them and `npm run check:sync` fails when they are stale. Every control is at least the Home menu's 50-unit hand target, at the same physical unit, and readable copy is at least 14 units. Text is mapped to the ASCII glyphs of the spatial font, so `·` reads as `/` and dashes read as `-`. UIKitML gives an empty `<span>` no text node, so text set on it later never draws; every live text therefore starts with a placeholder (class `lg-live`) that the runtime clears, and the generator rejects empty text spans. Controls are plain containers whose hover, selection and disabled looks are set from code (`src/legacy/legacy-button-style.ts`): a class `:hover` style stayed lit after its control was hidden while pointed at, so the generator also rejects `<button>` and `:hover`. The panels cover:

- founding: the four nations; quick name suggestions with Other names, plus an optional large-key letter keyboard; heraldry presets and per-element cycling, with a live preview rasterized by the shared heraldry code;
- the four landmark inspectors, which show the same shared data as desktop: the Banner Hall's identity and honours, the Muster Grounds' representative and the nomination of a member and an open file, the War Record ledger with an honest empty state, and the Herald's Station notices with the stated wager (Accept leads to "Awaiting the board");
- a landmark list as a hand alternative to pointing at the holding, at most two aftermath messages, session labels, and Dissolve banner with a confirmation.

**Saves and sessions.** Banners persist in this browser's `localStorage` under `crownfall.legacy.save`, through the shared `shared/legacy` persistence and the same schema as desktop. There is no sync between devices. `?legacy=fresh` starts a guest banner that never reads or writes storage. `?legacyPreview=<id>` loads a development preview built from fixture records. Both are labelled in the headset (the panel band and the dock) and on the browser entry panel. An unreadable save, or one from a newer version, is left untouched, and you can raise a new banner or continue as a guest.

**Hands and comfort.** Either hand points and pinches. The panels and the stand-in's landmark proxies are both `RayInteractable` and `PokeInteractable`. Losing both hands pauses My Legacy; Resume appears once a hand returns, and restores the same Legacy view. Exit VR keeps the Legacy place for re-entry.

**Verification in browser emulation.** With the managed runtime started with `--allow-browser-automation`, `node scripts/verify-legacy.mjs` drives the destination with hand rays and pinches only, both controllers disconnected, and asserts the Legacy fields of `CrownfallQuestState` after each step: Home → My Legacy (a route, with the menu's hand targets gone), Dissolve banner with its confirmation, founding (nation, Other names, the keyboard typed then cancelled, a suggested name, a preset and per-element arms), every landmark by pointing at the holding and again from the landmark list, a nomination, the Herald's challenge (Accept → confirmation → "Awaiting the board"), hand loss → pause → Resume, Recenter (the anchor turns to the view; the viewer pose never changes), Return to Home and back, Exit VR and re-entry, and the save written to this browser (then, when the browser allows it, a reload that restores it). It writes `artifacts/legacy/latest/verification.json`. `node scripts/capture-legacy.mjs` writes mono 60° captures and `capture-evidence.json` to the same folder; `--session guest` and `--session preview:<id>` add the labelled guest and preview sessions, including the browser entry panel.

Software-emulation accommodations, all recorded in the evidence: a 640×480 viewport (800×560 for captures), Render Quality Low and Ambient Motion Off, the short visit marked complete, `VITE_CROWNFALL_EMULATOR_SCALE=0.25`, and, for pinches on the Home menu only, the emulated head looking almost straight down. On this shared host SwiftShader takes over a second per frame for the 80k-triangle sorcerer, longer than the pointer's 800 ms click window; looking down removes it from view and the same pinch lands. The ray, hit test and pinch are unchanged, and Legacy pinches use a level view. Direct fingertip poke is wired but not exercised, so it is not claimed. None of this is a physical Quest test.

Measured in that emulation (`verification.json`, `performance` and `observations.menuFrames`; software-rendered on a shared, heavily loaded 4-CPU host, so none of these numbers predicts Quest frame time): with My Legacy open the renderer drew 78 calls, 22,988 triangles, 52 geometries, 34 textures and 20 programs, of which the stand-in holding is 18 calls and 196 triangles; the menu, sorcerer and atmosphere are hidden and not updated. Legacy frame intervals were p50 133 ms and p95 267 ms; the Home menu took about 1.1 s per frame with the hero in view and 67 ms looking down. A V8 sampling heap profile over 20,000 Legacy update calls attributed 484 bytes to Legacy code in total (about 0.02 bytes per update): the per-frame path does not allocate steadily. Foveation follows Render Quality (Low 1, Medium 0.5, High 0) through the existing comfort path, and the environment receives `setQuality` for its own detail; the stand-in renders the same at every quality.

The run checks that the banner, nomination and accepted challenge are written to `crownfall.legacy.save` by reading the key back. On this host the managed browser closed while re-entering right after a page reload, so restoring the save on reload is recorded as not exercised in the final run; loading is covered by the shared persistence tests.

## Shared updates

`../shared/menu/` owns common content, feature availability, modal copy, palette and design geometry. `../scripts/generate-quest-ui.ts` creates the static `public/ui/menu.uikitml` panel. The Vite integration regenerates it and copies the canonical desktop assets during direct IWSDK CLI startup and production builds. Changes to shared data/assets restart the same managed runtime; generated asset copies are ignored by Git. `npm run check:sync` verifies deterministic UI generation, desktop token use and asset hashes.

Each app has a separate dependency tree. Do not hoist or substitute Three: the Quest app uses IWSDK's exact `super-three` alias, while desktop retains its existing Three runtime.

## Verification

```sh
npm run typecheck
npm run test
npm run build
npx @iwsdk/cli dev up --headless --timeout 45000
npx @iwsdk/cli runtime wait --timeout 45000
# Select the page's Enter VR control, then use native hand input.
```

The pure state suite checks routes, unsupported/locked previews, modal isolation, comfort values, pause/resume context and guarded completion. Immersive behavior must additionally be exercised through actual emulated hand inputs and named application state; flat preview screenshots do not prove it. The runtime component `CrownfallQuestState` exposes the selected view, dialog, tracking, visit progress, comfort values and animation time for inspection.

With the managed runtime already running, `node scripts/verify-runtime.mjs` exercises the full menu with hand rays and pinches, disconnects both controllers, and verifies actual Exit postconditions. The recorded run in `artifacts/hands/verification.json` preserves its original six passing UI groups and an SDK ended-session acknowledgement error after successful Exit. `exit-postcondition.json` and the five-group `session-verification.json` establish the actual Exit, hand-loss recovery, repeat visit and re-entry outcomes; `result.json` composes those records without rewriting the original failure. `verify-session.mjs` is a closeout of that recorded run, not an independent clean-start suite.

The emulated input checks used mono rendering. Native fingertip touch is wired, but its emulator contact helper exceeded the click window on this software-rendered host, so direct poke is not claimed as a passed runtime test. A later stereo capture timed out and the managed browser closed; one managed recovery produced the final mono capture. See `artifacts/final/capture-evidence.json` and the bounded visual comparison in `artifacts/ui-runtime-review.jpg`. These are development captures, including emulator overlays, not a production headset recording.

Browser emulation is separate from a physical Quest smoke test. Physical tracking reliability, seated comfort, on-device cold start and the headset's 72–90 Hz rendering budget require on-headset measurement before challenge acceptance is claimed. The project is not merged, deployed or submitted to a challenge by this work.

For software-only headless emulation, an untracked `.env.local` may set `VITE_CROWNFALL_EMULATOR_SCALE=0.25` before starting the managed runtime. It requests a reduced development immersive framebuffer for software testing; actual emulation framebuffer size must be measured separately. Production ignores this flag. Remove it for physical-headset development, and disclose it with emulated evidence.

## Screenshot gallery

Current desktop-design verification and fresh renders are in `artifacts/parity/`, driven by `node scripts/verify-parity.mjs`. It starts through the explicit browser Enter VR button because automatic session offering is disabled, then uses actual hand inputs. Compact inspection sizes allow a .002-unit Float32 tolerance.

The earlier complete33-screen menu/state gallery in [artifacts/screens/README.md](artifacts/screens/README.md) records the previous visual adaptation at9817e3f. Its PDF/PNGs remain available as historical evidence; they do not show the restored desktop design.

To refresh it in the managed test browser, enable `--allow-browser-automation` when starting the headless runtime, run `npx @iwsdk/cli browser run scripts/prepare-gallery.mjs`, then `node scripts/capture-all-screens.mjs`. Preparation clears only the test browser's completed-onboarding flag; the real visit completes it again. Capture uses actual hand selections and named state assertions. `python scripts/build-screen-gallery.py` packages the files and requires Pillow. The gallery runner expects a fresh browser preview with no active immersive session.

A stopped capture can continue with `node scripts/capture-all-screens.mjs --resume` in the same session. Completed screenshots are retained, and prior selection errors remain in the manifest.
