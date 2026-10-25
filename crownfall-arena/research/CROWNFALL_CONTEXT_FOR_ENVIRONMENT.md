# Crownfall — what the environment team needs to know (from the creator's handoff, 2026-10-24)

Environment-relevant extract only. It contains no creator-only cosmology; never put hidden lore, invented
kingdom names, emblems or text into the environment.

## What Crownfall is
- A fantasy universe built around chess, living people, political power and sacrifice. **Pieces are people:**
  sixteen living representatives per side fight under the **King's Gambit**, a ritualised, constrained conflict that
  kingdoms use instead of total war. The player is an unseen, godlike presence who moves them by hand (VR,
  hands-first, Meta IWSDK / three.js).
- The game repo is `C:\Users\MILES\Documents\Crownfall` (three.js). In it, 1 unit = 1 square, and rigged soldiers
  stand 0.78–1.12 squares tall.

## Binding consequences for the environment
1. **The board is the ritual floor of a Gambit site, not the whole world.** The handoff says "the entire world is
   NOT literally an enormous chessboard … do not make every aspect of geography a chess metaphor." So:
   - the checker pattern lives on the ritual floor (the 8×8 playfield, its border and its broken fringe);
   - the world beyond is its own surreal, ancient, natural place: cliffs, ruins, vegetation, monuments and the eclipse.
2. **Two views must work.**
   - **(a) Gameplay / god view.** Elevated, looking down: the board fills most of the frame and the world frames it.
     Reference 02 is this view.
   - **(b) Cinematic views** (E33-style angles).
   The board must stay perfectly readable in both. Gameplay matters more than a pretty hero shot.
3. **The 64 squares are sacred and functional:**
   - flat at Z=0, unobstructed, centres ((f−3.5)·2.3, (r−3.5)·2.3, 0), a1 dark at the player's left (−Y);
   - clear floor around the playfield edge;
   - no glowing runes, clutter or text on the playing surface.
4. **Two kingdoms face each other across the floor (−Y player side, +Y opponent side).** Their names and emblems are
   **not decided**, so keep the two plaques and the sides blank, symmetric and neutral. Environmental storytelling may
   suggest two opposing delegations or approaches (for example, matching processional stairs on −Y and +Y), but
   never invent heraldry.
5. **The setting is ancient.** The world existed for thousands of years before the player arrived. Wear, collapse,
   reclaimed nature and the ruins of an older civilisation are on-brief. The Hollow King / empty-throne mystery must
   NOT be resolved or literalised. An ambiguous distant empty seat was only an assistant proposal; ask Miles before
   adding one.
6. **Runtime reality.**
   - Final assets must be exportable to GLB for three.js/WebXR on Quest.
   - Procedural Blender materials must be baked.
   - Budgets matter.
   - The renders are look-development, not proof of headset performance.

## Look
`research/E33_RITUAL_FLOOR_DIRECTION.md` sets the look and the architecture logic, based on Clair Obscur:
Expedition 33 environments (Carla Devèze's portfolio: Lumière, Monolith, Visages, Sirène, Reacher, Stone Wave
Cliffs, Forgotten Battlefield, Flying Waters, Spring Meadows; reference copies in `research/e33_artstation/`).
