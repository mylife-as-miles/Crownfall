# My Legacy verification — 30 October 2026

Functional verification checkpoint on `feat/my-legacy`, continuing the stopped handover snapshot. **Performance acceptance remains open.** This is not a 9/10 or physical-headset certification.

The desktop and Quest sessions now resolve lazily without pulling preview fixture tapes into ordinary visits. Failed Quest panel loads dispose their successful sibling, return safely to Home even after Pause, and can be retried. Banner dissolution preserves the current banner when storage refuses removal. Quest has the shared Play action in its reachable tray and on Awaiting the board.

Desktop inspector navigation avoids unnecessary layout reads, uses a bounded cache of exact heraldry paths and retains its frame while resetting the scroll body and inspector state. The original entry motion and reduced motion remain verified. No private canon or new lore was introduced.

## Verification

| Check | Result |
| --- | --- |
| Desktop and Quest production builds / TypeScript | Pass; existing size/third-party annotation advisories remain |
| Shared domain | 73 tests pass |
| Existing chess bridge | 18 tests pass; protected chess source unchanged |
| Quest state/domain | 127 tests pass |
| Desktop heraldry cache | 2 exact-output/eviction tests pass |
| Shared/generated UI and assets | Pass: 499 Legacy elements, 133 controls, plus existing menu checks |
| Production lazy module graph | Pass in both apps; fixture tapes have separate chunks |
| Desktop browser verification | 30 full groups; 16 final focused regressions and 2 native motion groups pass |
| Quest real emulated hand flow | 17 checks pass, with controllers disconnected |
| Quest launch comparison | 3 groups pass: with/without a saved banner, no startup Legacy resources or Legacy save reads |
| Quest load failure / failure after Pause | 3 / 4 actual input checks pass |
| Current captures | 8 desktop and 34 Quest images; 22 selected images packaged in the review PDF |

Quest verifies founding, both hands, fingertip presses, all landmarks, nomination, stated wager/acceptance, tracking loss, explicit Resume, recentering without moving the viewer, Exit/re-entry and persisted reload. Play returns are exercised from founding, inspectors, reset confirmation, Pause and Awaiting the board. Recovery captures assert the exact corrupt/newer save is preserved. Text Size 125%/150%, standing and captive aftermath acknowledgement are captured.

## Open acceptance gates

- The last quiet desktop trace records cold script mean/p95 **5.65/23.65 ms** and repeated **3.76/10.14 ms**. The targets are 4 ms mean and 8 ms p95. Both unthrottled cases had zero page long tasks; 4× CPU still produced long tasks. Raw keydown/thread/layout data confirms genuine remaining work. Earlier and contended traces remain historical evidence, not passes.
- Quest mono emulation records 70 draws / 23,308 triangles. Its isolated Legacy update averages 0.00558 ms, while whole-emulator script time is 48.60 ms/frame. These different scopes must not be conflated. Allocation sampling found 468 bytes over 20,000 updates; zero allocation and its recurring slope are not established.
- Physical Quest stereo, tracking, direct-touch reach for a person, fine readability, comfort, cold start and frame pacing remain unverified. A compact independent visual review found no definite clipping, overlap, contrast or theme failure; it cannot certify fine text or labels covered by the SDK automation overlay.
- Launch to the first legal move is unavailable because this menu is not connected to the creator's chess port. The evidence times access to the existing Play menu instead. The protected chess/Play implementation was not changed to manufacture a measurement.
- Stable GPU resource counts across five desktop round trips and a small post-GC heap increase do not establish leak freedom.

The follow-up inspector vector-image experiment passed 144 pixel comparisons, first-frame readiness, geometry and accessibility checks, but repeated navigation regressed to 5.03/21.60 ms mean/p95. It was reverted. Its patch and negative evidence remain in `main game/artifacts/legacy/codex-round-2/vector-image/`; runtime source retains the verified `cd0f657` baseline. Both production builds passed again after rollback.

[Desktop evidence](../../main%20game/artifacts/legacy/codex-round-2/README.md) · [Quest evidence and review PDF](../../main-game-vr/artifacts/legacy/codex-round-2/README.md)

Branch integration, PR creation and publication remain owner decisions under the handover. No branch merge, deployment or new PR is part of this checkpoint.
