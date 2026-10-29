# shared/legacy — My Legacy domain

Platform-independent state, rules, content, scene descriptions and geometry for My Legacy.
Desktop (`main game/`, standard `three`) and Quest (`main-game-vr/`, IWSDK super-three) consume the
same modules through their own renderers and interaction adapters. Read `docs/legacy/BRIEF.md`
for the product direction.

## Hard rules

- No imports of `three`, `@iwsdk/*`, React, DOM, `localStorage`, timers, `Date.now()` or
  `Math.random()` anywhere under `shared/legacy/`. Callers pass timestamps and seeds in.
- Geometry and textures are produced as plain typed arrays (`Float32Array`, `Uint32Array`,
  `Uint8ClampedArray`). Each platform converts them into its own runtime objects.
- Every transition is a pure, deterministic function. Same input → byte-identical output.
- `types.ts` is the cross-team contract. A persisted-shape change bumps `LEGACY_SCHEMA_VERSION`
  and adds a migration plus tests.
- Never fabricate production history. Fixture match records (`source: "fixture"`) are accepted only
  by `mode: "preview"` states, which every persistence path refuses to save.

## Layout

| Path | Responsibility |
| --- | --- |
| `types.ts` | Domain, persistence and presentation contracts |
| `content/` | Nations, availability config, heraldry vocabulary and suggestions, external houses, member name pools, Muster file claims, shared UI copy |
| `domain/` | `reduceLegacy`, founding, nomination, match processing, politics, chronicle, aftermath selection, presentation view-model, Muster formation for the engine bridge, persistence/migration, preview fixtures |
| `heraldry/` | Heraldry → RGBA rasters for standards, shields and UI previews |
| `textures/` | Procedural material textures → RGBA rasters |
| `mesh/` | Pure geometry kernel and architecture, terrain, prop and figure builders |
| `scene/` | Per-nation Bannerhold layouts, camera framings, lighting presets, quality tiers, VR diorama constants, `buildBannerhold()` |
| `tests/` | `node:test` suites (`npm run test:legacy`, also run by `npm run test:quest`) |

## Legacy rules v1

**Founding.** Allowed only when no banner exists (or after `reset`). Name is trimmed, 2–28
characters of letters, spaces, apostrophes or hyphens. The nation must be `available` or `preview`
in the availability config. Founding generates three house members deterministically from the
nation name pools and the seed, sets rank `minor-banner`, recognition 0, representation 1, creates
relations with the nation's allied Great House (starts disdainful) and its foreign rival house
(starts wary), writes a `founding` chronicle entry, and posts two notices: the allied Great House's
**Muster summons** and the rival house's **formal challenge**. The challenge is a Muster conflict
and states its national wager in plain words before any match.

**Nomination.** One available member and one eligible file. The allied Great House and other
banners claim some files (content-defined); a minor banner chooses from what remains. The file
changes identity and narrative stakes only. The formation is always the standard chess position.

**Formation for the engine bridge.** `createMusterFormation` produces the starting identity map and
allegiance for the standard position: `player:<memberId>` on the nominated pawn square,
`ally:<houseId>` and `rival:<houseId>` on their representative squares, `crown:<nation>:<square>`
for royal pieces and `levy:<nation>:<square>` for other banners' pieces. The engine bridge feeds that
map to the existing `BattleIdentityTracker` and returns its `IdentityMoveRecord`s unchanged.

**Match processing** (`record-match`). Idempotent by `matchId`. Rejects malformed records:
non-sequential plies, actors or captured identities missing from the formation or already captured,
a representative absent from the formation, fixture records in production. Outcome is relative to
`playerSide`. Representative fate:

| Stakes | Representative captured, outcome | Result |
| --- | --- | --- |
| `classic` | any | Chronicle notes the capture. No injury, captivity or death. |
| `muster` | defeat | **Captive** of the capturing house (or the opponent crown); captivity notice and unresolved matter. |
| `muster` | victory or draw | **Injured** (recovered from the field or exchanged under truce); recovers after one further recorded match. |
| any | not captured, promoted on the board | Battlefield promotion recorded; political rank unchanged. |

Muster results also move politics: victory +2 recognition and +5 allied disposition; defeat −5
allied disposition. The allied representative captured under the player's command → −10 allied
disposition, a grievance, an `allied-accounting` unresolved matter and an `allied-demand` notice,
even in victory. Capturing the rival representative → rival grievance, memory and a `rival-vow`
notice with an unresolved `grievance`, so an open thread never requires a loss. Winning a Muster
conflict against the nation holding a captive returns that member (`return` chronicle entry, matter
resolved, member available). Injured members whose recovery match is reached become available.

**Stance thresholds.** disposition ≤ −60 hostile, ≤ −15 disdainful, < 15 wary, < 50 cordial, else
loyal. The allied Great House starts at −25 (disdainful while depending on the patron's command);
the rival at −10 (wary).

**Hall tier** (visible development only): recognition ≥ 4 → 1, ≥ 10 → 2, ≥ 18 → 3. Rank stays
`minor-banner` until a political promotion system exists.

**Aftermath.** All facts go to the chronicle. `pendingAftermath` keeps at most two prominent entry
ids, chosen by priority: captivity, return, allied-accounting, grievance/vow, promotion, injury,
match result.

**Persistence.** Key `crownfall.legacy.save`, JSON with `schemaVersion`. Parsing validates every
field and reference; any failure returns an error and leaves the stored data untouched, so the UI can
offer a new banner. Unknown future versions are refused, older versions run through the migration
registry. `?legacy=fresh` starts an in-memory guest session that never reads or writes storage, so a
judge never inherits a previous tester's banner or captives. Resetting a stored banner always asks for
confirmation.

**Development previews.** `?legacyPreview=<fixture-id>` loads a fixture state (`mode: "preview"`).
Every surface showing it carries the label "Development preview · fixture data · not saved".
