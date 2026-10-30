# My Legacy — recovery and creation failures

30 October 2026, `feat/my-legacy`. This checkpoint preserves the approved menu and stand-in environment. No protected chess/Play source or generated UI was edited.

## Fresh evidence

- [Hand recovery](recovery-verification.json): seven passing groups and 30 hand interactions. Corrupt/newer bytes survive Guest and Back, including completed guest founding. Replacement writes only after explicit confirmation and completed founding. Normal dissolution labels, safe Back and Play return pass. The original stored save is restored.
- [Injected module-loader failure](chunk-failure-verification.json): three passing groups. After the one-shot loader rejection, actual hand entry returns safely to Home with no Legacy panels; Play and Home work; a hand retry successfully fetches `moduleRetry=1` and creates exactly one panel and dock. The injection and request-abort route are removed before the successful retry.
- [Desktop affected browser run](../../../../main%20game/artifacts/legacy/codex-round-4/desktop/verification.json): eight passing groups, including keyboard default, destructive confirmation after focus loss, guest persistence, preview purity and focus regressions; no JavaScript/console errors.
- [Build/test/sync/lazy summary](checks.json): 76 shared tests and 143 Quest/shared tests; counts overlap. Both builds and generated/lazy checks pass. Existing size/third-party annotation advisories remain.
- [One final unfiltered console sample](console.json): all 11 error entries are the intentionally rejected module request or its handled application error across fault experiments. Existing Three deprecation and XR resize warnings remain. No other parser/resource errors appear in the captured 76 entries; this is a bounded sample, not a universal clean-console claim.
- [Recovery review sheet](recovery-review.jpg): one 600×432 comparison sheet; top row is explicitly historical recovery and bottom row is the new confirmation, different states. Original [corrupt](corrupt-replacement.png) and [newer-save](future-replacement.png) captures are unchanged. An independent compact review found no obvious clipping, overlap or theme defect; fine text is too small to certify.

The new environment tests use real SDK entities and disposal events. They cover partial factory rejection before fallback, fallback rejection, one-time normal ownership, sibling resource preservation, late completion, recycled entity generations and shader-uniform textures. They do not establish whole-app leak freedom, unattached allocation cleanup or ownership of unmarked borrowed caches.

## Reproduction

After typechecking and starting the managed runtime with browser automation enabled:

```sh
node scripts/verify-legacy-recovery.mjs --out artifacts/legacy/codex-round-4
node scripts/verify-legacy-chunk-failure.mjs --out artifacts/legacy/codex-round-4
```

The recovery script uses storage preparation only to create isolated test sessions, then actual SDK hand rays, pinches and fingertip presses. Both controllers are disconnected. The module test captures an actual rejected development-module request, then injects that rejection into the next loader attempt within a completed browser-run callback. Only afterward does CLI hand input exercise failure handling and request a fresh module URL. This is an injected loader failure, not a network outage during the hand action. The one-shot injection restores the original loader function, and no browser-run lease remains held during hand commands.

The intermediate `chunk-fault-*.json` files are retained as debugging history, not acceptance results. The first fault setup did not persist; the second had an invalid resource-timing assertion despite a real rejected request. A sequential cache-priming attempt did not make the later app import fail. The held-route experiment is historical and is superseded by the sequential, explicitly injected loader harness to avoid overlapping managed-browser commands.

## Limits

These are active XR sessions in IWSDK's browser emulator, using software rendering, mono Quest 3 emulation, a 640×480 app viewport and a 0.25 development framebuffer scale. Workspace screenshots include SDK chrome that partly covers the lower tray. They do not prove physical reach, tracking, stereo comfort, fine legibility, cold start, GPU performance or a 9/10 rating. The existing performance gates and the unavailable first legal move remain open; the creator's chess port is not connected here.

No merge, deployment or new PR is part of this checkpoint. Private source material is not included in this directory or repository.
