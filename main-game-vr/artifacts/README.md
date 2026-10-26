# Dual-version verification

Current implementation uses Node 24.19.0 and IWSDK 1.1.0-rc.2. Both app dependencies remain isolated.

## Passing checks

- Repository `npm run build`: desktop and Quest TypeScript/production builds pass. Both report bundle-size advisories; Quest also reports two third-party annotation warnings.
- `npm run test:quest`: nine state tests pass.
- `npm run check:sync`: deterministic native UI with 118 stable IDs and 21 byte-identical shared asset files passes.
- Desktop `node scripts/verify.mjs`: ten menu checks pass. Desktop `node scripts/verify-settings.mjs`: nine settings groups pass, including 1280×720, 1920×1080 and 844×390 layout samples. Results remain in the desktop artifacts directory.
- Source ESLint across both apps and shared TypeScript, helper-script syntax and Git whitespace checks pass.
- `hands/result.json` composes six passing menu-interaction groups with five passing focused session groups. Actual emulated hand rays/pinches drive the controls; both controllers are disconnected. Tested paths include all menu/settings categories, mode/chapter previews, arena selection, modal isolation, comfort changes, visit completion/replay, Pause/Resume, loss of both hands and recovery with one hand, Exit and re-entry. The original ended-session acknowledgement failure is retained rather than rewritten. Named session/application postconditions establish successful Exit.
- `final/capture-evidence.json` establishes a recovered active immersive session with hand tracking, controllers disconnected, actual Play→Home hand selections, a loaded/animating sorcerer and final Home capture. Saved comfort values survive the managed browser recovery.
- `final/console.json` contains no error-level entries or UIKit/resource errors. Five dependency deprecation warnings remain.

## Visual evidence and limits

`ui-runtime-review.jpg` is the bounded comparison of the approved desktop baseline and a live Quest Home capture. Independent review found no definite blocking overlap, clipping or accidental scene replacement. The complete native panel and supplied sorcerer remain recognizable. The small labels cannot be certified from this low-resolution mono mirror, and the two images show different menu states. No numeric fidelity score is assigned.

`panel-preview.png` is an isolated authoring preview. `scene-hero.png` is a valid authored composition with no validation diagnostics; application systems do not run in this render, so it does not show the lazily loaded creature. The actual creature is present in the live captures and named runtime state. These authoring images do not establish hand behavior.

Input testing uses the software IWER Meta Quest 3 profile with mono rendering. The untracked development environment requests a 0.25 immersive framebuffer scale; actual framebuffer dimensions were not measured. Production ignores this flag. A stereo screenshot attempt timed out and the managed browser closed; one supported managed recovery produced the final mono capture. Emulator overlays in these captures are development tools.

Direct fingertip touch is implemented through native `PokeInteractable`, but the emulated poke helper exceeded its click window under software rendering. It is not a passed runtime test. Hand-ray pinch is the verified end-to-end selection path. Physical Quest hand tracking, text readability, seated comfort, operating-system interruption, cold-start time, stereo rendering and the 72–90 Hz frame budget still require on-headset checks.

Both menu versions remain separate from the playable chess application. The three-arena visit is a complete short artwork experience; gameplay, online duels, campaign progression and battle/replay playback are not connected. This evidence does not certify challenge acceptance.
