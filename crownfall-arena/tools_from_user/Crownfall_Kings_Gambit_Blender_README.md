# Crownfall — King's Gambit Arena: Blender Lookdev Kit

**Prepared:** October 24, 2026  
**Target Blender versions:** 5.2 LTS (recommended current LTS), 4.5 LTS (compatible design; version branches provided).  
**Files:** `Crownfall_Kings_Gambit_Blender_Lookdev.py`  
**Scope:** your **existing arena scene**, not a procedural replacement for your arena models.

## Run the script safely

1. **Save a separate copy of your original Blender file** via File → Save As, for example `Crownfall_KG_lookdev_v01.blend`.
2. Switch to **Object Mode**. Select **all meshes that make up the 8×8 chessboard floor**, without selecting surrounding landscape and pillars. For a single-object board, select that object. Alternatively, put the **3D cursor at the board center**, and change `USE_SELECTION_BOUNDS = False` in the script and `FALLBACK_BOARD_WIDTH` to match the scene.
3. Make sure the intended gameplay hero camera is the **active scene camera** before the first run. Lights and generated shots are oriented using the active camera's side of the board. If you have no active camera, the script assumes your gameplay camera looks from **-Y toward +Y**.
4. Scripting workspace → Text Editor → Open → select `Crownfall_Kings_Gambit_Blender_Lookdev.py` → **Run Script** (Alt+P).
5. Open the Outliner and expand `KG | LOOKDEV RIG`. You'll find new rim light, cool fill, optional skull/hand accent lights, and optional cameras. No original geometry is intentionally moved or overwritten.
6. Switch to **Rendered** viewport shading or F12 for a test render. Compare to your original frame from the same angle.
7. Adjust configuration values at the top of the Python file and run again. It re-creates *its own* rig instead of endlessly duplicating the rig objects.

### What it changes

- New **warm eclipsed rim sun** and **cool area fill** light.
- Accent spotlights at your skull/hand **only if identifiable by object names** (`skull`, `cranium`, `hand`, `palm`) or configured exact names.
- Original SUN strengths **temporarily multiplied by 0.35**, with original values saved in lamp custom properties for restoration.
- Existing World is **copied and dimmed**, preserving original World datablock.
- AgX color transform, medium-high contrast when available, and **-0.35 exposure**.
- Eevee preview at **70% render resolution**; changing `RENDER_MODE = 'FINAL'` selects Cycles, **128 samples**, CPU (rather than assuming your GPU can handle a huge scene).
- New unassigned sample materials: limestone, basalt, fossil bone, aged gold.
- Optional cameras for wide, duel, and topdown (original active camera is not changed).

### What it intentionally does not do

- It does **not** remove pre-existing fog objects or remove any World Volume node (existing haze may still cause flat lighting).
- It does **not** automatically apply new materials to the skull, board, or pillars, since that could replace your texture maps.
- It does **not** rearrange or remove your monoliths and background ruins.
- It does **not** change existing compositor trees (Blender 5 changed the compositor API).
- It does **not** generate production-ready environmental textures or bake material maps.

**Restore:** change `ACTION = 'RESTORE'` and Run Script. This removes objects created by the kit, restores saved color/render/world settings and original SUN energies. Unassigned preset materials remain available, and old saved World copies may remain as unused data-blocks. Or reopen the saved original file.

## Artistic passes — what to do after running it

### A. Lighting and atmosphere — highest impact

1. **Temporarily mute existing fog.** In Shader Editor set **World** and inspect any node connected to the World **Volume** input. Also hide custom fog cube/volume objects. Re-render without fog. Your current images are more washed out than the mood reference.
2. **Confirm a lighting hierarchy.** Eclipse direction = warm rim. Board/foreground = limited cool fill. Skull = warm accent. Hand = cool accent. Other background monoliths should be darker than landmarks.
3. **Check grayscale** by viewing a desaturated screenshot. Skull + hand + board + eclipse should read as four discrete major shapes; background columns must not merge into them.
4. **Set atmospheric perspective only in the distance.** When the clear render is already good, try `ADD_LOCAL_FOG=True` in the script. Keep fog density low and limited behind the board. If it washes everything out, turn it off again.
5. **For eclipse glow:** Set `ECLIPSE_OBJECT_NAME` to the name of the eclipse *mesh* and `ADD_ECLIPSE_CORONA=True`, rerun. The optional corona is a thin *emissive geometry layer*, not a finished particle effect. For soft glow, add a low-strength **Glare** node in the Blender Compositor, using **Fog Glow** or **Bloom** on Blender 5.2. Do not overdo the spread or it will wash out the scene again.

### B. Materials — solve the biggest surface issues

- **Chessboard light tiles:** warm ivory rather than pure white, with a worn satin/stone finish (suggested roughness **0.65–0.85**). Avoid the bright specular hotspot currently visible in the middle of the board.
- **Chessboard dark tiles:** charcoal basalt rather than middle grey (suggested roughness **0.55–0.75**). Keep sufficient difference from the ivory squares for fast gameplay reading.
- **Board edge:** thin royal-gold inlays and carved stone details; use metallic gold sparingly. Don't fill board squares with complex symbols that obscure characters.
- **Skull:** bone should be irregular, cracked and porous, with a pale warm tone and darker material in cavities. Moss belongs mainly on top-facing exposed surfaces, cracks and sediment traps.
- **Hand:** give it a material history related to the skull, but not an identical albedo. Colder shadows and different vegetation coverage will help separation.
- **Pillars:** at least three variants of the same base material — clean broken face, heavy erosion, and heat-scarred near lava. Use decals and trim-sheet wear instead of only noise texture variations.
- **Lava:** bright fissures, dark crust, restrained orange bounce near nearby edges. Eevee emission by itself does **not** guarantee realistic nearby GI; add a small warm local light when necessary.
- **Vegetation:** collect rich red plants into visual *clusters*, not an equal scatter everywhere. Reinforce the composition around skull, hand, and rear ledge. Leave the combat board clean.

Generated `KG | ...` material samples are for lookdev and testing. **Do not overwrite existing excellent UV/PBR textures with simple noise shaders.** Upgrade hero materials using their original texture sets + roughness/normal/edge-decals.

### C. Geometry and composition — less repetition, better silhouette

- In your wide aerial view, move or reduce the monolith that sits directly over the center of the chessboard. Foreground framing is good, but the platform must stay visible in an important promotional shot.
- Break up repeated pointed columns: retain some tall perfect silhouettes, but introduce broken 40% height, leaning/clustered, and partially buried versions.
- Create **three background depth bands**: foreground rubble/columns; midground skull/hand/ruins; distant suspended land masses and almost-silhouette architecture. Depth needs value/color separation more than raw poly count.
- Keep chessboard gameplay boundaries and collision boundaries visually aligned. Any apparent open gap with lava should be telegraphed to players.
- Integrate architectural fragments beneath the skull or hand to suggest **why those gigantic monuments exist**. A scene is more memorable when its giant objects have a worldbuilding purpose.

### D. Camera quality assurance — 3 mandatory frames

The toolkit generates candidate cameras, but they require manual adjustment if the scene's geometry is irregular.

| View | Goal | Acceptance test |
|---|---|---|
| `KG | CAMERA | HERO_WIDE` | Market the environment | Board, eclipse, skull and hand all visible and separate |
| `KG | CAMERA | DUEL_GROUND` | Check actual gameplay feel | Characters would remain readable over tiles and against backdrop |
| `KG | CAMERA | MAP_TOPDOWN` | Validate level design | 8×8 board, ring, boundaries and surrounding hazard lanes readable |

**Quality gate:** Compare all three views with fog on/off and grayscale on/off. If one pass improves the wide establishing shot but hides the board in the duel shot, lower the effect or restrict it to farther space.

## Blender 5.2 tutorial and art reference links

1. **ChuckCG — The Eternal Hall:** atmospheric architectural lighting, soft fog, god rays. Video: https://youtu.be/T5xeou1f8uM | ArtStation project: https://chuckcg.artstation.com/projects/8BDW5G
2. **ChuckCG — How to Create Environments in Blender:** mountain environment, sky, atmosphere, free resources mentioned: https://youtu.be/S-WMPiu4CY8
3. **Ryan King Art — Quick Easy Fog Effect in Blender (2026):** works in Eevee/Cycles, includes animation: https://www.youtube.com/watch?v=GjvlxbRtZwE
4. **Ryan King Art — Procedural Moss Material:** combines moss with existing materials using noise/gradient factors: https://www.youtube.com/watch?v=N-yXzcU-wls
5. **Blender Guru — How to use Eevee (2026):** fundamentals, GI, reflection probes, material/lighting and performance troubleshooting: https://www.blenderguru.com/posts/how-to-use-eevee-full-course
6. **Ioannis Stamatelis — Ruins Breakdown:** modular stone materials, RGB masks, decals, lighting: https://ioannisstamatelis.artstation.com/projects/3E8Oag and https://gamesartist.co.uk/ruins/
7. **Marcus Lembke — Fen Ruins:** large environmental vistas, material blends, silhouette composition: https://gamesartist.co.uk/fen-ruins/
8. **Ruined Stairways (GamesArtist):** camera focal points, grayscale checks, lighting and material polish: https://gamesartist.co.uk/ruined-stairways/
9. **Ju Jinhwan — The Ruined Church:** gothic architecture, blending weathered stone, sculpted statues and ruins: https://gamesartist.co.uk/the-ruined-church/
10. **Gerald IR — Gate to Different Dimension (ArtStation):** Blender-based supernatural ruins with mood explorations: https://www.artstation.com/artwork/aRxqW2

## Official Blender references

- Blender 5.2 LTS release (5.2.3 maintenance version published Oct 22, 2026): https://www.blender.org/releases/5-2/
- Blender 5.0 Python/API compositor migration: https://developer.blender.org/docs/release_notes/5.0/python_api/
- Blender 5.2 Compositor: https://docs.blender.org/manual/en/5.2/compositing/introduction.html
- Blender 5.2 Glare Node: https://docs.blender.org/manual/en/5.2/compositing/types/filter/glare.html
- Blender 5.2 Eevee volume settings: https://docs.blender.org/manual/en/5.2/render/eevee/render_settings/volumes.html
- glTF exporter limitations: https://docs.blender.org/manual/en/5.2/addons/scene_gltf2.html

### If your arena will run in a separate game engine

Blender's **camera compositor**, **procedural volume shader**, **World**, and some procedural materials are principally lookdev/rendering tools. Exporting to glTF/GLB won't faithfully carry everything over. glTF supports mesh geometry, PBR materials (with supported node layouts) and select light types/extensions; area lamps and World illumination do not export as standard glTF lights. Reimplement scene lighting/fog and camera post-process inside your game runtime, and bake unsupported procedural textures to PBR maps.

## Performance and troubleshooting

| Symptom | What to try first |
|---|---|
| Still too beige/flat | Turn off original World Volume/fog objects; reduce existing sun power; lower World strength; verify AgX exposure |
| Everything became too dark | Raise WORLD_STRENGTH from 0.35 toward 0.6, or exposure from -0.35 toward 0; set `DIM_ORIGINAL_SUNS=False` |
| Highlight spots in wrong place | Set exact `SKULL_OBJECT_NAME` / `HAND_OBJECT_NAME` at top of script |
| Lights rotated wrong way | Make the intended hero camera active before running, then rerun |
| Fog slows preview | Leave `ADD_LOCAL_FOG=False`; EEVEE volumetrics are memory intensive |
| Eclipse has a hard glowing donut | Disable `ADD_ECLIPSE_CORONA`; use a painted/texture-based corona or finer artistic geometry |
| Board too shiny | Increase roughness of the *existing* tile materials; use subtle albedo breakup |
| Script ran but looks unchanged | Switch from Solid to Material Preview/Rendered mode, or hit F12 |
| Python warning for a property | Property differs in your version; script is written to skip some unsupported properties safely |
| Want original back | `ACTION='RESTORE'` and Run Script, or reopen the saved original project |

**Not a replacement for testing in your scene:** I was able to syntax-check the supplied Python file, but this workspace does not have Blender installed or your actual `.blend` file, so full execution and rendering have not been verified. Test in a duplicate project and evaluate all important gameplay angles.
