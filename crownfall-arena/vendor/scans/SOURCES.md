# Photogrammetry scans: sources and licences

The user downloaded these from their own Sketchfab account (Chrome, profile siscomilesinfo) on 2026-10-24. Each
licence was read in the site's download dialog at that time. Each one is unpacked by `scripts/extract_scans.py` into
its own folder here. The original zips are still in the user's Downloads folder.

| Folder | Model | Author | Licence | Original format | Tris |
|---|---|---|---|---|---|
| `skull_treponemal/` | [Skull showing treponemal disease (syphilis)](https://sketchfab.com/3d-models/skull-showing-treponemal-disease-syphilis-2692cc377baf4031b288aeaa58154bba) | Northern Heritage Network (digitised by Open Virtual Worlds, Univ. of St Andrews) | CC0 1.0 | OBJ + 4 JPG | 900k |
| `hand_nadia/` | [Hand Nadia](https://sketchfab.com/3d-models/hand-nadia-40f791e5bb8b469d8c196255f9198068) | 3dscanservice | CC BY 4.0 | STL (no texture) | 267k |
| `capitoline_courtyard/` | [Capitoline Museum Courtyard](https://sketchfab.com/3d-models/capitoline-museum-courtyard-42c1d4e9e466476d8a119b4555799501) | artfletch | CC BY 4.0 | OBJ + 2 UDIM-style JPG | 1.5M |
| `mercati_traiano/` | [Mercati Di Traiano Ruins](https://sketchfab.com/3d-models/mercati-di-traiano-ruins-0078b73ca5fe42bab3fd7b91c2bd7efe) | artfletch | CC BY 4.0 | OBJ + JPG | 937k |
| `cela_ruins/` | [Cela, Ruins of a nuns' cell](https://sketchfab.com/3d-models/cela-ruins-of-a-nuns-cell-507935f6790e4c278c0cd723d5dd938c) | Morbase, Museu Virtual | CC0 1.0 | OBJ + colour + bump JPG | 707k |

## Restrictions to keep
- **Cela has a "NoAI" flag on Sketchfab.** It must not be used in datasets, model development, or as input to
  generative AI. Never send it, or renders of it, to Meshy or any other generative service. Using it as a mesh in
  Blender and in the game is fine.
- The skull is real human remains (a 16th-century burial from Skriðuklaustur, Iceland). It is CC0, but use it
  respectfully: no gore or joke treatment.

## Credit lines (required for CC BY; put them in the game's credits)
- "Hand Nadia" by 3dscanservice, licensed under CC BY 4.0, via Sketchfab.
- "Capitoline Museum Courtyard" by artfletch, licensed under CC BY 4.0, via Sketchfab.
- "Mercati Di Traiano Ruins" by artfletch, licensed under CC BY 4.0, via Sketchfab.

These are optional but courteous (CC0): "Skull showing treponemal disease (syphilis)", Northern Heritage Network;
"Cela | Ruins of a nuns' cell", Morbase | Museu Virtual.
