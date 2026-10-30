# My Legacy Quest evidence

[Review PDF — 22 selected desktop/Quest captures](Crownfall-Legacy-Review.pdf) · [Compact comparison](ui-runtime-review.jpg)

All Quest images come from an active IWER Quest 3 session with actual emulated hand input and both controllers disconnected. The scripts use a closer mono view, software rendering and a development framebuffer scale of 0.25; these are not physical-headset screenshots or performance measurements.

| Evidence | Result |
| --- | --- |
| `verification.json` | 17 full hand-flow checks pass; six captures |
| `chessfirst-verification.json` | 3 groups pass; startup with/without save avoids Legacy resources and save reads; hand access to Play |
| `loading-failure.json` | 3 checks pass after an actually rejected dock fetch; Home/Play remain usable and retry creates exactly two panel entities |
| `paused-loading-failure.json` | 4 checks pass, including an actual Pause before the held request fails; no automatic retry loop |
| `stored-capture-evidence.json` | 8 captures and 6 actual one-action returns to Play, including inspectors, reset confirmation and Pause |
| `comfort-125-` / `comfort-150-capture-evidence.json` | 3 captures each, including level view and full wager |
| `standing-capture-evidence.json` | 3 captures |
| `preview-captive-capture-evidence.json` | 9 captures, including aftermath, recorded consequences and acknowledgement |
| `recovery-corrupt-` / `recovery-future-capture-evidence.json` | Correct recovery session asserted; unreadable save remains byte-identical |

The three `loading-failure-initial/startup/route-unmatched.json` files preserve failed harness probes. They are not passed application tests. The final fault test uses a durable app-realm fetch rejection with a positive hit count; no UI activation is injected by the browser runner.

The isolated Legacy update averages 0.00558 ms, with a 468-byte sampled allocation residual over 20,000 updates. Whole-emulator script time is 48.60 ms/frame. Mono counts are 70 draws / 23,308 triangles. None establishes stereo/headset performance or zero allocation.

Independent review of the single compact sheet found no definite clipping, overlap, contrast or theme break. Fine text and tray labels obscured by the SDK blue automation pill are outside that visual check. Physical Quest legibility, comfort, tracking, reach, stereo, cold start and frame pacing remain pending. Gameplay remains unconnected.
