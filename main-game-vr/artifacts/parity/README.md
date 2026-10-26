# Crownfall desktop design in Quest

[Current overview](overview.jpg) · [Current seven-screen PDF](Crownfall-Quest-Desktop-Design.pdf) · [Desktop/Quest comparison](ui-runtime-review.jpg)

The final captures in `final/` show Home, Play, Showcase, Settings, Chapters, a settings detail and a modal. They come from the running native spatial UI in an active emulated Quest session. The closer60-degree view makes the desktop design easier to inspect; the head stays at its default pose. One hand navigates, then lowers for the pictures. Both controllers are disconnected. These captures do not establish physical headset performance or readability.

The native UI now uses the desktop1280×720 design coordinates,197×298 full-art Play cards,600×434 Home grid,900×438 Settings grid, original artwork focal crops, local Barlow fonts and overlays. Icons, patterns, locks and gradient scrims are generated from the existing desktop SVG functions and CSS. No supplied artwork or text is rasterized into a replacement interface. The whole UI scales uniformly for physical hand targets; transparent controls retain an almost invisible interaction surface instead of visible brown boxes.

The actual four-arm sorcerer and authored1× Idle remain. Its anchor is0.12m higher than the initial port so the face clears the cards. Warm atmosphere, teal/gold particles and lighting follow desktop. The background wash extends outside the view, and a depth-correct veil dims the world behind dialogs/details without a rectangular UI backdrop. Native view fades/slides honor the motion setting and operating-system reduced motion.

Validation:

- Both production builds and TypeScript checks pass. Desktop source is unchanged; its generated JS/CSS hashes remain unchanged.
- Nine Quest state tests, source ESLint and helper syntax checks pass.
- Sync checks validate236 stable native elements,21 byte-identical shared assets and31 resolvable UI image/font references. Asset copying is write-if-different to avoid unnecessary live reloads.
- `verification.json` records four actual hand-interaction groups: geometry contracts, selection/modal isolation, Chapters/Showcase routes, and settings/quality/pause/motion controls. Renderer Float32 values use a .002-unit tolerance. Prior failed probes remain in the error history.
- `final/evidence.json` records the final corrected scene and seven captures reached through real one-hand navigation. `final/console-after.json` contains no error entries. Dependency deprecation warnings remain.
- Independent compact-image review found no remaining definite visual blocker: the wash/modal edges are gone, the face clears the cards and the desktop design identity remains recognizable.

The first comparison exposed the background edge, low face and bounded modal shade. The initial direct session-offer command was replaced by an actual browser Enter VR click; transparent hit areas were corrected after a Back-control probe. A missing archive decoration was added and image/font reference validation now guards that boundary. Earlier renders and the pre-fix console are retained separately from `final/`.

Physical Quest tracking, direct poke, stereo, fine typography/readability, seated comfort, cold-start time and frame pacing remain unmeasured. No numerical fidelity or challenge-acceptance certification is claimed. Gameplay and replay playback remain outside this menu preview.
