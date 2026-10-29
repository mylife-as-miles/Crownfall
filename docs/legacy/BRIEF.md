# MY LEGACY — creative and technical brief

*Your Banner. Your People. Your Place in Crownfall.*

This is the working brief for the My Legacy feature in both the desktop (`main game/`) and
Meta Quest (`main-game-vr/`) experiences. It condenses the product owner's direction. Both
platforms are mandatory deliverables; neither is a preview of the other.

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

## Vision

- The player is unseen and has no body, face or voice in the world. They guide a **banner** — a
  small house inside one of Crownfall's four nations.
- The house starts at the bottom of the political hierarchy: a modest holding, little recognition
  and a few people eligible for the **National Muster**.
- The world must show that the house belongs to a civilisation far larger and older than itself:
  distant capital, rival estates, military processions, heraldic standards, settlement smoke,
  monumental architecture. The holding is never isolated in an empty landscape.
- Central principle: **"You command the entire formation, but not everyone on the board belongs
  to you."** The King's Gambit (chess) is the formal conflict system. My Legacy preserves the
  people, obligations, rivalries and consequences around it.
- Never alter chess rules and never add earned chess power-ups. Progression means political
  recognition, representation, relationships and visible development — never illegal moves.
- *The board records the move. The houses remember the consequence.* Absence can be as powerful
  as presence.

## Chess comes first

Crownfall is mainly a chess game. My Legacy exists to give matches weight, never to compete with
them for the player's time. Critics treat a breach of these rules as a blocker.

- **Never a gate.** Play is always one action from Home. A player can play chess without founding a
  banner, and My Legacy is never shown before the first match unless the player chooses it.
- **Every path leads back to the board.** Each landmark's primary action points toward a match:
  nominate and answer the challenge, review what the last match changed, read the notice that
  summons the next one. No landmark is a destination in itself.
- **Only chess changes the house.** Recognition, captives, injuries, honours and the Bannerhold's
  appearance change only through match results. There are no currencies, timers, crafting,
  building queues, chores or idle loops, and nothing to grind between matches.
- **Short by design.** The founding takes under two minutes, with a one-action suggested name. An
  aftermath shows at most two prominent messages and can be dismissed at once. Inspecting a
  landmark never forces reading.
- **No cost to the chess experience.** My Legacy loads lazily and never adds to the time from launch
  to the first legal move, on desktop or Quest. The chess board, its legality and its controls
  are untouched, and no Legacy progress grants a chess advantage.
- **Measured.** Verification records the time from launch to the first move with and without a
  saved banner, and the number of actions from any Legacy screen back to a match.

## Art direction (AAA bar)

- An explorable-in-place, spatially rich **Bannerhold**: authored settlement, uneven terrain,
  paths, inhabited structures, flags, environmental storytelling and a compelling distant skyline.
  Not a floating chessboard beside generic cubes.
- Strong architectural silhouettes, believable construction, intentional scale, physically based
  materials, layered lighting, atmospheric depth, controlled colour grading, polished motion.
  Detail looks authored, not randomly scattered. Silhouette and hierarchy before clutter.
- Material variation, vertex colour, decals, terrain blending, atlases/trim sheets and instancing.
- Desktop may use richer shadows, effects and geometry with fallback presets. Quest keeps the same
  identity with optimised assets, baked illumination where appropriate, few draw calls, efficient
  geometry, controlled transparency and measured frame timing. Avoid many real-time shadow casters,
  expensive full-screen effects and noisy particles.
- Bloom and fog do not make an environment AAA. Architecture, composition, materials and lighting
  must earn it. Do not copy existing games' assets, architecture or copyrighted designs.

### Four nations (shared system, distinct identities — not colour filters)

| Nation | Identity |
| --- | --- |
| **Korvenia** | Occult Grand Duchy beneath an eclipse. Noble estates, Gothic architecture, austere ceremonial spaces, veiled heraldry, ancient stone, black marble, restrained violet-gold accents. |
| **Solforiz** | The Scorched Caliphate. Monumental desert architecture, sulfur formations, fortified settlements, intricate masonry, heat-worn surfaces, ceremonial courtyards, warm mineral light. |
| **Aethelgard** | The Blood-Throne civilisation. Ancient rugged halls, colossal stone, primordial wilderness, timber fortifications, ancestral monuments, harsh terrain. |
| **Kwind-09** | The Kwind Zaibatsu. Stratified corporate metropolis: industrial neighbourhoods, neon infrastructure, layered urban architecture, elevated transport, mechanical activity, stark privileged/lower district divide. |

Launch armies are not decided: the two initial playable armies await explicit approval. Keep
nation availability configurable. Build the first production-quality environment as the quality
benchmark, then extend the same architecture to the other nations.

## The Bannerhold — four landmarks

- **Banner Hall** — symbolic centre. House name, heraldic standard, nation, recognised status.
  Modest at first, architecturally able to become more prestigious. Banner colours/emblem appear on
  physical standards, shields and building details.
- **Muster Grounds** — military assembly space. Shows the representative the house contributes to
  the National Muster: for the first release, **one named Pawn**. The player nominates which
  eligible Pawn **starting file** represents the house. This affects identity and narrative stakes,
  not the number of pieces controlled; the national formation follows standard chess. The Pawn has a
  recognisable presentation and can be inspected (name, banner allegiance, status). The data model
  must support future Knight/Bishop/Rook/Queen appointments without implementing that system.
- **War Record** — a physical record (war table, archive, ledger) instead of a stats panel.
  Naming: this is always the **War Record**, never "War Chronicle". *Chronicles* is the separate
  world archive on Home (nations, history, institutions); what happens to the house belongs here.
  Records completed conflicts, legal chess outcomes, nominated representatives, notable captures,
  promotions, political grievances and unresolved matters, from persistent Legacy data. Never
  invent matches or fabricate progression in production.
- **Herald's Station** — incoming summons, rival challenges, political notices. Communicates
  national authority and the player's minor status. Initial demonstration: one **allied Great
  House** and one **foreign rival house**. The rival may remember previous battles; the ally may
  react when its representative is lost under the player's command; a Great House can disdain the
  humble banner while depending on the player's leadership. Grounded in actual match results.

## Founding a banner

First entry starts a compact, elegant, ceremonial founding: nation, custom banner name, heraldic
elements and colours. Desktop supports direct text entry. Quest uses a comfortable hand-operable
interface with quick name suggestions and optional headset text entry where practical. No
embodied founder with a face, body or voice. The result persists. Not an over-long intro.

## Environmental storytelling

Restrained daily life: moving guards, working residents, subtle cloth motion, chimneys, distant
activity, ceremonial figures. Focal character: the nominated Pawn. Condition states, when real state
data exists:

- **Available** — stands among the house levy.
- **Injured** — recovers in the holding, only if an injury was legitimately recorded.
- **Captive** — their place is empty, with an indication of which rival holds them.
- **Returned** — presence restored; the Chronicle preserves the event.
- **Promoted** — record and presentation acknowledge the battlefield promotion without
  automatically changing political standing.

Never apply permanent capture or death to ordinary Classic matches. Only designated high-stakes
**Muster** conflicts may produce persistent captivity, and their national wager must be presented
clearly before the match.

## Desktop

Genuine 3D scene inside Home → My Legacy (no static image, no dead-end modal). Cinematic framing,
smooth transitions, limited orbit/inspection, point-and-click, existing keyboard and gamepad
expectations, deliberate inspection framings with contextual information (not generic menus),
camera limits that preserve composition and prevent clipping, desktop and landscape-phone layout
constraints, quality presets with fallbacks, a clear route back to Home.

## Meta Quest

The corresponding immersive scene on the repository's IWSDK architecture. Unseen, elevated
perspective; comfortable, primarily stationary inspection; look around and lean in; no artificial
walking. A convincing miniature territory or spatially staged environment with real 3D presence.
Hands-first (ray and direct touch), no controller requirement, either hand, seated/standing,
recentre, pause/resume, safe Exit VR. Never move or rotate the viewer's real-world viewpoint during
a transition. Comfortable distances, large targets, legible spatial text, and menu actions that keep
working after hand-tracking loss and recovery. Build and test the immersive scene itself.

## Shared architecture and persistence

- `shared/legacy/` owns platform-independent state, scene descriptions, content, types and rules.
  Desktop and Quest consume the same state and asset definitions through platform renderers and
  interaction adapters. Never two unrelated Legacy implementations.
- Share pure TypeScript logic, configuration and assets — never runtime Three objects. Quest imports
  Three only through `@iwsdk/core` (super-three); desktop keeps its own `three`.
- Versioned data model: banner identity, nation, heraldry, house rank, nominated representative,
  house membership, match history, character status, relationships, unresolved challenges.
- Deterministic transitions, independent of React components and IWSDK entities.
- A shared event-processing layer accepts legal move records and finalised results from the existing
  chess engine (`web/src/core/gameController.ts`, `web/src/campaign/identity.ts`). Never duplicate
  chess.js rules or rebuild the AI.
- Compatible desktop and Quest save formats. Local persistence per app is acceptable; a shared
  schema is not cross-device sync, so never claim account sync.
- Safe handling of missing saves, invalid records, schema upgrades, resets and new banners. A fresh
  judge or tester must be able to start without inheriting a previous tester's banner or captives.

## First complete gameplay connection

Found a Minor Banner → the house contributes a named Pawn to the National Muster → a formal
challenge states the political context and the nation's stakes → a legal chess match (eventually
through the existing game systems) → a result processor reads the factual match history and decides
which named representatives were captured → outcomes are stored → back in My Legacy the holding,
residents, War Record and Herald's Station respond. Show at most **two** prominent aftermath
messages while keeping every fact recorded. An unresolved thread must not require a loss. Until the
real match integration exists, exercise consequences only through automated fixtures and clearly
identified development previews — never fabricated production records, and never claim the Quest
chess integration is complete.

## Acceptance

Both apps build; shared-content sync checks pass; My Legacy opens a real 3D scene from Home on both
platforms; identity, nation and heraldry persist and are visible in the environment; the primary
settlement has authored architecture, layered lighting, readable detail and subtle life; desktop
inputs work; Quest works with tracked hands in an actual immersive session with navigation, pause and
recovery; a named Pawn can be nominated and inspected; Chronicle and politics render from shared data
with no fabricated production results; tests cover capture, victory, defeat, draw, reset and
persistence; environment assets are optimised with measured frame timing and resource use; existing
menus and the sorcerer stay intact; My Legacy runs smoothly in the browser without lag or hitches and meets every budget in `docs/legacy/PERFORMANCE.md` (measured each evidence round); captures exist for desktop and Quest; browser emulation is never
presented as physical headset validation. Run the root build, Quest tests, `check:sync` and the
applicable desktop tests. Document outstanding limitations honestly. Draft PR only; no merge or
deployment without authorisation.
