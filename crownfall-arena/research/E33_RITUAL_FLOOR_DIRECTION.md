# Crownfall — "The Ritual Floor" direction (user brief 2026-10-24, binding)

Source: the user's 19 Clair Obscur: Expedition 33 environment screenshots (Carla Deveze, lead environment artist),
saved in `research/e33_artstation/` (reference study only — © Sandfall Interactive, never used as assets/textures).
Earlier references (`research/user_refs/01/02`) still define the ingredients (skull, hand, eclipse, lava, ribs);
**E33 now defines the look, the angles and the architecture logic.**

## LOCKED PALETTE + priorities (user, 2026-10-24, after reviewing main v004)
- **Primary palette:**
  - **Obsidian** — near-black basalt/obsidian, rendered ≈0.04–0.10;
  - **Ancient stone** — warm grey #5d574e mid, #8a8377 lit;
  - **Crimson** — oxblood #5a0f14 → #7a1018 for vegetation, banners of growth and accents;
  - **Ember gold** — #d9932e → #f2b04a for eclipse light, bronze, lava cores and warm rims.
- **Secondary:** selective moss green #3e4a26–#4a5a2e and dark red vegetation.
- **Lava:** concentrate it around the important forms (the board's ritual ring, the skull and the hand). Do not
  cover the scene with bright lava or red effects.
- **Order of work:** a **lighting and material pass before major new structures.** That means:
  - darker foreground;
  - controlled warm (ember-gold) light from the eclipse;
  - cooler shadows;
  - fog kept, but strong silhouettes revealed;
  - layered atmosphere.
- **Make the world ancient:** erosion, chipped edges, stains, sediment, moss, exposed roots, broken carved stone.
  The skull and hand should look partly absorbed into the landscape.
- **Distant world:** suspended landmasses, broken bridges and monumental silhouettes at several depths, especially
  beneath the eclipse.
- **Gameplay cameras:** no pillar or rib may block the board.
- **Preserve:** the precise, almost pristine chessboard against the enormous broken world. This is a core design idea.

## THE SKY IS FALLING APART (user, 2026-10-24) — refs: e33_artstation E33_07 (Paris tendril), E33_12 (lake debris storm)
- **Story:** the eclipse is breaking the heavens. Cracks radiate from it across the sky dome. Plates of sky peel away and
  fall, with bright light bleeding through the gaps.
- **Huge torn landmasses** hang in the sky: inverted cliffs with ruins on top and debris trailing.
- **Debris streams** pour upward from the broken ground toward the eclipse.
- **Billowing cloud banks** with tears and gaps frame everything.
- **Visual rules:**
  - large, recognisable forms over noise;
  - warm light bursts through the tears, cool shadow in the cloud masses;
  - **gameplay must stay readable** — nothing crosses the board or the hero monuments in the key cameras.

## UPDATE after the creator's handoff (read `research/CROWNFALL_CONTEXT_FOR_ENVIRONMENT.md`)
- The checker pattern stays on the **ritual floor**: the board, its border, and a broken fringe up to about 1.5 board
  widths out. Beyond that the world is NOT a chessboard. Plates, the floating stream and the tilted monuments switch to
  ancient paving, carved masonry and raw rock. Only a few loose checker tiles ride the stream as fragments.
- The **gameplay / god view** (elevated, looking down, board filling most of the frame) is a first-class view, equal to
  the cinematic shots.
- Extra references in `research/e33_artstation/extra/` (contact sheet `_contact_sheet.png`):
  - **Sirène:** ornate carved, warm-amber ceremonial architecture, twisted/fluted columns, a ribbed tunnel arch,
    draped fabric. This is the right vocabulary for the ritual site's architecture.
  - **Visages:** chaotic stacked scaffold architecture, impossible piles.
  - **Monolith / Reacher:** one strong colour key per area (red canyon + lava glow, blue cave, amber haze), light shafts
    through cliffs, a red-foliage meadow.

## The idea
**The chessboard IS the ground — a ritual floor.** It is not a table on a pedestal. It is the sacred floor of a
shattered, impossible plaza where two kingdoms wage war. The 8×8 playfield (21.9 m board, 2.3 m squares,
`assets/CFCL_Board_Arena`) stays perfectly flat and readable (the game needs it). **Everything beyond it is allowed to
be impossible:** the floor's pattern continues outward as a vast checker plaza that cracks into tectonic plates,
uplifts, tilts, stacks, and finally tears free and streams into the sky toward the eclipse.
"Surreal stacked architecture": stairs and arches stacked at wrong angles, monuments half-swallowed and tilted,
columns standing in impossible fields.

## E33 rules, measured from the 19 images (luma 0–1)
| Rule | Evidence (file) | Our translation |
|---|---|---|
| **High-key luminous haze, strong silhouettes.** Mean luma ≈0.44 (range 0.33–0.59), RMS contrast 0.18–0.27, almost no crushed blacks (≈2% < 0.08) | 09, 10, 11, 12, 13, 19 | Brighter, warmer volumetric haze (sun behind haze); foreground silhouettes dark but not black; background dissolves into luminous mist. Target: mean 0.38–0.46, RMS ≥ 0.20, < 4% crushed |
| **Ground tears into the sky** — a giant curving structure becomes a debris stream; plates peel upward; chunks orbit | 07 (Paris tendril), 12, 16, 24 | Outer plaza plates and checker tiles peel off the floor and **stream in a curving arc up toward the eclipse**, getting smaller and more broken as they rise |
| **Tilted monuments half-sunk** | 07 (Arc de Triomphe tilted into the ground), 08 (tilted monoliths flanking a stair) | A colossal gate/arch and broken obelisks tilted 10–30°, half-swallowed by the plaza plates |
| **Stacked columnar basalt** in towering clustered stacks | 13 | The basalt "ribs" family gains **stacked hexagonal column clusters** (heights stepping like a skyline) |
| **Cubic fractured cliffs** — rock breaks in big orthogonal blocks | 14, 15 | Canyon walls/far cliffs fracture into big blocky slabs and terraces, not smooth noise |
| **Field of standing pillars**, each worn and tilted | 11 | A forest of broken, tilted pillar stumps along one approach |
| **Lush clustered vegetation with saturated accents** — dense rounded crowns, crimson/orange/coral trees, branching coral-like shrubs, glowing ground flowers | 09, 18, 22, 23 | Dense dark-green crown clusters on ledges + crimson/oxblood trees (hero accent near the hand), coral-like branching shrubs, scattered tiny emissive flowers in shade |
| **Atmospheric depth in 3+ planes** with light shafts | 08, 19, 25 | Dark detailed foreground frame → mid-ground hero monuments → pale luminous background; god rays through dust |
| **Dynamic, unusual angles** | 07 (over-shoulder), 08 (low worm's-eye up a stair), 14/15 (centred symmetric gate), 24 (ground-level debris) | Camera set: low worm's-eye across the floor, over-the-shoulder of a "soldier", high three-quarter, symmetric axial, Dutch-tilted dramatic |
| **Colour scripts per area** | 18 warm autumn, 20/21 blue night, 22 violet fog, 23 crimson grove, 25 amber battlefield | Ours: eclipse-amber haze above, cool stone, crimson foliage accent, lava red low; keep a single dominant colour key per shot |

## What stays
Skull (left), reaching hand (right), eclipse, lava abyss, carved ritual ring, ribs, CC0 cliff banks, the story
(a fallen colossus; the board is the sacred floor that nature and fire refuse to touch).

## Gameplay constraints (never break)
- 64 squares flat at Z=0 and unobstructed; square centres exactly ((f−3.5)·2.3, (r−3.5)·2.3, 0); a1 dark at player-left (−Y side).
- Nothing above the playfield within the board footprint; ~1 square of clear floor around the playfield edge so figures at the edge
  read; impossible/tilted elements start beyond that.
