# My Legacy — parallel workflows and integration contract

My Legacy is produced by two parallel workflows with disjoint ownership. They coordinate only
through the contract files and seams listed here.

| | Gameplay workflow | Environment workflow |
| --- | --- | --- |
| Branch | `feat/my-legacy` (stacked on `feat/main-game-menu`) | `feat/legacy-world-environment` (stacked on `feat/my-legacy`) |
| Checkout | `/home/user/crownfall` | worktree `/home/user/crownfall-env` |
| Owns | chess bridge, national-muster rules, capture consequences, political state, saves, heraldry content and raster, navigation and entry points, Legacy screens/panels, input mapping, VR interaction flows, menu systems, stand-in environment | environment direction and blueprint, Bannerhold layout, terrain, architecture, vegetation, infrastructure, dressing, storytelling and settlement life, cinematic camera and VR staging, environment asset pipeline, desktop and Quest environment renderers, landmark picking adapters, environment fixtures, optimisation and environment documentation |
| Brief | `docs/legacy/BRIEF.md` | `docs/legacy/ENVIRONMENT_BRIEF.md` (plus `BRIEF.md` for context) |
| Report | `docs/legacy/MY_LEGACY_REPORT.md` | `docs/legacy/environment/ENVIRONMENT_REPORT.md` |

Neither workflow merges into the other's target or into `main` without the product owner's
authorisation. The environment branch may merge `feat/my-legacy` *into itself* at stage boundaries
to pick up gameplay state, content and heraldry (a stacked-branch sync); gameplay never merges the
environment branch.

## Contract (orchestrator-owned — request changes, do not edit)

- `shared/legacy/types.ts` — domain, persistence and `BannerholdPresentation`.
- `shared/legacy/environment-contract.ts` — `LegacySceneState`, `LegacyEnvironmentBase`,
  `LEGACY_LANDMARKS`, `TINCTURE_SRGB`, stats and landmark descriptors.
- `main game/src/legacy/environment-contract.ts` — `CreateDesktopLegacyEnvironment` and the
  desktop environment interface (camera, orbit nudges, label projection).
- `main-game-vr/src/legacy/environment-contract.ts` — `CreateQuestLegacyEnvironment` and the
  Quest environment interface (per-frame update, posture, staging info for panel placement).

Gameplay produces `LegacySceneState` with `presentBannerhold` / `presentFoundingDraft`. The
environment renders it and reports landmark hover/select; it never reads saves and never
calculates results or consequences.

## Seams (already wired — neither workflow edits the other's files)

| Seam | Owner of the implementation | Consumer |
| --- | --- | --- |
| `main game/src/legacy/environment/createLegacyEnvironment.ts` exporting `createLegacyEnvironment: CreateDesktopLegacyEnvironment` | environment | gameplay's `main game/src/legacy/environment-provider.ts` discovers it with a lazy `import.meta.glob` and falls back to the gameplay stand-in |
| `main-game-vr/src/legacy/environment/createLegacyEnvironment.ts` exporting `createLegacyEnvironment: CreateQuestLegacyEnvironment` | environment | gameplay's `main-game-vr/src/legacy/environment-provider.ts`, same pattern |
| `main game/src/legacy/environment/harness.ts` exporting `mountLegacyEnvironmentHarness(root)` | environment | `main game/src/main.tsx` when the URL has `?legacyEnvironment` |
| `main-game-vr/src/legacy/environment/harness.ts` exporting `registerLegacyEnvironmentHarness(world)` | environment | `main-game-vr/src/index.ts` when the URL has `?legacyEnvironment` |
| `scripts/sync-legacy-environment-assets.mjs` exporting `syncLegacyEnvironmentAssets()` | environment | `main-game-vr/vite.config.ts` (startup and build) |
| `scripts/check-legacy-environment.ts` exporting `checkLegacyEnvironment()` | environment | `scripts/check-menu-sync.ts`, so `npm run check:sync` covers environment assets |
| `shared/legacy/tests/environment-*.test.ts` | environment | gameplay's `npm run test:legacy` glob |

## File ownership

**Gameplay:** `shared/legacy/content/**`, `shared/legacy/domain/**`, `shared/legacy/heraldry/**`,
`shared/legacy/tests/` except `environment-*`, `shared/menu/**`, `web/**`, root `package.json`,
root `README.md`, `scripts/` except the two environment files above, `main game/**` except
`main game/src/legacy/environment/**`, `main game/public/assets/legacy/environment/**`,
`main game/scripts/*environment*` and `main game/artifacts/legacy-environment/**`, and
`main-game-vr/**` except `main-game-vr/src/legacy/environment/**`,
`main-game-vr/scripts/*environment*` and `main-game-vr/artifacts/legacy-environment/**`.

**Environment:** `shared/legacy/environment/**`, `shared/legacy/tests/environment-*.test.ts`,
`main game/src/legacy/environment/**`, `main game/public/assets/legacy/environment/**`,
`main game/scripts/*environment*.mjs`, `main game/artifacts/legacy-environment/**`,
`main-game-vr/src/legacy/environment/**`, `main-game-vr/scripts/*environment*.mjs`,
`main-game-vr/artifacts/legacy-environment/**`, `scripts/sync-legacy-environment-assets.mjs`,
`scripts/check-legacy-environment.ts`, `scripts/*legacy-environment*.{ts,mjs}`,
`docs/legacy/environment/**`.

**Orchestrator:** the contract files above, `docs/legacy/BRIEF.md`, `ENVIRONMENT_BRIEF.md`,
`WORKFLOWS.md` and `shared/legacy/README.md`.

## World canon and confidentiality

Crownfall's world canon is maintained privately by the creator and is never committed to this
repository. Agents receive the private canon brief through their task instructions, outside version
control; never copy its text, named institutions, languages or history into any committed file.
Committed work uses only public-safe setting detail — Crownfall as the world and the King's Gambit as
its chess-derived conflict institution, Year 33 of the Ash & Aether Interregnum, and the four nations
Korvenia (occult Grand Duchy), Solforiz (sulfur-industrial Scorched Caliphate), Aethelgard (primordial
Blood-Throne) and Kwind-09 (industrial/cyberpunk Kwind Zaibatsu) — plus plain descriptive language.
Every name, rule or lore element an agent invents is a working placeholder pending creator approval:
keep it in replaceable content files and never present it as canon. Legacy prototype names from
`web/` are not nation canon. Player-facing copy says "the capital" rather than inventing capital
names, and adds no lore about the player. Critics treat invented canon presented as established,
lore leaks and contradictions of the canon brief as blockers.

## Performance standard

Both workflows must meet `docs/legacy/PERFORMANCE.md`: smooth, lag-free browser performance,
per-platform budgets, no long tasks during interaction, no leaks, and its measurement protocol in
every evidence round. Critics treat violations as blockers.

## Shared machine resources

- Desktop dev servers: gameplay uses ports 5173 and 5180–5189; environment uses 5174–5179.
- IWSDK runtime: at most one per checkout. When port 8081 is taken Vite moves to the next free port,
  so always read the URL from `npx @iwsdk/cli dev status`. Bring runtimes down when finished.
- The host has 4 CPUs and no GPU (software WebGL). Frame timings measured here are not
  representative and never stand in for physical Quest validation.
