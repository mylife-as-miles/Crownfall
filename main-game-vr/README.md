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

Chronicles map-load recovery is covered by the unit suite and [fresh emulated hand evidence](artifacts/chronicles/recovery-2026-10-30/verification.json): a rejected load ends the loading bar, shows shared failure/re-entry guidance, keeps records and Back usable, and retries successfully on hand re-entry. The full hall, allocation/performance gates and physical Quest validation remain open.

For a bounded loader fault, start the managed runtime with `--allow-browser-automation`, then run `CROWNFALL_MAP_PROBE=arm ./node_modules/.bin/iwsdk browser run scripts/chronicles-loader-probe.mjs`. Let that callback return before actual CLI hand input. The seam rejects one map-loader call; it does not simulate a network failure. Use `CROWNFALL_MAP_PROBE=status` to inspect rejection/delegated-success counters and `CROWNFALL_MAP_PROBE=restore` to reinstate the original method. Query `ChroniclesArchiveState` and the native `Chronicles_Load_Failure` element rather than inferring success from captures alone.

With the managed runtime already running, `node scripts/verify-runtime.mjs` exercises the full menu with hand rays and pinches, disconnects both controllers, and verifies actual Exit postconditions. The recorded run in `artifacts/hands/verification.json` preserves its original six passing UI groups and an SDK ended-session acknowledgement error after successful Exit. `exit-postcondition.json` and the five-group `session-verification.json` establish the actual Exit, hand-loss recovery, repeat visit and re-entry outcomes; `result.json` composes those records without rewriting the original failure. `verify-session.mjs` is a closeout of that recorded run, not an independent clean-start suite.

The emulated input checks used mono rendering. Native fingertip touch is wired, but its emulator contact helper exceeded the click window on this software-rendered host, so direct poke is not claimed as a passed runtime test. A later stereo capture timed out and the managed browser closed; one managed recovery produced the final mono capture. See `artifacts/final/capture-evidence.json` and the bounded visual comparison in `artifacts/ui-runtime-review.jpg`. These are development captures, including emulator overlays, not a production headset recording.

Browser emulation is separate from a physical Quest smoke test. Physical tracking reliability, seated comfort, on-device cold start and the headset's 72–90 Hz rendering budget require on-headset measurement before challenge acceptance is claimed. The project is not merged, deployed or submitted to a challenge by this work.

For software-only headless emulation, an untracked `.env.local` may set `VITE_CROWNFALL_EMULATOR_SCALE=0.25` before starting the managed runtime. It requests a reduced development immersive framebuffer for software testing; actual emulation framebuffer size must be measured separately. Production ignores this flag. Remove it for physical-headset development, and disclose it with emulated evidence.

## Screenshot gallery

Current desktop-design verification and fresh renders are in `artifacts/parity/`, driven by `node scripts/verify-parity.mjs`. It starts through the explicit browser Enter VR button because automatic session offering is disabled, then uses actual hand inputs. Compact inspection sizes allow a .002-unit Float32 tolerance.

The earlier complete33-screen menu/state gallery in [artifacts/screens/README.md](artifacts/screens/README.md) records the previous visual adaptation at9817e3f. Its PDF/PNGs remain available as historical evidence; they do not show the restored desktop design.

To refresh it in the managed test browser, enable `--allow-browser-automation` when starting the headless runtime, run `npx @iwsdk/cli browser run scripts/prepare-gallery.mjs`, then `node scripts/capture-all-screens.mjs`. Preparation clears only the test browser's completed-onboarding flag; the real visit completes it again. Capture uses actual hand selections and named state assertions. `python scripts/build-screen-gallery.py` packages the files and requires Pillow. The gallery runner expects a fresh browser preview with no active immersive session.

A stopped capture can continue with `node scripts/capture-all-screens.mjs --resume` in the same session. Completed screenshots are retained, and prior selection errors remain in the manifest.
