# Crownfall: handover from Claude to Codex

*Written 29 October 2026, about 22:10 UTC, when the creator moved the work from Claude to Codex. The same
file is committed on all four feature branches below, so it can be read from any of them.*

## 0. Read this first

**Who decides.** The creator (Miles) approves lore, names, merges, deploys and pull requests. Nothing
on these branches is merged. Open draft PRs only, and only when the creator asks.

**Ground rules.** These rules held for all Claude work, and the creator set them:

1. **No merge, deploy or force-push** without the creator's explicit authorisation. Draft PRs only.
2. **Chess is finished in the creator's local copy** and will be ported later. Do not edit `web/` (the
   chess core and campaign), the Play screens or `main-game-vr/src/chess/`. The one exception is the
   Legacy bridge in `web/src/legacy/` on `feat/my-legacy`.
3. **Chess comes first.** See "Chess comes first" in `docs/legacy/BRIEF.md`:
   - My Legacy never gates play, and every path leads back to the board;
   - only chess changes the house;
   - no currencies, timers or grind;
   - founding takes under two minutes, and the aftermath is at most two messages;
   - Legacy code is lazy-loaded.
4. **Canon is private.** The world canon is maintained privately and is never committed (see "World
   canon and confidentiality" in `docs/legacy/BRIEF.md`). The creator will give you the private canon
   brief separately. Never copy it, or the creator's linguistic atlas, into the repo, commit messages,
   captions or screenshots.
   - Wording rules: describe the player as "the player" in code and docs and as "your banner" or
     "your house" in copy; player-facing copy says "the capital" and invents no capital or ruler
     names; no names that echo other franchises.
   - Don't invent lore. Unapproved names are working placeholders in replaceable content files.
5. **Follow `AGENTS.md`.** Keep desktop (`main game/`) and Quest (`main-game-vr/`) in parity, take
   shared labels from shared modules, never hand-edit generated files, run both builds and
   `npm run check:sync`.
6. **Evidence and honesty.**
   - Emulator and SwiftShader captures are not evidence of headset frame rate or comfort.
   - Nothing here has been verified on a physical Quest.
   - Never claim unverified passes.
7. **Assets:** original or properly licensed only, with provenance recorded. The public repo
   redistributes everything committed.

**State at handover.** Every Claude workflow was stopped mid-task. Their last files on disk were
committed as `wip(...)` snapshots. **Typecheck and tests were not run on the latest snapshot commits.**
Start each branch with a full verification run.

## 1. Branch map

All four branches come from `feat/main-game-menu` at `29343c1` (draft PR #1, which the creator owns
and which is untouched).

| Branch | Head before the handover commit | What it holds | State |
| --- | --- | --- | --- |
| `feat/my-legacy` | `1229443` | My Legacy gameplay: shared domain, heraldry, persistence, chess bridge, desktop and Quest flows | Round-1 critic fixes part-done |
| `feat/legacy-world-environment` | `adfbd69` | The Bannerhold: blueprint, docs, desktop and Quest renderers, manor and landmarks | Pipeline, Quest renderer, manor and landmarks done; settlement and nation variants had just started |
| `feat/legacy-characters` | `80957e5` (no commits yet) | Rigged characters from free CC0 packs | Planned; vendor files downloaded privately |
| `feat/chronicles-archive` | `8d9abf5` | Chronicles, the Home archive (Brief E plus the archive directive) | M0 done, M1 part-done |

**Integration has not happened yet.**
- `feat/my-legacy` and `feat/legacy-world-environment` diverged at `0f4d3e9`, and each now has more
  than a dozen commits the other lacks.
- Both carry copies of the same `docs/legacy/*.md` commits, so expect doc conflicts when merging.
- The environment branch still uses a fallback heraldry adapter. Swapping in gameplay's
  `rasterizeHeraldry` is documented as a one-line change.
- Claude previewed the two together only in a local, unpushed overlay.

## 2. My Legacy gameplay — `feat/my-legacy`

**Specs:** `docs/legacy/BRIEF.md`, `docs/legacy/WORKFLOWS.md` (ownership, the environment contract and
seams), `docs/legacy/PERFORMANCE.md`, `shared/legacy/README.md`, `shared/legacy/types.ts`,
`shared/legacy/environment-contract.ts`.

**Built:**
- **Shared domain** (`shared/legacy/`): content, names, houses, the muster, aftermath, matches,
  wagers and persistence, plus the heraldry rasteriser and tests.
- **Chess bridge** (`web/src/legacy/musterBridge*`): it plays real games through the engine and
  recorder, covering castling, en passant and capture-promotion.
- **Desktop flow** (`main game/src/legacy/`): founding ceremony, the four landmarks (Banner Hall,
  Muster Grounds, Herald's Station, War Record), panels, aftermath card and a stand-in environment.
- **Quest flow** (`main-game-vr/src/legacy/`): generated UIKitML panels, hands-first ray and pinch,
  staging, persistence and a stand-in environment.

**Round-1 critic scores:** technical 7.4 (5 blockers), experience 6.7 (7 blockers), VR interaction 6.3
(8 blockers). Target is 9 or more with no blockers.

**Fixed after round 1:**
- **Shared domain (finished):** War Record wording replaced "Chronicle" in player copy (a test now
  guards it); the franchise-echo suggestion was renamed (placeholder "The Longhall Levy"); title and
  grammar fixes; real-engine special-move tests; aftermath length budget (title 44, body 125
  characters); new shared labels; a lazy preview loader (`shared/legacy/domain/preview-loader.ts`).
- **Desktop (part-done):** error boundary with Retry and Return to Home around the lazy Legacy route; a
  chess-first next-step strip; a Banner Hall primary action and Manage-banner disclosure. Chess-first
  measurements were in progress.
- **Quest (part-done):** lazy-loaded Legacy panels (the scene no longer embeds the panel), staging and
  copy work.

**Still open: the finish-line list for round 1.**
1. Quest: load My Legacy lazily, end to end. Check the startup chunk carries no Legacy code or the
   "House Vesperine" fixture, and that a Legacy failure cannot break Home.
2. Record the chess-first measurements in both `verify-legacy.mjs` scripts: launch to first move, with
   and without a saved banner, and actions from any Legacy screen back to a match.
3. Desktop performance per `PERFORMANCE.md`:
   - long tasks during orbit drag;
   - script p95 over 8 ms;
   - founding typing mean over 4 ms;
   - gamepad polling cost;
   - stand-in `setState` invalidation;
   - attribute entry long tasks.
4. Quest captive Muster Grounds note repeats "Their place stands empty."
   (`main-game-vr/src/legacy/legacy-view-model.ts`, around lines 489–491).
5. Quest wager legibility. It is about 85 words in the smallest style at 1.4 m; restructure it and
   enlarge the text.
6. Quest panels sit above eye level, grow upward with Text Size and ignore Menu Distance. Direct touch
   is promised but every target is out of reach.
7. Quest parity with desktop: War Record Conflicts and Unresolved matters sections, banner allegiance
   in Pawn inspection, and the stake descriptions in the Herald's Station and Muster Grounds.
8. Quest dock says "Saved on this device" when nothing is saved.
9. Both apps:
   - switch to the new shared labels (`LEGACY_COPY.principle`, `reset`, `houses`, `readiness`,
     `fate`, `preview.locked`);
   - resolve the session with `resolveLegacySessionLazily`;
   - then delete the static fixtures default in `shared/legacy/domain/persistence.ts`.
10. Evidence that was never captured on Quest:
    - War Record, Herald's Station list, founding confirm, Accept confirmation, Awaiting the board,
      reset confirmation, corrupt or future save recovery, acknowledging an aftermath;
    - standing posture, and 125% and 150% Text Size.
11. Docs still saying "Chronicle": `shared/legacy/README.md` and parts of `docs/legacy/BRIEF.md`.

**Verify:**
- From the repo root: `npm run test:legacy`, `npm run test:legacy:engine`, `npm run test:quest`,
  `npm run check:sync`, `npm run build`.
- Desktop: `main game/scripts/verify-legacy.mjs` and `capture-legacy.mjs`.
- Quest: `main-game-vr/scripts/verify-legacy.mjs` and `capture-legacy.mjs`, using the IWSDK CLI with
  IWER hands-only emulation.
- Development URLs: `?legacyPreview=<id>` (fixtures, never saved) and `?legacy=fresh` (guest).

## 3. The Bannerhold environment — `feat/legacy-world-environment`

**Specs:**
- `docs/legacy/ENVIRONMENT_BRIEF.md`: the bar. It includes the character occlusion reveal, the
  regional map plan, library decisions and the inscriptions section.
- `docs/legacy/environment/`: `BIBLE.md`, `STYLE_GUIDE.md`, `TECHNICAL_SPEC.md` and one
  `NATION_*.md` per nation.

**Built:**
- **Blueprint** (`shared/legacy/environment/blueprint/`): Korvenia in full; Solforiz, Aethelgard and
  Kwind-09 as first passes. Maps and tests are included.
- **Shared kernel, kits and material library:** 87 baked WebP textures.
- **Desktop renderer** (`main game/src/legacy/environment/`): PBR, ACES, one shadow-casting key light,
  fog, nation skies (Korvenia's eclipse), optional post, cinematic camera rig and picking.
  - Harness: `?legacyEnvironment&nation=&fixture=&view=&quality=&post=`.
  - Captures: `main game/scripts/capture-legacy-environment*.mjs`.
- **Quest renderer** (`main-game-vr/src/legacy/environment/`):
  - 1:125 tabletop miniature, seated and standing staging, landmark proxies (ray and poke);
  - the **occlusion reveal**: a sphere sweep, a dithered world-space mask with noise, shadows kept
    (`shared/legacy/environment/vr/reveal.ts`, `shaderPatch.ts`);
  - harness and capture script.
- **Gothic manor and landmark kits:** Banner Hall, Herald's Station, Muster Grounds, War Record.

**Measured** (software rendering, so frame times are not representative):
- **Quest, per eye:** Korvenia 66 draws and 177k triangles for the environment alone, 79 draws and
  188k for the whole frame. Budget is 120 draws and 250k triangles. The draw upper bound is 107 of
  120, which leaves little headroom.
- **Desktop High:** the in-view estimate is 162 draws and 1.03M triangles, within 400 and 1.5M.
  `renderer.info` totals over all passes are 230–280 draws and 2.85–2.90M triangles, because shadow,
  GTAO normal and post passes all count.
  - **Correction:** earlier notes, including "Known overage to fix" in `ENVIRONMENT_BRIEF.md`, called
    these overages using totals for both eyes and all passes. `PERFORMANCE.md` budgets "triangles in
    view". Agree the measurement method with the creator before treating them as blockers, and
    update the brief.
- **Medium headroom:** 8 draws at tier 3 (192 of 200).

**Known gaps:**
- The player's heraldry still uses the fallback adapter.
- Desktop light gates are ignored (tier-1 braziers cast no light), and the herald door and armoury
  close-ups are dark at Medium.
- The ashlar texture reads as brick.
- War Record markers are inside the building and cannot be seen from any exterior view.
- No tier-3 expansion buildings, and no highlight on the nominated file stone.
- Smaller defects:
  - the dressing crane stays after the West Range is built;
  - the Court Gate arch draws about 2 m in front of the gate face;
  - a notice board hides the rival correspondence hook;
  - the `buildBannerhold` chunk is 503 kB.
- Textures are uncompressed RGBA. KTX2/Basis was not done.
- The `?legacyEnvironment` seam ships as a lazy chunk in production builds.
- Rotation and the reveal trigger on Quest are development extras, not contract calls.
- Art direction (creator-director review):
  - trees and topiary are faceted blobs;
  - large walls show regular tiling;
  - Kwind-09 on Quest reads as dark boxes and needs its steam, sodium-lamp and verdigris identity.

**Not started** (the stages Claude did not reach):
1. Settlement and landscape.
2. Nation variants. Unreferenced first files exist in `kits/korvenia/` and `kits/nations/`.
3. A sync with gameplay.
4. Settlement life and story.
5. Light and camera, including the desktop occlusion reveal.
6. The critic loop and the report.
7. The regional map of the player's nation: a later increment, specified in the brief.

## 4. Characters — `feat/legacy-characters`

**Creator decision (29 Oct):** use only the **free Standard tiers** of four Quaternius packs. All are
CC0 1.0, and the licence file inside each archive confirms it. No purchases.

| Pack | Free archive (sha256, bytes) | What it contains |
| --- | --- | --- |
| Modular Character Outfits – Fantasy | `c3468b18871cc8c8f05ab14df7712baf22cb9f389cbd870babf130e595187f70`, 294,347,394 | Peasant and Ranger outfits, male and female |
| Universal Base Characters | `fdbf1804c90dfc1ea03e992bff7da2dfd1a79318e13270a660180f9308455f40`, 128,968,391 | Superhero male and female bodies (use the head only), 6 hair and 2 eyebrow meshes |
| Universal Animation Library | `cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724`, 15,904,933 | 43 clips |
| Universal Animation Library 2 | `4008ea208a604773a2b2177d965f0f5d3195498b5bf838c3f5785d68e95f2a68`, 18,735,003 | 43 clips |

- **Sources:** the official itch.io pages (`quaternius.itch.io/...`), downloaded 29 Oct 2026, 21:33 UTC.
- **Do not commit the raw archives.** Commit only derived, optimised GLBs, the verbatim licence texts
  and a provenance file.
- **Freeze these versions.** Quaternius' newer kits use the "Quaternius Asset License" (QAL), which
  forbids redistribution. Never use a QAL kit, and re-check the licence before taking any update.

**Plan (not yet built):**
- **One skeleton.** All four packs share the same 65 joints with Unreal-mannequin names.
  - Retarget the animation clips onto the production rest pose: neck rest rotation differs by
    17–23°, and joint offsets reach 8.4 cm (15.7 cm at the female fingertips).
  - Never ship the default `Idle_Loop` for villagers; it is a fists-clenched superhero stance.
- **Assembly.** UBC head on MCOF outfit bodies. Rebuild materials: the free glTFs reference two
  missing normal maps.
- **Author as original work in Blender:**
  - Korvenian garments: guard coat over cuirass and gorget, herald capelet and veil, smith apron,
    civilian wool;
  - a heraldic tabard UV-mapped to the heraldry atlas banner tile, undyed before founding;
  - clips no pack has: salute, bow, kneel, a ceremonial stance, and yield (lay down arms).
- **LODs:** 6k, 2k and 800 triangles. A decimation test showed 6k looks the same as full and 2k still
  reads well; at 800 the hems and boots tear.
- **Crowd:** bake 8–12 frames per loop into morph targets and draw with `InstancedMesh`. Aim for at
  most 6 draws per nation, replacing about 29 procedural figure prototypes.
- **Budgets:**
  - desktop representative ≤25k triangles and ≤4 materials;
  - Quest representative ≤3k triangles and ≤2 draws;
  - Quest crowd ≤800 triangles per figure;
  - all Quest characters ≤12 draws.
- **Gaps:**
  - no child body in the free tiers; do not shrink adults;
  - no mounts;
  - a lacquer half-mask for heralds needs creator approval.
- **Integration:** swap the procedural figures in `shared/legacy/environment/kits/figures/` (the
  inputs are `AgentBinding`, NPC schedules and `SLOT_SETS`).

## 5. Chronicles — `feat/chronicles-archive`

**Start with `docs/chronicles/WORK_STATUS.md`** (the resume document; written at the end of M0), then
`ARCHITECTURE.md` and `ARCHIVE_BLUEPRINT.md`. The creator's archive directive (milestones M0–M7)
and the approved content pack are private and come from the creator.
- **Only approved content ships.** Rows marked for review stay out until the creator approves them,
  and gaps are never filled with invented lore.
- The guarded-phrase test in `shared/chronicles/content.test.ts` must keep passing.

**Done since the M0 status was written:**
- the content-status layer (`shared/chronicles/status.ts`);
- the archive blueprint and its generator (`scripts/chronicles/generate-archive-blueprint.ts`);
- kit pieces in `shared/chronicles/archive/`, including the arcade and the coffered vault with oculus;
- scene state (`shared/chronicles/scene-state.ts`).

Blueprint acceptance (gate G1) is not recorded in `WORK_STATUS.md`. The desktop and Quest M1 hall
integration was in progress at the stop.

**Known broken** (see `WORK_STATUS.md`):
- `main game/scripts/verify-chronicles.mjs`: the last recorded run failed.
- The home-artwork hash manifest describes the original painting instead of the delivered map.
- `main-game-vr/scripts/capture-chronicles.mjs`: the last recorded run failed.

Re-run all three before continuing.

## 6. Open creator decisions

- **Chronicles map:** variant "B" is installed as the working choice. The world map's centre stays
  empty unless the creator says otherwise. Painted labels in the map art (for example "River of Dead
  Kings") await approval.
- **Chronicles content:** the content pack and the rows marked for review.
- **My Legacy placeholders:** the principle line ("You move the entire formation, but not everyone on
  the board belongs to your house.") and "The Longhall Levy".
- **Characters:** the herald half-mask.
- **Physical Quest:** comfort, legibility and frame-rate checks need a real headset.

## 7. Technical constraints worth keeping

- **Quest:** IWSDK 1.1.0-rc.2. Import Three only from `@iwsdk/core`; use `world.createTransformEntity`,
  `entity.dispose()`, `AssetManager`; no per-frame allocation. Budget is ≤120 draws and ≤250k
  triangles in view.
- **gltfpack:** quantisation only (`KHR_mesh_quantization`). Never `-c` or `-cc` for anything Quest
  loads, because IWSDK configures only Draco and KTX2 decoders.
- **Library decisions** (see `ENVIRONMENT_BRIEF.md`): meshoptimizer adopted at build time only;
  Jolt, Recast and ozz rejected, with reopen triggers.
- **Shared code** under `shared/` is pure TypeScript and must typecheck for desktop (ES2022 lib) and
  Quest (target ES2020, default lib).

## 8. Suggested order

1. On `feat/my-legacy`: run full verification, finish the open round-1 list in §2, verify, and push.
2. Merge `feat/my-legacy` into `feat/legacy-world-environment`, resolve the doc conflicts, swap in
   `rasterizeHeraldry`, and verify both apps with the real environment instead of the stand-in.
3. Environment: work through the remaining stages in §3, and agree the measurement method for the
   performance budgets with the creator.
4. Characters: work through the plan in §4 on `feat/legacy-characters`, then integrate it into the
   environment's figure kit.
5. Chronicles: re-run its suites, finish M1, then continue the milestones in the creator's directive.
6. Run a browser performance audit of the integrated build.
7. Open draft PRs only when the creator asks.
