# My Legacy verification — 30 October 2026

Functional verification checkpoint on `feat/my-legacy`, continuing the stopped handover snapshot. **Performance acceptance remains open.** This is not a 9/10 or physical-headset certification.

The desktop and Quest sessions now resolve lazily without pulling preview fixture tapes into ordinary visits. Failed Quest panel loads dispose their successful sibling, return safely to Home even after Pause, and can be retried. Banner dissolution preserves the current banner when storage refuses removal. Quest has the shared Play action in its reachable tray and on Awaiting the board.

Desktop inspector navigation avoids unnecessary layout reads, uses a bounded cache of exact heraldry paths and retains its frame while resetting the scroll body and inspector state. Round 3 also fixes a positively identified focus race: the outgoing overview releases its focused label before hiding, preventing React from restoring a hidden label and ten ancestor scroll positions. The original primary-action focus, entry motion and reduced motion remain verified. No private canon or new lore was introduced.

## Verification

| Check | Result |
| --- | --- |
| Desktop and Quest production builds / TypeScript | Pass; existing size/third-party annotation advisories remain |
| Shared domain | 73 tests passed at round 2; unchanged in round 3 |
| Existing chess bridge | 18 tests passed at round 2; protected chess source unchanged |
| Quest state/domain | 127 tests passed at round 2; unchanged in round 3 |
| Desktop heraldry cache | 2 exact-output/eviction tests pass |
| Shared/generated UI and assets | Pass: 499 Legacy elements, 133 controls, plus existing menu checks |
| Production lazy module graph | Pass in both apps; fixture tapes have separate chunks |
| Desktop browser verification | Round 2: 30 full groups, 16 focused regressions and 2 motion groups. Round 3: 11 affected groups, exact 12-inspector geometry comparisons, full performance collection and tightened native Tab regression pass |
| Quest real emulated hand flow | 17 checks pass, with controllers disconnected |
| Quest launch comparison | 3 groups pass: with/without a saved banner, no startup Legacy resources or Legacy save reads |
| Quest load failure / failure after Pause | 3 / 4 actual input checks pass |
| Current captures | Round 2: 8 desktop and 34 Quest images, with a 22-page review PDF. Round 3: two fresh desktop/landscape captures and a compact independent review |

Quest verifies founding, both hands, fingertip presses, all landmarks, nomination, stated wager/acceptance, tracking loss, explicit Resume, recentering without moving the viewer, Exit/re-entry and persisted reload. Play returns are exercised from founding, inspectors, reset confirmation, Pause and Awaiting the board. Recovery captures assert the exact corrupt/newer save is preserved. Text Size 125%/150%, standing and captive aftermath acknowledgement are captured.

## Open acceptance gates

- The round-3 focused desktop comparison records cold script mean/p95 **6.39/27.57 ms** and repeated **4.15/17.79 ms**, against targets of 4/8 ms. The full-protocol inspector scenario records **7.72/34.39 ms**. No unthrottled interaction long tasks occurred in the full run, but 4× CPU remains over budget with long tasks. The specific repeated-input maximum thread time fell from 9.72 to 3.90 ms and nested input Layout time fell from 11.11 to zero; that proves a useful correction, not a full budget pass. Cold timing did not improve. All prior observations remain historical evidence.
- Quest mono emulation records 70 draws / 23,308 triangles. Its isolated Legacy update averages 0.00558 ms, while whole-emulator script time is 48.60 ms/frame. These different scopes must not be conflated. Allocation sampling found 468 bytes over 20,000 updates; zero allocation and its recurring slope are not established.
- Physical Quest stereo, tracking, direct-touch reach for a person, fine readability, comfort, cold start and frame pacing remain unverified. A compact independent visual review found no definite clipping, overlap, contrast or theme failure; it cannot certify fine text or labels covered by the SDK automation overlay.
- Launch to the first legal move is unavailable because this menu is not connected to the creator's chess port. The evidence times access to the existing Play menu instead. The protected chess/Play implementation was not changed to manufacture a measurement.
- Fifteen identical desktop round trips kept 246 DOM nodes, 217 listeners and renderer resources constant; post-GC heap grew from 7.23 to 7.90 MB. A separate warmed 15→30-trip snapshot check kept its own DOM/listener/resource counts constant and attributes almost all snapshot self-size growth to compiled code and browser native data. Ordinary objects/arrays changed by only 156 bytes net in that window. No unbounded application store was identified, but a strict heap plateau and universal leak freedom remain unproven.

The round-2 vector-image experiment was reverted after repeated navigation regressed. Its patch and negative evidence remain in `main game/artifacts/legacy/codex-round-2/vector-image/`. Round 3 also reverted inspector-body layout/style containment after exact geometry checks passed but timing did not materially improve. Runtime source builds on the verified baseline with only the focused overview-release correction. Both production builds, desktop cache tests, sync and lazy module-graph checks passed again.

[Round-3 desktop evidence and captures](../../main%20game/artifacts/legacy/codex-round-3/README.md) · [Round-2 desktop evidence](../../main%20game/artifacts/legacy/codex-round-2/README.md) · [Quest evidence and review PDF](../../main-game-vr/artifacts/legacy/codex-round-2/README.md)

Branch integration, PR creation and publication remain owner decisions under the handover. No branch merge, deployment or new PR is part of this checkpoint.
